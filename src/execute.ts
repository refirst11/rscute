import {
  transformSync,
  parse,
  print,
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
} from '@swc/core';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { cwd } from 'process';

type LoadTSConfig = null | { paths: Record<string, string[]>; baseUrl: string };
type ImportClause = { type: 'named'; original: string; alias: string | null } | { type: 'default'; name: string } | { type: 'namespace'; name: string };

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
const fileCache = new Map<string, string>();
let tsConfigCache: LoadTSConfig | undefined;
let projectRootCache: string | undefined;

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

function readFileCached(path: string): string {
  if (fileCache.has(path)) return fileCache.get(path)!;
  const content = readFileSync(path, 'utf-8');
  fileCache.set(path, content);
  return content;
}

function resolvePathWithExtension(basePath: string): string {
  if (extname(basePath)) return basePath;

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (existsSync(fullPath)) return fullPath;
  }
  return basePath;
}

function resolveImportPath(importPath: string, tsConfig: LoadTSConfig): string {
  if (!tsConfig?.baseUrl) return importPath;

  const baseDir = resolve(getProjectRoot(), tsConfig.baseUrl);

  if (tsConfig.paths) {
    for (const [alias, targetPaths] of Object.entries(tsConfig.paths)) {
      const aliasPrefix = alias.replace(/\*$/, '');
      if (!importPath.startsWith(aliasPrefix)) continue;

      for (const target of targetPaths) {
        const resolvedTarget = target.replace(/\*$/, '');
        const candidatePath = resolve(baseDir, resolvedTarget + importPath.slice(aliasPrefix.length));
        const resolvedPath = resolvePathWithExtension(candidatePath);
        if (existsSync(resolvedPath)) return resolvedPath;
      }
    }
  }

  return resolve(baseDir, importPath);
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

function createExportAssignment(name: string, value: string, span: any): ExpressionStatement {
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

async function processImportDeclaration(
  node: ImportDeclaration,
  basePath: string,
  tsConfig: LoadTSConfig,
  externalImportMap: Map<string, Set<ImportClause>>,
  bundleStack: string[],
  externalImportSet: Set<string>,
  processedFiles: Set<string>,
  actualEntryPoint: string
): Promise<Node | null> {
  const importPath = node.source.value;

  if (excludedExtensions.includes(extname(importPath))) return null;

  let resolvedPath = importPath.startsWith('.') ? resolve(dirname(basePath), importPath) : resolveImportPath(importPath, tsConfig);

  resolvedPath = resolvePathWithExtension(resolvedPath);

  if (!existsSync(resolvedPath)) {
    // external module
    if (!externalImportMap.has(importPath)) {
      externalImportMap.set(importPath, new Set());
    }
    const set = externalImportMap.get(importPath)!;

    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier') {
        set.add({ type: 'default', name: specifier.local.value });
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        set.add({ type: 'namespace', name: specifier.local.value });
      } else if (specifier.type === 'ImportSpecifier') {
        set.add({
          type: 'named',
          original: specifier.imported?.value ?? specifier.local.value,
          alias: specifier.imported ? specifier.local.value : null,
        });
      }
    }
  } else {
    // internal module
    await processInternalModule(resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);

    // add variable declarations for imports
    const declarations: string[] = [];
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier') {
        const moduleName = importPath.split('/').pop()?.split('.').shift() ?? '';
        if (moduleName && specifier.local.value !== moduleName) {
          declarations.push(`const ${specifier.local.value} = ${moduleName};`);
        }
      } else if (specifier.type === 'ImportSpecifier') {
        if (specifier.imported && specifier.local.value !== specifier.imported.value) {
          declarations.push(`const ${specifier.local.value} = ${specifier.imported.value};`);
        }
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        declarations.push(`const ${specifier.local.value} = require('${resolvedPath}');`);
      }
    }

    if (declarations.length > 0) {
      bundleStack.push(declarations.join('\n'));
    }
  }

  return null;
}

async function processVariableDeclaration(
  node: VariableDeclaration,
  basePath: string,
  tsConfig: LoadTSConfig,
  externalImportSet: Set<string>,
  bundleStack: string[],
  processedFiles: Set<string>,
  actualEntryPoint: string
): Promise<Node | null> {
  const declaration = node.declarations[0];
  if (declaration?.init?.type !== 'CallExpression') return node;
  if ((declaration.init.callee as Identifier).value !== 'require') return node;

  const requirePath = (declaration.init.arguments[0].expression as Identifier).value;
  let resolvedPath = requirePath.startsWith('.') ? resolve(dirname(basePath), requirePath) : resolveImportPath(requirePath, tsConfig);

  resolvedPath = resolvePathWithExtension(resolvedPath);

  if (!existsSync(resolvedPath)) {
    // external module
    if (declaration.id.type === 'Identifier') {
      externalImportSet.add(`const ${declaration.id.value} = require('${requirePath}');`);
    } else if (declaration.id.type === 'ObjectPattern') {
      const properties = declaration.id.properties
        .map((prop: ObjectPatternProperty) => {
          if (prop.type === 'AssignmentPatternProperty') {
            return (prop.key as Identifier).value;
          } else if (prop.type === 'KeyValuePatternProperty') {
            return `${(prop.key as Identifier).value}: ${(prop.value as Identifier).value}`;
          }
          return '';
        })
        .filter(Boolean)
        .join(', ');
      externalImportSet.add(`const { ${properties} } = require('${requirePath}');`);
    }
  } else {
    await processInternalModule(resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);
  }

  return null;
}

