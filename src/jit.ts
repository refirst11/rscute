import vm from 'vm';
import { transformSync } from '@swc/core';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { cwd } from 'process';

type LoadTSConfig = null | { paths: Record<string, string[]>; baseUrl: string };
const extensions = ['.js', '.ts', '.mjs', '.mts', '.cjs', '.cts', '.jsx', '.tsx'];

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
          // Try all extensions
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

function transformer(source: string, ext: string) {
  // Return early if not TypeScript
  const isTsx = ext === '.tsx';
  const isTypeScript = ext === '.ts' || ext === '.mts' || ext === '.cts' || isTsx;
  if (!isTypeScript) return source;

  const { code } = transformSync(source, {
    module: {
      type: 'es6',
    },
    jsc: {
      parser: { syntax: 'typescript', tsx: isTsx },
      target: 'es2022',
    },
  });

  return code;
}

/*
 * As a global collection, the inlined code of relative is stored in bundleStack,
 * and the code that has been rewritten to require calls in external modules such as node_modules is stored in externalImportSet.
 */
const bundleStack: string[] = [];
const externalImportSet: Set<string> = new Set();

/*
 * The fullCodeGen function analyzes the import statements in the code passed to it.
 *
 * - For non-relative paths:
 * The import statements are rewritten to require calls, for example "const X = require('module');", and added to externalImportSet.
 *
 * - For relative paths:
 * The resolvedPath is calculated, the target file is read using readFileSync, and in the case of TypeScript, it is transpiled using SWC,
 * and then fullCodeGen is recursively applied to inline the file and stacked on the bundleStack.
 *
 * The import statements themselves are deleted as they have already been inlined.
 */
function fullCodeGen(code: string, basePath: string): string {
  const tsConfig = loadTsConfig();
  let resolvedPath: string;
  // Remove export statements
  let processedCode = code
    // Replace await import(...) → require(...)
    .replace(/await\s+import\s*\(\s*(.*?)\s*\)/g, 'require($1)')
    // module.exports = function  → function
    .replace(/(?:module\.)?exports\s*=\s*((async\s+)?function\s+\w+\s*\(.*?\)\s*\{[\s\S]*?\});?/gm, '$1')
    // module.exports = class → class
    .replace(/(?:module\.)?exports\s*=\s*(class\s+\w+\s*\{[\s\S]*?\});?/gm, '$1')
    // module.exports.XXX = function → function
    .replace(/(?:module\.)?exports\.\w+\s*=\s*((async\s+)?function\s+\w+\s*\(.*?\)\s*\{[\s\S]*?\});?/gm, '$1')
    // module.exports.XXX = class → class
    .replace(/(?:module\.)?exports\.\w+\s*=\s*(class\s+\w+\s*\{[\s\S]*?\});?/gm, '$1')
    // Remove all other module.export lines
    .replace(/(?:module\.)?exports\s*=\s*[^\n;]+;?\s*$/gm, '')
    // Convert export default function to function
    .replace(/export\s+default\s+(function\s+.*?);?\s*$/gm, '$1')
    // Convert export default class to class
    .replace(/export\s+default\s+(class\s+.*?);?\s*$/gm, '$1')
    // Remove all other export default lines
    .replace(/export\s+default\s+.*?;?\s*$/gm, '')
    // Remove only the export
    .replace(/export\s+(?!default)(.*)/g, '$1')
    // Remove the lines of the import statements that have nothing between them side-effect imports
    .replace(/import\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    // Remove import lines for image files (svg, png, jpeg, jpg, gif, webp, vue, svelte)
    .replace(/^\s*import\s+(?:.*?\s+from\s+)?['"][^'"]+\.(?:svg|png|jpeg|jpg|gif|webp|vue|svelte)['"]\s*;?\s*$/gm, '')
    // dirname is shim__dirname
    .replace(/import\.meta\.dirname/g, '__shim_dirname')
    // filename is shim__filename
    .replace(/import\.meta\.filename/g, '__shim_filename');

  const shimCode = `const __shim_dirname = __dirname;\nconst __shim_filename = __filename;\n`;

  externalImportSet.add(shimCode);

  processedCode = processedCode.replace(
    /(?:import\s+(.*?)\s+from\s+['"]([^'"]+)['"]|(?:const|let|var)\s*({[^}]+}|[\w$_]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\))\s*;?/g,
    (match, importClause, importPath, requireClause, requirePath) => {
      const dualPath = importPath || requirePath;
      if (!dualPath.startsWith('.')) {
        resolvedPath = resolveImportPath(dualPath, tsConfig);
      } else {
        // Normal resolution for relative paths
        resolvedPath = resolve(dirname(basePath), dualPath);
      }
      // If the extension is missing, check for possible extensions
      if (!extname(resolvedPath)) {
        for (const ext of extensions) {
          if (existsSync(resolvedPath + ext)) {
            resolvedPath += ext;
            break;
          }
        }
      }

      if (!existsSync(resolvedPath)) {
        // If the target file does not exist, treat it as an external module
        const requireCase = `const ${requireClause} = require('${requirePath}');`;
        const requireStatement = importPath ? convertImportToRequire(importClause, importPath) : requireCase;
        externalImportSet.add(requireStatement);
        return '';
      }

      if (!existsSync(resolvedPath)) {
        throw new Error(`Cannot resolve import ${importPath} at ${resolvedPath}`);
      }

      // Read the contents of the target file, and if it is TypeScript, transpile it using swc
      const ext = extname(resolvedPath);
      const dependencySource = readFileSync(resolvedPath, 'utf-8');
      const code = transformer(dependencySource, ext);
      // Recursively inline dependent code
      const bundledDependency = fullCodeGen(code, resolvedPath);
      bundleStack.push(bundledDependency);

      // The original import statement has been deleted because it has already been inlined
      return '';
    }
  );

  // Return code other than import statements as is
  return processedCode;
}

