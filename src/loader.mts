import { transformSync } from '@swc/core';
import { existsSync, readFileSync } from 'fs';
import { resolve as pathResolve, dirname, extname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveTsConfigPaths } from './utils.js';

const extensions = ['.ts', '.tsx', '.mts', '.js', '.jsx'];

export async function resolve(
  specifier: string,
  context: { conditions: string[]; parentURL?: string },
  nextResolve: (specifier: string, context?: any) => Promise<{ url: string; format?: string | null }>
) {
  const { parentURL } = context;

  // Try resolving via tsconfig paths if it is not relative/absolute
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    const parentPath = parentURL ? fileURLToPath(parentURL) : process.cwd();
    const resolvedPath = resolveTsConfigPaths(specifier, dirname(parentPath));
    if (resolvedPath) {
      return {
        url: pathToFileURL(resolvedPath).href,
        shortCircuit: true,
      };
    }
  }

  // Only handle relative or absolute specifiers
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parentPath = parentURL ? fileURLToPath(parentURL) : process.cwd();
    const targetPath = specifier.startsWith('/')
      ? specifier
      : pathResolve(dirname(parentPath), specifier);

    // 1. Try appending extensions
    for (const ext of extensions) {
      const pathWithExt = targetPath + ext;
      if (existsSync(pathWithExt)) {
        return {
          url: pathToFileURL(pathWithExt).href,
          shortCircuit: true,
        };
      }
    }

    // 2. Check if the exact path exists and is a directory (resolve index files)
    if (existsSync(targetPath)) {
      for (const ext of extensions) {
        const indexFile = pathResolve(targetPath, `index${ext}`);
        if (existsSync(indexFile)) {
          return {
            url: pathToFileURL(indexFile).href,
            shortCircuit: true,
          };
        }
      }
    }

    // 3. Handle TS file import mapped to JS (e.g. import './foo.js' when only './foo.ts' exists)
    const currentExt = extname(targetPath);
    if (currentExt === '.js' || currentExt === '.jsx') {
      const baseWithoutExt = targetPath.slice(0, -currentExt.length);
      for (const tsExt of ['.ts', '.tsx', '.mts', '.cts']) {
        const pathWithTsExt = baseWithoutExt + tsExt;
        if (existsSync(pathWithTsExt)) {
          return {
            url: pathToFileURL(pathWithTsExt).href,
            shortCircuit: true,
          };
        }
      }
    }
  }

  // Fallback to default resolver
  return nextResolve(specifier, context);
}

export async function load(
  url: string,
  context: { format: string | null; importAttributes?: Record<string, string> },
  nextLoad: (url: string, context?: any) => Promise<{ format: string; source: string | ArrayBuffer | SharedArrayBuffer }>
) {
  if (url.startsWith('file:')) {
    const filePath = fileURLToPath(url);
    if (!filePath.includes('node_modules')) {
      const ext = extname(filePath);
      if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
        const source = readFileSync(filePath, 'utf8');
        const format = ext === '.cts' ? 'commonjs' : 'module';

        const { code } = transformSync(source, {
          filename: filePath,
          sourceMaps: 'inline',
          jsc: {
            parser: {
              syntax: 'typescript',
              tsx: ext === '.tsx',
            },
            target: 'es2022',
          },
          module: {
            type: ext === '.cts' ? 'commonjs' : 'es6',
          },
        });

        return {
          format,
          source: code,
          shortCircuit: true,
        };
      }
    }
  }

  return nextLoad(url, context);
}
