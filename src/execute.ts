import { pathToFileURL } from 'url';
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { resolve, dirname, basename, extname, join, sep } from 'path';
import { transformSync } from '@swc/core';
import { cwd } from 'process';

type LoadTSConfig = null | { paths: Record<string, string[]>; baseUrl: string };
const allTempFiles: string[] = [];

function cleanupTempFiles() {
  for (const file of allTempFiles) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    } catch (err) {
      console.warn('Failed to delete temporary file ' + file + ':', err);
    }
  }
  allTempFiles.length = 0;
}

function findProjectRoot() {
  // Return the directory when the route is reached
  let currentDir = cwd();
  while (!existsSync(join(currentDir, 'package.json'))) {
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
  } catch {
    return null;
  }
}

function transformer(source: string, ext: string) {
  const isTsx = ext === '.tsx';
  const isTypeScript = ext === '.ts' || ext === '.mts' || isTsx;
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

function resolveImportPath(importPath: string, tsConfig: LoadTSConfig) {
  if (importPath.endsWith('.cjs') || importPath.endsWith('.cts')) {
    throw new Error('rscute cannot import CommonJS files (.cjs/.cts).');
  }
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
          if (existsSync(candidatePath) || existsSync(candidatePath + '.ts') || existsSync(candidatePath + '.js')) {
            return candidatePath;
          }
        }
      }
    }
  }

  return resolve(baseDir, importPath);
}

function processImports(code: string, basePath: string) {
  return code.replace(/import\s+(?:.*?from\s+)?['"]([^'"]+)['"]/g, (match, importPath) => {
    let resolvedPath = importPath;

    if (importPath.startsWith('.')) {
      resolvedPath = resolve(dirname(basePath), importPath);
    } else {
      const tsConfig = loadTsConfig();
      resolvedPath = resolveImportPath(importPath, tsConfig);
    }

    const nodeModulesPath = resolve(projectRoot, 'node_modules', importPath);

    // 1. Index in the folder
    const indexJsPath = join(nodeModulesPath, 'index.js');
    const indexMjsPath = join(nodeModulesPath, 'index.mjs');
    if (existsSync(indexJsPath)) {
      return match.replace(importPath, pathToFileURL(indexJsPath).href);
    } else if (existsSync(indexMjsPath)) {
      return match.replace(importPath, pathToFileURL(indexMjsPath).href);
    }

    // 2. Direct File Name
    const jsFilePath = nodeModulesPath + '.js';
    const mjsFilePath = nodeModulesPath + '.mjs';
    if (existsSync(jsFilePath)) {
      return match.replace(importPath, pathToFileURL(jsFilePath).href);
    } else if (existsSync(mjsFilePath)) {
      return match.replace(importPath, pathToFileURL(mjsFilePath).href);
    }

    const possibleExtensions = ['.js', '.ts', '.mjs', '.mts', '.jsx', '.tsx'];
    if (!extname(resolvedPath)) {
      for (const ext of possibleExtensions) {
        if (existsSync(resolvedPath + ext)) {
          resolvedPath += ext;
          break;
        }
      }
    }

    const ext = extname(resolvedPath);
    if (!possibleExtensions.includes(ext)) return match;
    const tempFileName = basename(resolvedPath, ext) + '-' + ext.slice(1) + '-tmp.mjs';
    const tempFilePath = join(dirname(basePath), tempFileName);

    if (existsSync(resolvedPath)) {
      const depSource = readFileSync(resolvedPath, 'utf-8');
      const depCode = transformer(depSource, ext);
      const processedDepCode = processImports(depCode, resolvedPath);
      writeFileSync(tempFilePath, processedDepCode);
      allTempFiles.push(tempFilePath);

      const fileUrl = pathToFileURL(tempFilePath).href;
      return match.replace(importPath, fileUrl);
    }

    return match;
  });
}

export async function execute(filePath: string): Promise<any> {
  // The start of absolutePath first matches the absolute path of projectRoot.
  const absoluteFilePath = resolve(filePath);
  if (!absoluteFilePath.startsWith(projectRoot + sep)) {
    throw new Error('Invalid path: must use absolute path within project:' + projectRoot);
  }

  const ext = filePath.match(/(\.(?:js|ts|mjs|mts|jsx|tsx|cjs|cts))$/)?.[1];
  if (!ext) throw new Error('Unsupported file extension');
  if (ext === '.cjs' || ext === '.cts') {
    throw new Error('Error: rscute supports only ESM (ECMAScript Modules).\n' + 'Please use .js/.ts, .mjs/.mts.\n' + 'Received a CommonJS file:' + filePath);
  }

  const source = readFileSync(absoluteFilePath, 'utf-8');
  const code = transformer(source, ext);
  const processedCode = processImports(code, absoluteFilePath);

  const tempFileName = basename(filePath, ext) + '-' + ext.slice(1) + '-tmp.mjs';
  const tempFilePath = join(dirname(absoluteFilePath), tempFileName);
  writeFileSync(tempFilePath, processedCode);
  allTempFiles.push(tempFilePath);

  const fileUrl = pathToFileURL(tempFilePath).href;

  try {
    return await import(fileUrl);
  } catch (err) {
    console.error('Execution failed:', err);
    throw err;
  } finally {
    cleanupTempFiles();
  }
}

if (process.argv[2]) {
  execute(process.argv[2]).catch(() => {
    process.exit(1);
  });
}

process.on('exit', () => {
  cleanupTempFiles();
});
