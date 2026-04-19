import {
  transformSync,
  parseSync,
  printSync,
  CallExpression,
  Identifier,
  Node,
  ImportDeclaration,
  VariableDeclaration,
  ExportDeclaration,
  ExportNamedDeclaration,
  ExportDefaultExpression,
  ExportDefaultDeclaration,
  ExportAllDeclaration,
  TsExportAssignment,
  TsNamespaceExportDeclaration,
  ExpressionStatement,
  Program,
  ObjectPatternProperty,
  FunctionDeclaration,
  MemberExpression,
  KeyValuePatternProperty,
  KeyValueProperty,
  AssignmentPatternProperty,
  ClassDeclaration,
} from '@swc/core';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { cwd } from 'process';
import { readFileCached } from './utils';

type LoadTSConfig = null | { paths: Record<string, string[]>; baseUrl: string };
type ImportClause = { type: 'named'; original: string; mangled: string } | { type: 'default'; mangled: string } | { type: 'namespace'; mangled: string };

type HandledNode =
  | ImportDeclaration
  | VariableDeclaration
  | ExportDeclaration
  | ExportDefaultExpression
  | ExportDefaultDeclaration
  | ExportNamedDeclaration
  | ExportAllDeclaration
  | TsExportAssignment
  | TsNamespaceExportDeclaration
  | ExpressionStatement
  | CallExpression;

const extensions = ['.js', '.ts', '.mjs', '.mts', '.cjs', '.cts', '.jsx', '.tsx'];
const jsExtensions = ['.js', '.mjs', '.cjs', '.jsx'];
const excludedExtensions = ['.svg', '.bmp', '.ico', '.gif', '.png', '.jpeg', '.jpg', '.webp', '.avif', '.astro', '.vue', '.svelte', '.css', '.scss'];
const handledNodeTypes = new Set([
  'ImportDeclaration',
  'VariableDeclaration',
  'ExportDeclaration',
  'ExportDefaultExpression',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'TsExportAssignment',
  'TsNamespaceExportDeclaration',
  'ExpressionStatement',
  'CallExpression',
]);

function isHandledNode(node: Node): node is HandledNode {
  return handledNodeTypes.has(node.type);
}

// caches
const transformCache = new Map<string, string>();
const processingPromises = new Map<string, Promise<string>>();
const resolveCache = new Map<string, string>();
const importResolutionCache = new Map<string, string>();
const ignoredKeys = new Set(['span', 'ctxt', 'optional', 'start', 'end', 'loc', 'type', 'declare', 'generator', 'async']);
let tsConfigCache: LoadTSConfig | undefined;
let projectRootCache: string | undefined;

// Mangling state
const bundleUsedNames = new Set<string>();
const bundleMangleMap = new Map<string, Map<string, string>>();
const fileDefaultExportMap = new Map<string, string>();
const fileLocalMangleMap = new Map<string, Map<string, string>>();

// A function that collects local bindings (variables introduced by import/require).
function collectLocalBindings(ast: Program): string[] {
  const bindings: string[] = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
          bindings.push(spec.local.value);
        } else if (spec.type === 'ImportSpecifier') {
          bindings.push(spec.local.value);
        }
      }
    } else if (node.type === 'VariableDeclaration') {
      const decl = node.declarations[0];
      if (decl?.init?.type === 'CallExpression' && (decl.init.callee as Identifier).value === 'require') {
        if (decl.id.type === 'Identifier') {
          bindings.push(decl.id.value);
        } else if (decl.id.type === 'ObjectPattern') {
          for (const prop of (decl.id as any).properties) {
            if (prop.type === 'AssignmentPatternProperty' && prop.key.type === 'Identifier') {
              bindings.push(prop.key.value);
            } else if (prop.type === 'KeyValuePatternProperty') {
              // { original: alias } の場合、alias がローカル変数名
              if (prop.value.type === 'Identifier') bindings.push(prop.value.value);
            }
          }
        }
      }
    }
  }
  return [...new Set(bindings)];
}

function getProjectRoot(): string {
  if (projectRootCache) return projectRootCache;

  let currentDir = cwd();
  while (!existsSync(resolve(currentDir, 'package.json'))) {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      projectRootCache = currentDir;
      return currentDir;
    }
    currentDir = parentDir;
  }
  projectRootCache = currentDir;
  return currentDir;
}

