import { pathToFileURL } from 'url';
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
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
      console.warn(`Failed to delete temporary file ${file}:`, err);
    }
  }
  allTempFiles.length = 0;
}

function findProjectRoot() {
  // Return the original cwd when the route is reached
  let currentDir = cwd();
  while (!existsSync(join(currentDir, 'package.json')) && !existsSync(join(currentDir, 'tsconfig.json'))) {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return cwd();
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

const tsConfig = loadTsConfig();

function processImports(code: string, basePath: string) {
  return code.replace(
    /import\s+(?:(?:[\w*\s{},]+\s+from\s+)|(?:(?:(?:\{[^}]*\})|(?:[^{}\s,]+))?\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[^{}\s,]+))?\s+from\s+))?['"]([^'"]+)['"]/g,
    (match, importPath) => {
      let resolvedPath = importPath;

      if (importPath.startsWith('.')) {
        resolvedPath = resolve(dirname(basePath), importPath);
      } else {
        resolvedPath = resolveImportPath(importPath, tsConfig);
      }

      let isTsx = false;
      if (!extname(resolvedPath)) {
        const possibleExtensions = ['.ts', '.js', '.mts', '.mjs', '.jsx', '.tsx'];
        for (const ext of possibleExtensions) {
          if (existsSync(resolvedPath + ext)) {
            resolvedPath += ext;
            isTsx = ext === '.tsx';
            break;
          }
        }
      } else {
        isTsx = resolvedPath.endsWith('.tsx');
      }

      const tempFileName = `${basename(resolvedPath, extname(resolvedPath))}-copy.mjs`;
      const tempFilePath = join(dirname(basePath), tempFileName);

      if (existsSync(resolvedPath)) {
        const dependencySource = readFileSync(resolvedPath, 'utf-8');
        let processedDepCode = dependencySource;

        if (resolvedPath.endsWith('.ts') || resolvedPath.endsWith('.mts') || isTsx) {
          const { code: depCode } = transformSync(dependencySource, {
            jsc: {
              parser: { syntax: 'typescript', tsx: isTsx },
              target: 'es2022',
            },
          });
          processedDepCode = depCode;
        }

        processedDepCode = processImports(processedDepCode, resolvedPath);
        writeFileSync(tempFilePath, processedDepCode);
        allTempFiles.push(tempFilePath);

        const fileUrl = pathToFileURL(tempFilePath).href;
        return match.replace(importPath, fileUrl);
      }

      return match;
    }
  );
}

export async function execute(filePath: string): Promise<unknown> {
  const ext = filePath.match(/\.(ts|js|mts|mjs|tsx|jsx|cjs|cts)$/)?.[1];
  if (!ext) throw new Error('Unsupported file extension');
  if (ext === 'cjs' || ext === 'cts') {
    throw new Error(`Error: rscute supports only ESM (ECMAScript Modules).\n` + `Please use .js/.ts, .mjs/.mts.\n` + `Received a CommonJS file: ${filePath}`);
  }

  const absoluteFilePath = resolve(filePath);
  const source = readFileSync(absoluteFilePath, 'utf-8');
  const isModule = ext === 'mjs' || ext === 'mts' || ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx';
  const isTsx = ext === 'tsx';

  const { code } = transformSync(source, {
    module: {
      type: 'es6',
    },
    jsc: {
      parser: { syntax: 'typescript', tsx: isTsx },
      target: 'es2022',
    },
  });

  const processedCode = processImports(code, absoluteFilePath);

  if (isModule) {
    const baseDir = dirname(absoluteFilePath);
    const tempFilePath = join(baseDir, `main-copy.mjs`);
    writeFileSync(tempFilePath, processedCode);
    allTempFiles.push(tempFilePath);

    const fileUrl = pathToFileURL(tempFilePath).href;

    try {
      return await import(fileUrl);
    } catch (err) {
      console.error('Error during execution:', err);
      throw err;
    } finally {
      cleanupTempFiles();
    }
  }
}

if (process.argv[2]) {
  execute(process.argv[2]).catch(err => {
    console.error('Execution failed:', err);
    process.exit(1);
  });
}