async function processInternalModule(
  resolvedPath: string,
  bundleStack: string[],
  externalImportSet: Set<string>,
  processedFiles: Set<string>,
  actualEntryPoint: string
): Promise<void> {
  const dependencySource = readFileCached(resolvedPath);
  const depExt = extname(resolvedPath);
  const depCode = jsExtensions.includes(depExt) ? dependencySource : transformer(dependencySource, depExt, resolvedPath);

  await fullCodeGen(depCode, resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);
}

async function fullCodeGen(
  code: string,
  basePath: string,
  bundleStack: string[],
  externalImportSet: Set<string>,
  processedFiles: Set<string> = new Set(),
  entryPoint?: string
): Promise<void> {
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
  const ast = await parse(code, { syntax: isTs ? 'typescript' : 'ecmascript', tsx: ext.endsWith('tsx') });

  async function visit(node: Node): Promise<Node | Node[] | null> {
    if (!node) return node;
    if (Array.isArray(node)) {
      const newArray: Node[] = [];
      for (const item of node) {
        const result = await visit(item);
        if (result) {
          newArray.push(...(Array.isArray(result) ? result : [result]));
        }
      }
      return newArray;
    }

    if (typeof node === 'object' && 'type' in node) {
      const transformedNode = await transformNode(node);
      if (!transformedNode) return null;
      if (Array.isArray(transformedNode)) return transformedNode;

      const newNode: Record<string, any> = {};
      for (const key in transformedNode) {
        if (Object.prototype.hasOwnProperty.call(transformedNode, key)) {
          newNode[key] = await visit((transformedNode as any)[key]);
        }
      }
      return newNode as Node;
    }

    return node;
  }

  async function transformNode(node: Node): Promise<Node | Node[] | null> {
    if (!isHandledNode(node)) return node;

    switch (node.type) {
      case 'ImportDeclaration':
        return processImportDeclaration(node, basePath, tsConfig, externalImportMap, bundleStack, externalImportSet, processedFiles, actualEntryPoint);

      case 'VariableDeclaration':
        return processVariableDeclaration(node, basePath, tsConfig, externalImportSet, bundleStack, processedFiles, actualEntryPoint);

      case 'ExportDeclaration': {
        const decl = node.declaration;
        if (!isEntryPoint) return decl;

        let id: string | null = null;
        if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          id = decl.identifier?.value || null;
        } else if (decl.type === 'VariableDeclaration' && decl.declarations[0]?.id.type === 'Identifier') {
          id = decl.declarations[0].id.value;
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
        if (!isEntryPoint) {
          return { type: 'ExpressionStatement', span: node.span, expression } as ExpressionStatement;
        }

        if (expression.type === 'Identifier') {
          return createExportAssignment('default', expression.value, node.span);
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

      case 'ExportDefaultDeclaration':
        return node.decl;

      case 'ExportAllDeclaration': {
        const exportPath = node.source.value;
        let resolvedPath = exportPath.startsWith('.') ? resolve(dirname(basePath), exportPath) : resolveImportPath(exportPath, tsConfig);
        resolvedPath = resolvePathWithExtension(resolvedPath);

        if (existsSync(resolvedPath)) {
          await processInternalModule(resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);
        }
        return null;
      }

      case 'TsExportAssignment': {
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
            right: node.expression,
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

  const transformedAst = await visit(ast);

  for (const [module, clauses] of externalImportMap.entries()) {
    const namedImportParts: string[] = [];
    const defaultImports: string[] = [];
    const namespaceImports: string[] = [];

    for (const clause of clauses) {
      if (clause.type === 'named') {
        if (clause.alias && clause.original !== clause.alias) {
          namedImportParts.push(`${clause.original}: ${clause.alias}`);
        } else {
          namedImportParts.push(clause.original);
        }
      } else if (clause.type === 'default') {
        defaultImports.push(clause.name);
      } else if (clause.type === 'namespace') {
        namespaceImports.push(clause.name);
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

  const { code: processedCode } = await print(transformedAst as Program);
  bundleStack.push(processedCode);
}

async function _execute(code: string, filePath: string): Promise<any> {
  const ext = extname(filePath);
  if (!extensions.includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext}.`);
  }

  const transformedCode = jsExtensions.includes(ext) ? code : transformer(code, ext, filePath);

  const bundleStack: string[] = [];
  const externalImportSet: Set<string> = new Set();
  const processedFiles: Set<string> = new Set();

  await fullCodeGen(transformedCode, filePath, bundleStack, externalImportSet, processedFiles);

  const finalBundle = [...externalImportSet].join('\n') + '\n' + bundleStack.join('\n');
  const moduleObj = { exports: {} };

  const scriptFunction = new Function('require', 'console', 'process', '__dirname', '__filename', 'module', 'exports', finalBundle);
  scriptFunction(require, console, process, dirname(filePath), filePath, moduleObj, moduleObj.exports);

  return moduleObj.exports;
}

export async function execute(filePath: string): Promise<any> {
  const source = readFileCached(filePath);
  return _execute(source, filePath);
}

export async function executeCode(code: string, options?: { filePath?: string }): Promise<any> {
  const filePath = options?.filePath ?? resolve(process.cwd(), 'inline.ts');
  return _execute(code, filePath);
}