function loadTsConfig(): LoadTSConfig {
  if (tsConfigCache !== undefined) return tsConfigCache;

  const tsConfigPath = resolve(getProjectRoot(), 'tsconfig.json');
  if (!existsSync(tsConfigPath)) {
    tsConfigCache = null;
    return null;
  }

  try {
    const config = JSON.parse(readFileSync(tsConfigPath, 'utf-8'));
    tsConfigCache = config.compilerOptions || null;
  } catch {
    tsConfigCache = null;
  }
  return tsConfigCache as LoadTSConfig;
}

function resolvePathWithExtension(basePath: string): string {
  if (resolveCache.has(basePath)) return resolveCache.get(basePath)!;

  if (extname(basePath)) {
    resolveCache.set(basePath, basePath);
    return basePath;
  }

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (existsSync(fullPath)) {
      resolveCache.set(basePath, fullPath);
      return fullPath;
    }
  }

  resolveCache.set(basePath, basePath);
  return basePath;
}

function resolveImportPath(importPath: string, tsConfig: LoadTSConfig): string {
  if (importResolutionCache.has(importPath)) return importResolutionCache.get(importPath)!;

  if (!tsConfig?.baseUrl) {
    importResolutionCache.set(importPath, importPath);
    return importPath;
  }

  const baseDir = resolve(getProjectRoot(), tsConfig.baseUrl);

  if (tsConfig.paths) {
    for (const [alias, targetPaths] of Object.entries(tsConfig.paths)) {
      const aliasPrefix = alias.replace(/\*$/, '');
      if (!importPath.startsWith(aliasPrefix)) continue;

      for (const target of targetPaths) {
        const resolvedTarget = target.replace(/\*$/, '');
        const candidatePath = resolve(baseDir, resolvedTarget + importPath.slice(aliasPrefix.length));
        const resolvedPath = resolvePathWithExtension(candidatePath);
        if (existsSync(resolvedPath)) {
          importResolutionCache.set(importPath, resolvedPath);
          return resolvedPath;
        }
      }
    }
  }

  const finalPath = resolve(baseDir, importPath);
  importResolutionCache.set(importPath, finalPath);
  return finalPath;
}

function transformer(source: string, ext: string, filePath: string): string {
  if (transformCache.has(filePath)) return transformCache.get(filePath)!;

  const { code } = transformSync(source, {
    sourceMaps: false,
    module: { type: 'es6' },
    jsc: {
      parser: { syntax: 'typescript', tsx: ext.endsWith('tsx') },
      target: 'es2022',
      transform: {
        react: { runtime: 'automatic' },
        optimizer: {
          globals: {
            vars: {
              'import.meta.dirname': '__shim_dirname',
              'import.meta.filename': '__shim_filename',
              'import.meta.url': 'pathToFileURL(__shim_filename).href',
            },
          },
        },
      },
    },
  });

  transformCache.set(filePath, code);
  return code;
}

async function prefetchImports(nodes: Node[], basePath: string, tsConfig: LoadTSConfig): Promise<void> {
  const importsToLoad: string[] = [];

  for (const node of nodes) {
    if (isHandledNode(node))
      if (node.type === 'ImportDeclaration') {
        importsToLoad.push(node.source.value);
      } else if (node.type === 'ExportAllDeclaration') {
        importsToLoad.push(node.source.value);
      } else if (node.type === 'VariableDeclaration') {
        const decl = node.declarations[0];
        if (decl?.init?.type === 'CallExpression' && (decl.init.callee as Identifier).value === 'require') {
          importsToLoad.push((decl.init.arguments[0].expression as Identifier).value);
        }
      } else if (node.type === 'CallExpression' && (node.callee as Identifier).value === 'require') {
        // CommonJS require in expression
        const args = node.arguments;
        if (args[0]?.expression.type === 'StringLiteral') {
          importsToLoad.push(args[0].expression.value);
        }
      } else if (node.type === 'CallExpression' && node.callee.type === 'Import') {
        // dynamic import is not fully supported but we can try
        const args = node.arguments;
        if (args[0]?.expression.type === 'StringLiteral') {
          importsToLoad.push(args[0].expression.value);
        }
      }
  }

  if (importsToLoad.length === 0) return;

  await Promise.all(
    importsToLoad.map(async importPath => {
      if (excludedExtensions.includes(extname(importPath))) return;
      let resolvedPath = importPath.startsWith('.') ? resolve(dirname(basePath), importPath) : resolveImportPath(importPath, tsConfig);
      resolvedPath = resolvePathWithExtension(resolvedPath);

      if (existsSync(resolvedPath)) {
        if (transformCache.has(resolvedPath)) return;

        if (processingPromises.has(resolvedPath)) {
          await processingPromises.get(resolvedPath);
          return;
        }

        const promise = (async () => {
          const content = readFileCached(resolvedPath);
          const ext = extname(resolvedPath);
          const code = jsExtensions.includes(ext) ? content : transformer(content, ext, resolvedPath);
          transformCache.set(resolvedPath, code);
          return code;
        })();

        processingPromises.set(resolvedPath, promise);
        try {
          await promise;
        } finally {
          processingPromises.delete(resolvedPath);
        }
      }
    }),
  );
}