function convertImportToRequire(importClause: string, importPath: string): string {
  if (!importClause.startsWith('{') && !importClause.startsWith('*')) {
    // Default import: import foo from 'module' → const foo = require('module');
    return `const ${importClause} = require('${importPath}');`;
  }

  // Named imports: import { foo as bar, baz } from 'module' → const { foo: bar, baz } = require('module');
  if (importClause.startsWith('{')) {
    const namedImports = importClause
      .replace(/^{|}$/g, '') // Remove '{' and '}'
      .split(',') // Split with commas
      .map(item => {
        const [original, alias] = item.split(/\s+as\s+/).map(s => s.trim());
        return alias ? `${original}: ${alias}` : original;
      })
      .join(', ');

    return `const { ${namedImports} } = require('${importPath}');`;
  }

  // Namespace import: import * as fs from 'fs' → const fs = require('fs');
  if (importClause.startsWith('*')) {
    const namespace = importClause.replace(/^\*\s+as\s+/, '');
    return `const ${namespace} = require('${importPath}');`;
  }

  // Other cases (which usually don't come here)
  return `const ${importClause} = require('${importPath}');`;
}

/*
 * The bundleCode function takes the path to an entry file,
 * concatenates the require calls for external modules (externalImportSet), the inlined dependent code (bundleStack),
 * and the code from the entry file, and returns it as a single bundle code.
 */
export async function JIT(filePath: string): Promise<any> {
  const absoluteFilePath = resolve(filePath);
  if (!absoluteFilePath.startsWith(projectRoot + '/')) {
    throw new Error('Invalid path: must use absolute path within project:' + projectRoot);
  }

  const extMatch = filePath.match(/(\.(?:js|ts|mjs|mts|cjs|cts|jsx|tsx))$/);
  if (!extMatch) throw new Error('Unsupported file extension');

  const source = readFileSync(absoluteFilePath, 'utf-8');
  const ext = extMatch[1];
  const code = transformer(source, ext);

  // Reset stacks etc. for each call to bundleCode
  bundleStack.length = 0;
  externalImportSet.clear();

  // Inline the code in the entry file
  const mainCode = fullCodeGen(code, absoluteFilePath);

  // Finally, return the require statement for the external module and the inlined code
  const exportsObj = {};
  const context = vm.createContext({
    require, // Injecting Node.js require
    console, // console..
    process, // process..
    URL,
    Buffer,
    module: {
      exports: exportsObj,
    }, // Prepare an empty module object..
    exports: exportsObj, // instead of module.exports..
    __dirname, // required
    __filename, // required
  });
  // Set a reference to global
  context.global = context;
  // Set a reference to globalThis
  context.globalThis = context;

  const finalBundle = [...externalImportSet].join('\n') + '\n' + bundleStack.join('\n') + '\n' + mainCode.trim();
  const script = new vm.Script(finalBundle);
  script.runInContext(context);
}

if (process.argv[2]) {
  JIT(process.argv[2]).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
