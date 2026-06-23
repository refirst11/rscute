import { readFileSync, existsSync } from 'fs';
import { Module } from 'module';
import { transformSync } from '@swc/core';
import { register as registerLoader } from 'module';
import { pathToFileURL } from 'url';
import { resolve as pathResolve, dirname, join } from 'path';
import { resolveTsConfigPaths } from './utils';

export function register() {
  const requireExt = (Module as any)._extensions;
  const targetExtensions = ['.ts', '.tsx', '.cts'];
  const extensionsToResolve = ['.ts', '.tsx', '.cts', '.cjs', '.js'];

  // 1. Hook Module._resolveFilename to resolve TS/CTS/CJS files without extensions
  const originalResolveFilename = (Module as any)._resolveFilename;
  (Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
    const parentPath = parent && parent.filename ? parent.filename : process.cwd();

    if (!request.startsWith('.') && !request.startsWith('/')) {
      const resolvedPath = resolveTsConfigPaths(request, dirname(parentPath));
      if (resolvedPath) {
        return originalResolveFilename.call(this, resolvedPath, parent, isMain, options);
      }
    }

    if (request.startsWith('.') || request.startsWith('/')) {
      const targetPath = request.startsWith('/') ? request : pathResolve(dirname(parentPath), request);

      for (const ext of extensionsToResolve) {
        const pathWithExt = targetPath + ext;
        if (existsSync(pathWithExt)) {
          return originalResolveFilename.call(this, pathWithExt, parent, isMain, options);
        }
      }

      if (existsSync(targetPath)) {
        for (const ext of extensionsToResolve) {
          const indexFile = join(targetPath, `index${ext}`);
          if (existsSync(indexFile)) {
            return originalResolveFilename.call(this, indexFile, parent, isMain, options);
          }
        }
      }
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  // 2. Register CJS hooks
  targetExtensions.forEach(ext => {
    const originalLoader = requireExt[ext];
    requireExt[ext] = function (module: any, filename: string) {
      if (filename.includes('node_modules')) {
        return originalLoader ? originalLoader(module, filename) : requireExt['.js'](module, filename);
      }
      const source = readFileSync(filename, 'utf8');
      const { code } = transformSync(source, {
        filename,
        sourceMaps: 'inline',
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: ext === '.tsx',
          },
          target: 'es2022',
        },
        module: {
          type: 'commonjs',
        },
      });
      module._compile(code, filename);
    };
  });

  // 3. Register ESM hooks dynamically (Node 20.6.0+)
  try {
    let loaderPath: string;
    try {
      loaderPath = require.resolve('./loader.mjs');
    } catch {
      loaderPath = require.resolve('./loader.mts');
    }
    registerLoader(pathToFileURL(loaderPath).href, pathToFileURL(__filename).href);
  } catch (err) {
    // ESM loader registration not supported in older Node versions or during build/bootstrap
  }
}

module.exports = { register };