function collectTopLevelSymbols(ast: Program): string[] {
  const symbols: string[] = [];
  for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') {
          symbols.push((decl.id as Identifier).value);
        } else if (decl.id.type === 'ObjectPattern') {
          for (const prop of decl.id.properties) {
            if (prop.type === 'AssignmentPatternProperty' && (prop as AssignmentPatternProperty).key.type === 'Identifier') {
              symbols.push(((prop as AssignmentPatternProperty).key as Identifier).value);
            }
          }
        }
      }
    } else if (node.type === 'FunctionDeclaration') {
      if (node.identifier) symbols.push(node.identifier.value);
    } else if (node.type === 'ClassDeclaration') {
      if (node.identifier) symbols.push(node.identifier.value);
    } else if (node.type === 'ExportDeclaration') {
      const decl = node.declaration;
      if (decl.type === 'VariableDeclaration') {
        for (const v of decl.declarations) {
          if (v.id.type === 'Identifier') symbols.push((v.id as Identifier).value);
        }
      } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
        const namedDecl = decl as FunctionDeclaration | ClassDeclaration;
        if (namedDecl.identifier) symbols.push(namedDecl.identifier.value);
      }
    } else if (node.type === 'ExpressionStatement') {
      if (node.expression.type === 'AssignmentExpression') {
        const { left, right } = node.expression;
        if (left.type === 'MemberExpression' && right.type === 'FunctionExpression' && right.identifier) {
          const obj = (left.object as Identifier).value;
          const prop = (left.property as Identifier).value;
          if ((obj === 'module' && prop === 'exports') || obj === 'exports') {
            symbols.push(right.identifier.value);
          }
        }
      }
    }
  }
  return [...new Set(symbols)];
}

function createExportAssignment(name: string, value: string, span: any): ExpressionStatement {
  if (name === 'default') {
    // Track the default export name for linking
    // We get the basePath from the outer scope in transformNode
  }
  return {
    type: 'ExpressionStatement',
    span,
    expression: {
      type: 'AssignmentExpression',
      span,
      operator: '=',
      left: {
        type: 'MemberExpression',
        span,
        object: {
          type: 'MemberExpression',
          span,
          object: { type: 'Identifier', value: 'module', span, ctxt: 0, optional: false },
          property: { type: 'Identifier', value: 'exports', span, ctxt: 0, optional: false },
        },
        property: { type: 'Identifier', value: name, span, ctxt: 0, optional: false },
      },
      right: { type: 'Identifier', value, span, ctxt: 0, optional: false },
    },
  } as ExpressionStatement;
}

