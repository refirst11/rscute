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

  const isTsx = ext === '.tsx';
  const isTypeScript = ext === '.ts' || ext === '.mts' || ext === '.cts' || isTsx;
  if (!isTypeScript) return source;

  const { code } = transformSync(source, {
    sourceMaps: false,
    module: {
      type: 'es6',
    },
    jsc: {
      parser: { syntax: 'typescript', tsx: isTsx },
      target: 'es2022',
    },
  });
  transformCache.set(filePath, code);
  return code;
}

const bundleStack: string[] = [];
const externalImportSet: Set<string> = new Set();

function fullCodeGen(code: string, basePath: string): string {
  const tsConfig = loadTsConfig();
  let resolvedPath: string;
  let processedCode = code
    // Replace await import(...) → require(...)
    .replace(/await\s+import\s*\(\s*(.*?)\s*\)/g, 'require($1)')
    // Convert (module.?)exports = function  → function
    .replace(/(?:module\.)?exports\s*=\s*((async\s+)?function\s+\w+\s*\(.*?\)\s*\{[\s\S]*?\});?/gm, '$1')
    // Convert (module.?)exports = class → class
    .replace(/(?:module\.)?exports\s*=\s*(class\s+\w+\s*\{[\s\S]*?\});?/gm, '$1')
    // Convert (module.?)exports.XXX = function → function
    .replace(/(?:module\.)?exports\.\w+\s*=\s*((async\s+)?function\s+\w+\s*\(.*?\)\s*\{[\s\S]*?\});?/gm, '$1')
    // Convert (module.?)exports.XXX = class → class
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
    .replace(/^\s*import\s+(?:.*?\s+from\s+)?['"][^'"]+\.(?:svg|bmp|ico|gif|png|jpeg|jpg|webp|avif|astro|vue|svelte|css|scss)['"]\s*;?\s*$/gm, '')
    // dirname is shim__dirname
    .replace(/import\.meta\.dirname/g, '__shim_dirname')
    // filename is shim__filename
    .replace(/import\.meta\.filename/g, '__shim_filename');

  const shim = `const __shim_dirname = __dirname;\nconst __shim_filename = __filename;\n`;

  externalImportSet.add(shim);

  processedCode = processedCode.replace(
    /(?:import\s+(.*?)\s+from\s+['"]([^'"]+)['"]|(?:const|let|var)\s*({[^}]+}|[\w$_]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\))\s*;?/g,
    (_match, importClause, importPath, requireClause, requirePath) => {
      const paths = importPath || requirePath;

      if (!paths.startsWith('.')) {
        resolvedPath = resolveImportPath(paths, tsConfig);
      } else {
        resolvedPath = resolve(dirname(basePath), paths);
      }

      if (!extname(resolvedPath)) {
        for (const ext of extensions) {
          if (existsSync(resolvedPath + ext)) {
            resolvedPath += ext;
            break;
          }
        }
      }

      if (!existsSync(resolvedPath)) {
        const requireCase = `const ${requireClause} = require('${requirePath}');`;
        const requireStatement = importPath ? convertImportToRequire(importClause, importPath) : requireCase;
        externalImportSet.add(requireStatement);
        return '';
      }
      const ext = extname(resolvedPath);

      if (ext === '.tsx' || ext === '.jsx') {
        // The dependent React Component does not expand or call the code.
        // This is because you cannot expand tsx components within js, but it is important not to open the scope of tsx itself.
        // This is because the scope of tsx is opened and the side effects are executed.
        // The side effects of tsx are executed directly through JIT().
        /*
        React JSX is scoped and treated as a `component` which acts as a DOM and confines side effects, so expanding JSX side effects into code is the same as opening the scope.
        In other words, rscute can process the side effects of tsx, but cannot treat it as a component.
        If you want to call tsx from tsx as a side effect, you can call it as ts and expand it into code as a dependency.
        */
        return '';
      }

      if (!existsSync(resolvedPath)) {
        throw new Error(`Cannot resolve import ${importPath} at ${resolvedPath}`);
      }

      const dependencySource = readFileSync(resolvedPath, 'utf-8');
      const code = transformer(dependencySource, ext, resolvedPath);
      const bundledDependency = fullCodeGen(code, resolvedPath);
      bundleStack.push(bundledDependency);

      return '';
    }
  );

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
      .replace(/^{|}$/g, '')
      .split(',')
      .map(item => {
        const [original, alias] = item.split(/\s+as\s+/).map(s => s.trim());
        return alias ? `${original}: ${alias}` : original;
      })
      .join(', ');

    return `const { ${namedImports} } = require('${importPath}');`;
  }

  // Namespace import (ESM): import * as foo from 'module' → const foo = require('module');
  if (importClause.startsWith('*')) {
    const namespace = importClause.replace(/^\*\s+as\s+/, '');
    return `const ${namespace} = require('${importPath}');`;
  }

  return `const ${importClause} = require('${importPath}');`;
}

export async function JIT(filePath: string): Promise<any> {
  const absoluteFilePath = resolve(filePath);
  if (!absoluteFilePath.startsWith(projectRoot + '/')) {
    throw new Error('Invalid path: must use absolute path within project:' + projectRoot);
  }

  const extMatch = filePath.match(/(\.(?:js|ts|mjs|mts|cjs|cts|jsx|tsx))$/);
  if (!extMatch) throw new Error('Unsupported file extension');

  const source = readFileSync(absoluteFilePath, 'utf-8');
  const ext = extMatch[1];
  const code = transformer(source, ext, absoluteFilePath);

  bundleStack.length = 0;
  externalImportSet.clear();

  const exportsObj = {};
  const context = vm.createContext({
    require,
    console,
    process,
    URL,
    Buffer,
    module: {
      exports: exportsObj,
    },
    exports: exportsObj,
  });
  context.global = context;
  context.globalThis = context;
  context.__dirname = __dirname;
  context.__filename = __filename;

  const mainCode = fullCodeGen(code, absoluteFilePath);
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
