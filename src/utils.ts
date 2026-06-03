import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const fileCache = new Map<string, string>();

export function readFileCached(path: string): string {
  if (fileCache.has(path)) return fileCache.get(path)!;
  const content = readFileSync(path, 'utf-8');
  fileCache.set(path, content);
  return content;
}

export function getProjectRoot(contextPath: string): string {
  let current = contextPath;
  while (true) {
    if (existsSync(resolve(current, 'package.json')) || existsSync(resolve(current, 'tsconfig.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return contextPath;
    }
    current = parent;
  }
}

export type LoadTSConfig = null | { paths: Record<string, string[]> };

export function loadTsConfig(contextPath: string): LoadTSConfig {
  const root = getProjectRoot(contextPath);
  const tsConfigPath = resolve(root, 'tsconfig.json');
  if (!existsSync(tsConfigPath)) {
    return null;
  }
  try {
    const config = JSON.parse(readFileSync(tsConfigPath, 'utf-8'));
    return config.compilerOptions || null;
  } catch {
    return null;
  }
}

export function resolveTsConfigPaths(importPath: string, contextPath: string): string | null {
  const tsConfig = loadTsConfig(contextPath);
  if (!tsConfig?.paths) return null;

  const baseDir = getProjectRoot(contextPath);

  for (const [alias, targetPaths] of Object.entries(tsConfig.paths)) {
    const aliasPrefix = alias.replace(/\*$/, '');
    if (!importPath.startsWith(aliasPrefix)) continue;

    for (const target of targetPaths) {
      const resolvedTarget = target.replace(/\*$/, '');
      const candidatePath = resolve(baseDir, resolvedTarget + importPath.slice(aliasPrefix.length));
      
      const extensions = ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.json'];
      for (const ext of extensions) {
        const pathWithExt = candidatePath + ext;
        if (existsSync(pathWithExt)) {
          return pathWithExt;
        }
      }
      
      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}