function fullCodeGen(
  code: string,
  basePath: string,
  bundleStack: string[],
  externalImportSet: Set<string>,
  processedFiles: Set<string> = new Set(),
  entryPoint?: string,
): void {
  const currentFileMangleMap = new Map<string, string>();
  const currentLocalMangleMap = new Map<string, string>();

  const actualEntryPoint = entryPoint ?? basePath;
  const isEntryPoint = basePath === actualEntryPoint;

  if (processedFiles.has(basePath)) return;
  processedFiles.add(basePath);

  const tsConfig = loadTsConfig();
  const externalImportMap: Map<string, Set<ImportClause>> = new Map();

  const shim = `const __shim_dirname = __dirname;\nconst __shim_filename = __filename;\nconst { pathToFileURL } = require('url');\n`;
  externalImportSet.add(shim);

  const ext = extname(basePath);
  const isTs = ext.includes('ts');
  const ast = parseSync(code, { syntax: isTs ? 'typescript' : 'ecmascript', tsx: ext.endsWith('tsx') });

  // 1. Mangling pass
  const localSymbols = collectTopLevelSymbols(ast);
  const localBindings = collectLocalBindings(ast);
  const allLocalNames = [...new Set([...localSymbols, ...localBindings])];

  for (const sym of allLocalNames) {
    if (bundleUsedNames.has(sym)) {
      let counter = 1;
      let newName = `${sym}_${counter}`;
      while (bundleUsedNames.has(newName)) {
        counter++;
        newName = `${sym}_${counter}`;
      }

      if (localSymbols.includes(sym)) {
        currentFileMangleMap.set(sym, newName);
      } else {
        currentLocalMangleMap.set(sym, newName);
      }
      bundleUsedNames.add(newName);
    } else {
      bundleUsedNames.add(sym);

      if (localSymbols.includes(sym)) {
        currentFileMangleMap.set(sym, sym);
      } else {
        currentLocalMangleMap.set(sym, sym);
      }
    }
  }

  bundleMangleMap.set(basePath, currentFileMangleMap);
  fileLocalMangleMap.set(basePath, currentLocalMangleMap);

  function addExternalImport(varName: string, modulePath: string) {
    const mangledName = currentLocalMangleMap.get(varName) || varName;
    externalImportSet.add(`const ${mangledName} = require('${modulePath}');`);
  }

  function processImportDeclaration(node: ImportDeclaration): Node | null {
    const importPath = node.source.value;
    if (excludedExtensions.includes(extname(importPath))) return null;

    let resolvedPath = importPath.startsWith('.') ? resolve(dirname(basePath), importPath) : resolveImportPath(importPath, tsConfig);
    resolvedPath = resolvePathWithExtension(resolvedPath);

    if (!existsSync(resolvedPath)) {
      if (!externalImportMap.has(importPath)) {
        externalImportMap.set(importPath, new Set());
      }
      const set = externalImportMap.get(importPath)!;

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          const mangled = currentLocalMangleMap.get(specifier.local.value) || specifier.local.value;
          set.add({ type: 'default', mangled });
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          const mangled = currentLocalMangleMap.get(specifier.local.value) || specifier.local.value;
          set.add({ type: 'namespace', mangled });
        } else if (specifier.type === 'ImportSpecifier') {
          const original = specifier.imported?.value ?? specifier.local.value;
          const mangled = currentLocalMangleMap.get(specifier.local.value) || specifier.local.value;
          set.add({ type: 'named', original, mangled });
        }
      }
    } else {
      processInternalModule(resolvedPath);

      const declarations: string[] = [];
      const sourceMangleMap = bundleMangleMap.get(resolvedPath);

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          const mangledDefault = fileDefaultExportMap.get(resolvedPath);
          const localName = specifier.local.value;
          const mangledLocal = currentLocalMangleMap.get(localName) || localName;
          if (mangledDefault) {
            declarations.push(`const ${mangledLocal} = ${mangledDefault};`);
          }
        } else if (specifier.type === 'ImportSpecifier') {
          const originalName = specifier.imported?.value ?? specifier.local.value;
          const mangledName = sourceMangleMap?.get(originalName) || originalName;
          const localName = specifier.local.value;
          const mangledLocal = currentLocalMangleMap.get(localName) || localName;
          declarations.push(`const ${mangledLocal} = ${mangledName};`);
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          const localName = specifier.local.value;
          const mangledLocal = currentLocalMangleMap.get(localName) || localName;
          declarations.push(`const ${mangledLocal} = require('${resolvedPath}');`);
        }
      }

      if (declarations.length > 0) {
        bundleStack.push(declarations.join('\n'));
      }
    }
    return null;
  }

  function processVariableDeclaration(node: VariableDeclaration): Node | null {
    const declaration = node.declarations[0];
    if (declaration?.init?.type !== 'CallExpression') return node;
    if ((declaration.init.callee as Identifier).value !== 'require') return node;

    const requirePath = (declaration.init.arguments[0].expression as Identifier).value;
    let resolvedPath = requirePath.startsWith('.') ? resolve(dirname(basePath), requirePath) : resolveImportPath(requirePath, tsConfig);
    resolvedPath = resolvePathWithExtension(resolvedPath);

    if (!existsSync(resolvedPath)) {
      if (declaration.id.type === 'Identifier') {
        addExternalImport(declaration.id.value, requirePath);
      } else if (declaration.id.type === 'ObjectPattern') {
        const properties = (declaration.id as any).properties
          .map((prop: ObjectPatternProperty) => {
            if (prop.type === 'AssignmentPatternProperty' && prop.key.type === 'Identifier') {
              const original = prop.key.value;
              const mangled = currentLocalMangleMap.get(original) || original;
              return mangled === original ? original : `${original}: ${mangled}`;
            } else if (prop.type === 'KeyValuePatternProperty' && prop.key.type === 'Identifier') {
              const original = prop.key.value;
              const localName = prop.value.type === 'Identifier' ? prop.value.value : original;
              const mangled = currentLocalMangleMap.get(localName) || localName;
              return `${original}: ${mangled}`;
            }
            return '';
          })
          .filter(Boolean)
          .join(', ');
        externalImportSet.add(`const { ${properties} } = require('${requirePath}');`);
      }
    } else {
      processInternalModule(resolvedPath);

      const sourceMangleMap = bundleMangleMap.get(resolvedPath);
      if (declaration.id.type === 'Identifier') {
        const localName = declaration.id.value;
        const mangledNameInSource = sourceMangleMap?.get(localName) || localName;
        const mangledLocal = currentLocalMangleMap.get(localName) || localName;
        bundleStack.push(`const ${mangledLocal} = ${mangledNameInSource};`);
      } else if (declaration.id.type === 'ObjectPattern') {
        for (const prop of (declaration.id as any).properties) {
          if (prop.type === 'AssignmentPatternProperty' && prop.key.type === 'Identifier') {
            const originalName = prop.key.value;
            const mangledName = sourceMangleMap?.get(originalName) || originalName;
            const localName = prop.key.value;
            const mangledLocal = currentLocalMangleMap.get(localName) || localName;
            bundleStack.push(`const ${mangledLocal} = ${mangledName};`);
          }
        }
      }
    }
    return null;
  }

  function processInternalModule(resolvedPath: string): void {
    const dependencySource = readFileCached(resolvedPath);
    const depExt = extname(resolvedPath);
    const depCode = jsExtensions.includes(depExt) ? dependencySource : transformer(dependencySource, depExt, resolvedPath);
    fullCodeGen(depCode, resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);
  }

  function visit(node: any, isProperty: boolean = false): any {
    if (!node) return node;
    if (Array.isArray(node)) {
      // PREFETCH: Load all potential imports in parallel before processing serially
      prefetchImports(node, basePath, tsConfig);

      const newArray: any[] = [];
      for (const item of node) {
        const result = visit(item);
        if (result) {
          if (Array.isArray(result)) newArray.push(...result);
          else newArray.push(result);
        }
      }
      return newArray;
    }

    if (typeof node === 'object' && node !== null) {
      if ('type' in node && node.type === 'Identifier' && !isProperty) {
        const idNode = node as Identifier;

        const localMangled = currentLocalMangleMap.get(idNode.value);
        if (localMangled) {
          return { ...idNode, value: localMangled } as Identifier;
        }

        const mangled = currentFileMangleMap.get(idNode.value);
        if (mangled) {
          return { ...idNode, value: mangled } as Identifier;
        }
      }

      let targetNode: any = node;
      if ('type' in node && isHandledNode(node as Node)) {
        targetNode = transformNode(node as Node);
        if (!targetNode) return null;
        if (Array.isArray(targetNode)) return targetNode;
      }

      const obj = targetNode;
      let hasChange = false;
      const newProps: Record<string, any> = {};

      for (const key in obj) {
        if (ignoredKeys.has(key)) continue;

        const value = obj[key];
        if (typeof value === 'object' && value !== null) {
          // Avoid mangling property names in MemberExpression or keys in ObjectProperty
          let childIsProperty = false;
          if ('type' in obj && obj.type === 'MemberExpression' && key === 'property') {
            const member = obj as MemberExpression;
            if (member.property.type !== 'Computed') {
              childIsProperty = true;
            }
          }
          if ('type' in obj && obj.type === 'KeyValuePatternProperty' && key === 'key') {
            const prop = obj as KeyValuePatternProperty;
            if (prop.key.type !== 'Computed') {
              childIsProperty = true;
            }
          }
          if ('type' in obj && obj.type === 'KeyValueProperty' && key === 'key') {
            const prop = obj as KeyValueProperty;
            if (prop.key.type !== 'Computed') {
              childIsProperty = true;
            }
          }

          const processed = visit(value, childIsProperty);
          if (processed !== value) {
            hasChange = true;
            newProps[key] = processed;
          }
        }
      }

      if (hasChange) {
        return { ...obj, ...newProps } as Node;
      }
      return obj;
    }

    return node;
  }

  function transformNode(node: Node): Node | Node[] | null {
    if (!isHandledNode(node)) return node;

    switch (node.type) {
      case 'ImportDeclaration':
        return processImportDeclaration(node);

      case 'VariableDeclaration':
        return processVariableDeclaration(node);

      case 'ExportDeclaration': {
        const decl = node.declaration;
        if (!isEntryPoint) return decl;

        let id: string | null = null;
        if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          id = (decl as FunctionDeclaration | ClassDeclaration).identifier?.value || null;
        } else if (decl.type === 'VariableDeclaration' && decl.declarations[0]?.id.type === 'Identifier') {
          id = (decl.declarations[0].id as Identifier).value;
        }

        return id ? [decl, createExportAssignment(id, id, node.span)] : decl;
      }

      case 'ExportNamedDeclaration': {
        if (!node.specifiers?.length) return null;

        const results = node.specifiers
          .map(spec => {
            if (spec.type === 'ExportSpecifier') {
              const exportedName = spec.exported ? (spec.exported as Identifier).value : (spec.orig as Identifier).value;
              const localName = (spec.orig as Identifier).value;
              return createExportAssignment(exportedName, localName, node.span);
            }
            return null;
          })
          .filter(Boolean) as Node[];

        return results.length === 1 ? results[0] : results;
      }

      case 'ExportDefaultExpression': {
        const expression = node.expression;
        let exportedName = '';
        if (expression.type === 'Identifier') {
          exportedName = currentFileMangleMap.get(expression.value) || expression.value;
        }

        if (exportedName) {
          fileDefaultExportMap.set(basePath, exportedName);
        }

        if (!isEntryPoint) {
          return { type: 'ExpressionStatement', span: node.span, expression } as ExpressionStatement;
        }

        if (expression.type === 'Identifier') {
          return createExportAssignment('default', exportedName, node.span);
        }

        return {
          type: 'ExpressionStatement',
          span: node.span,
          expression: {
            type: 'AssignmentExpression',
            span: node.span,
            operator: '=',
            left: {
              type: 'MemberExpression',
              span: node.span,
              object: {
                type: 'MemberExpression',
                span: node.span,
                object: { type: 'Identifier', value: 'module', span: node.span, ctxt: 0, optional: false },
                property: { type: 'Identifier', value: 'exports', span: node.span, ctxt: 0, optional: false },
              },
              property: { type: 'Identifier', value: 'default', span: node.span, ctxt: 0, optional: false },
            },
            right: expression,
          },
        } as ExpressionStatement;
      }

      case 'ExportDefaultDeclaration': {
        const decl = node.decl;
        if (decl.type === 'FunctionExpression' || decl.type === 'ClassExpression') {
          const id = decl.identifier?.value;
          if (id) {
            const mangled = currentFileMangleMap.get(id) || id;
            fileDefaultExportMap.set(basePath, mangled);
          }
        }
        return decl;
      }

      case 'ExportAllDeclaration': {
        const exportPath = node.source.value;
        let resolvedPath = exportPath.startsWith('.') ? resolve(dirname(basePath), exportPath) : resolveImportPath(exportPath, tsConfig);
        resolvedPath = resolvePathWithExtension(resolvedPath);

        if (existsSync(resolvedPath)) {
          processInternalModule(resolvedPath);
        }
        return null;
      }

      case 'TsExportAssignment': {
        const expression = node.expression;
        if (expression.type === 'Identifier') {
          const mangled = currentFileMangleMap.get(expression.value) || expression.value;
          fileDefaultExportMap.set(basePath, mangled);
        }

        return {
          type: 'ExpressionStatement',
          expression: {
            type: 'AssignmentExpression',
            operator: '=',
            left: {
              type: 'MemberExpression',
              object: { type: 'Identifier', value: 'module', span: node.span },
              property: { type: 'Identifier', value: 'exports', span: node.span },
              span: node.span,
            },
            right: expression,
            span: node.span,
          },
          span: node.span,
        } as ExpressionStatement;
      }

      case 'TsNamespaceExportDeclaration':
        return null;

      case 'ExpressionStatement': {
        if (node.expression.type === 'AssignmentExpression') {
          const { left, right } = node.expression;
          if (left.type === 'MemberExpression') {
            const obj = (left.object as Identifier).value;
            const prop = (left.property as Identifier).value;

            if (obj === 'module' && prop === 'exports') {
              return right.type.endsWith('Declaration') ? right : ({ type: 'ExpressionStatement', expression: right, span: node.span } as ExpressionStatement);
            } else if (obj === 'exports' && right.type === 'FunctionExpression' && right.identifier) {
              return {
                type: 'FunctionDeclaration',
                identifier: right.identifier,
                params: right.params,
                body: right.body,
                async: right.async,
                generator: right.generator,
                span: node.span,
                declare: false,
                ctxt: 0,
              } as FunctionDeclaration;
            }
          }
        }
        break;
      }

      case 'CallExpression': {
        if (node.callee.type === 'Import') {
          return {
            ...node,
            callee: { type: 'Identifier', value: 'require', span: node.callee.span, ctxt: 0, optional: false },
          } as CallExpression;
        }
        break;
      }
    }

    return node;
  }

  const transformedAst = visit(ast);

  for (const [module, clauses] of externalImportMap.entries()) {
    const namedImportParts: string[] = [];
    const defaultImports: string[] = [];
    const namespaceImports: string[] = [];

    for (const clause of clauses) {
      if (clause.type === 'named') {
        if (clause.mangled && clause.original !== clause.mangled) {
          namedImportParts.push(`${clause.original}: ${clause.mangled}`);
        } else {
          namedImportParts.push(clause.original);
        }
      } else if (clause.type === 'default') {
        defaultImports.push(clause.mangled);
      } else if (clause.type === 'namespace') {
        namespaceImports.push(clause.mangled);
      }
    }

    if (namedImportParts.length > 0) {
      const uniqueParts = [...new Set(namedImportParts)];
      externalImportSet.add(`const { ${uniqueParts.join(', ')} } = require('${module}');`);
    }

    if (defaultImports.length > 0) {
      for (const name of [...new Set(defaultImports)]) {
        externalImportSet.add(`const ${name} = require('${module}');`);
      }
    }

    if (namespaceImports.length > 0) {
      for (const name of [...new Set(namespaceImports)]) {
        externalImportSet.add(`const ${name} = require('${module}');`);
      }
    }
  }

  const { code: processedCode } = printSync(transformedAst as Program);
  bundleStack.push(processedCode);
}

export function compiler(code: string, filePath: string): string {
  // Reset mangling state for each bundle
  bundleUsedNames.clear();
  bundleMangleMap.clear();
  fileDefaultExportMap.clear();
  fileLocalMangleMap.clear();

  const ext = extname(filePath);
  if (!extensions.includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext}.`);
  }

  const transformedCode = jsExtensions.includes(ext) ? code : transformer(code, ext, filePath);

  const bundleStack: string[] = [];
  const externalImportSet: Set<string> = new Set();
  const processedFiles: Set<string> = new Set();

  fullCodeGen(transformedCode, filePath, bundleStack, externalImportSet, processedFiles);

  const finalBundle = [...externalImportSet].join('\n') + '\n' + bundleStack.join('\n');

  return finalBundle;
}
