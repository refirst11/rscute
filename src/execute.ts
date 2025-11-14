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
const extensions = ['.js', '.ts', '.mjs', '.mts', '.cjs', '.cts', '.jsx', '.tsx'];
const jsExtensions = ['.js', '.mjs', '.cjs', '.jsx'];

function findProjectRoot() {
  let currentDir = cwd();
  while (!existsSync(resolve(currentDir, 'package.json'))) {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return currentDir;
    currentDir = parentDir;
  }
  return currentDir;
}

const projectRoot = findProjectRoot();

function loadTsConfig(): LoadTSConfig {
  const tsConfigPath = resolve(projectRoot, 'tsconfig.json');
  if (!existsSync(tsConfigPath)) return null;
  try {
    const config = JSON.parse(readFileSync(tsConfigPath, 'utf-8'));
    return config.compilerOptions || null;
  } catch (e) {
    return null;
  }
}

function resolveImportPath(importPath: string, tsConfig: LoadTSConfig) {
  if (!tsConfig) return importPath;

  const { baseUrl, paths } = tsConfig;
  if (!baseUrl) return importPath;

  const baseDir = resolve(projectRoot, baseUrl);

  if (paths) {
    for (const [alias, targetPaths] of Object.entries(paths)) {
      const aliasPrefix = alias.replace(/\*$/, '');
      if (importPath.startsWith(aliasPrefix)) {
        for (const target of targetPaths) {
          const resolvedTarget = target.replace(/\*$/, '');
          const candidatePath = resolve(baseDir, resolvedTarget + importPath.slice(aliasPrefix.length));
          for (const ext of extensions) {
            if (existsSync(candidatePath + ext)) {
              return candidatePath + ext;
            }
          }

          if (existsSync(candidatePath)) {
            return candidatePath;
          }
        }
      }
    }
  }

  return resolve(baseDir, importPath);
}

const transformCache = new Map<string, string>();
function transformer(source: string, ext: string, filePath: string) {
  if (transformCache.has(filePath)) return transformCache.get(filePath)!;
  const { code } = transformSync(source, {
    sourceMaps: false,
    module: {
      type: 'es6',
    },
    jsc: {
      parser: { syntax: 'typescript', tsx: ext.endsWith('tsx') },
      target: 'es2022',
      transform: {
        react: {
          runtime: 'automatic',
        },
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

  if (processedFiles.has(basePath)) {
    return;
  }
  processedFiles.add(basePath);

  const tsConfig = loadTsConfig();
  type ImportClause = { type: 'named'; original: string; alias: string | null } | { type: 'default'; name: string } | { type: 'namespace'; name: string };
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
          if (Array.isArray(result)) {
            newArray.push(...result);
          } else {
            newArray.push(result);
          }
        }
      }

      return newArray;
    }

    if (typeof node === 'object' && 'type' in node) {
      const transformedNode = await transformNode(node);

      if (!transformedNode) return null;

      if (Array.isArray(transformedNode)) return transformedNode;

      const newNode: { [key: string]: any } = {};

      for (const key in transformedNode) {
        if (Object.prototype.hasOwnProperty.call(transformedNode, key)) {
          newNode[key] = await visit((transformedNode as any)[key] as Node);
        }
      }

      return newNode as Node;
    }

    return node;
  }

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
        right: { type: 'Identifier', value: value, span, ctxt: 0, optional: false },
      },
    } as ExpressionStatement;
  }

  function isHandledNode(node: Node): node is HandledNode {
    return handledNodeTypes.has(node.type);
  }

  async function transformNode(node: Node): Promise<Node | Node[] | null> {
    if (!isHandledNode(node)) {
      return node;
    }

    switch (node.type) {
      case 'ImportDeclaration': {
        const importPath = node.source.value;
        const excludedExtensions = ['.svg', '.bmp', '.ico', '.gif', '.png', '.jpeg', '.jpg', '.webp', '.avif', '.astro', '.vue', '.svelte', '.css', '.scss'];
        if (excludedExtensions.includes(extname(importPath))) {
          return null;
        }

        let resolvedPath = importPath.startsWith('.') ? resolve(dirname(basePath), importPath) : resolveImportPath(importPath, tsConfig);

        if (!extname(resolvedPath)) {
          for (const ext of extensions) {
            if (existsSync(resolvedPath + ext)) {
              resolvedPath += ext;

              break;
            }
          }
        }

        if (!existsSync(resolvedPath)) {
          if (!externalImportMap.has(importPath)) externalImportMap.set(importPath, new Set());

          const set = externalImportMap.get(importPath)!;

          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportDefaultSpecifier') set.add({ type: 'default', name: specifier.local.value });
            else if (specifier.type === 'ImportNamespaceSpecifier') set.add({ type: 'namespace', name: specifier.local.value });
            else if (specifier.type === 'ImportSpecifier') {
              if (specifier.imported) {
                set.add({ type: 'named', original: specifier.imported.value, alias: specifier.local.value });
              } else {
                set.add({ type: 'named', original: specifier.local.value, alias: null });
              }
            }
          }
        } else {
          // Internal module processing
          const dependencySource = readFileSync(resolvedPath, 'utf-8');
          const depExt = extname(resolvedPath);
          const depCode = jsExtensions.includes(depExt) ? dependencySource : transformer(dependencySource, depExt, resolvedPath);
          await fullCodeGen(depCode, resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);

          // Generate variable declarations to resolve aliases and default named imports
          const declarations: string[] = [];
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportDefaultSpecifier') {
              // import DefaultName from './module' // default import handled

              // Guess the default variable name from the module name

              const moduleName = importPath.split('/').pop()?.split('.').shift() ?? '';

              if (moduleName && specifier.local.value !== moduleName) {
                declarations.push(`const ${specifier.local.value} = ${moduleName};`);
              }
            } else if (specifier.type === 'ImportSpecifier') {
              // import { original as alias } from './module' // named import handled

              if (specifier.imported && specifier.local.value !== specifier.imported.value) {
                declarations.push(`const ${specifier.local.value} = ${specifier.imported.value};`);
              }
            } else if (specifier.type === 'ImportNamespaceSpecifier') {
              // import * as x from './module' // internal module handled

              declarations.push(`const ${specifier.local.value} = require('${resolvedPath}');`);
            }
          }

          if (declarations.length > 0) {
            bundleStack.push(declarations.join('\n'));
          }
        }

        return null;
      }

      case 'VariableDeclaration': {
        const declaration = node.declarations[0];

        if (declaration?.init?.type === 'CallExpression' && (declaration.init.callee as Identifier).value === 'require') {
          const requirePath = (declaration.init.arguments[0].expression as Identifier).value;

          let resolvedPath = requirePath.startsWith('.') ? resolve(dirname(basePath), requirePath) : resolveImportPath(requirePath, tsConfig);

          if (!extname(resolvedPath)) {
            for (const ext of extensions) {
              if (existsSync(resolvedPath + ext)) {
                resolvedPath += ext;

                break;
              }
            }
          }

          if (!existsSync(resolvedPath)) {
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
            const dependencySource = readFileSync(resolvedPath, 'utf-8');
            const depExt = extname(resolvedPath);
            const depCode = jsExtensions.includes(depExt) ? dependencySource : transformer(dependencySource, depExt, resolvedPath);

            await fullCodeGen(depCode, resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);
          }

          return null;
        }

        break;
      }

      case 'ExportDeclaration': {
        const decl = node.declaration;
        if (!isEntryPoint) return decl;

        let id: string | null = null;

        if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          id = decl.identifier?.value || null;
        } else if (decl.type === 'VariableDeclaration' && decl.declarations[0]?.id.type === 'Identifier') {
          id = decl.declarations[0].id.value;
        }

        if (!id) return decl;

        return [decl, createExportAssignment(id, id, node.span)];
      }

      case 'ExportNamedDeclaration': {
        // export { a, b as c }; のような指定子付きエクスポート
        if (!node.specifiers || node.specifiers.length === 0) return null;

        const results: Node[] = [];

        for (const spec of node.specifiers) {
          if (spec.type === 'ExportSpecifier') {
            const exportedName = spec.exported ? (spec.exported as Identifier).value : (spec.orig as Identifier).value;
            const localName = (spec.orig as Identifier).value;

            results.push(createExportAssignment(exportedName, localName, node.span));
          }
        }

        return results.length === 1 ? results[0] : results;
      }

      case 'ExportDefaultExpression': {
        if (!isEntryPoint) {
          return {
            type: 'ExpressionStatement',
            span: node.span,
            expression: node.expression,
          } as ExpressionStatement;
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
            right: node.expression,
          },
        } as ExpressionStatement;
      }

      case 'ExportDefaultDeclaration': {
        return node.decl;
      }

      case 'ExportAllDeclaration': {
        const exportPath = node.source.value;

        let resolvedPath = exportPath.startsWith('.') ? resolve(dirname(basePath), exportPath) : resolveImportPath(exportPath, tsConfig);

        if (!extname(resolvedPath)) {
          for (const ext of extensions) {
            if (existsSync(resolvedPath + ext)) {
              resolvedPath += ext;

              break;
            }
          }
        }

        if (existsSync(resolvedPath)) {
          const dependencySource = readFileSync(resolvedPath, 'utf-8');
          const depExt = extname(resolvedPath);
          const depCode = jsExtensions.includes(depExt) ? dependencySource : transformer(dependencySource, depExt, resolvedPath);

          await fullCodeGen(depCode, resolvedPath, bundleStack, externalImportSet, processedFiles, actualEntryPoint);
        }

        return null;
      }

      case 'TsExportAssignment':
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

      case 'TsNamespaceExportDeclaration':
        return null;

      case 'ExpressionStatement': {
        if (node.expression.type === 'AssignmentExpression') {
          const { left, right } = node.expression;

          if (left.type === 'MemberExpression' && (left.object as Identifier).value === 'module' && (left.property as Identifier).value === 'exports') {
            if (right.type.endsWith('Declaration')) {
              return right;
            }

            return { type: 'ExpressionStatement', expression: right, span: node.span } as ExpressionStatement;
          } else if (left.type === 'MemberExpression' && (left.object as Identifier).value === 'exports') {
            if (right.type === 'FunctionExpression' && right.identifier) {
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
          return { ...node, callee: { type: 'Identifier', value: 'require', span: node.callee.span } } as CallExpression;
        }

        break;
      }

      default:
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
  const source = readFileSync(filePath, 'utf-8');
  return _execute(source, filePath);
}

export async function executeCode(code: string, options?: { filePath?: string }): Promise<any> {
  const filePath = options?.filePath ?? resolve(process.cwd(), 'inline.ts');
  return _execute(code, filePath);
}
