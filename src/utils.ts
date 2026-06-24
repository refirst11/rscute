import { existsSync } from 'fs';
import { getTsconfig, createPathsMatcher } from 'get-tsconfig';

type PathsMatcher = ((specifier: string) => string[]) | null;

const matcherCache = new Map<string, PathsMatcher>();
const fsCache = new Map<string, any>();

function getPathsMatcher(contextPath: string): PathsMatcher {
  const tsconfig = getTsconfig(contextPath, 'tsconfig.json', fsCache);
  const cacheKey = tsconfig?.path ?? contextPath;

  if (matcherCache.has(cacheKey)) {
    return matcherCache.get(cacheKey)!;
  }

  const matcher = tsconfig ? createPathsMatcher(tsconfig) : null;
  matcherCache.set(cacheKey, matcher);
  return matcher;
}

export function resolveTsConfigPaths(importPath: string, contextPath: string): string | null {
  const matcher = getPathsMatcher(contextPath);
  if (!matcher) return null;

  const candidates = matcher(importPath);
  if (!candidates || candidates.length === 0) return null;

  const extensions = ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.json'];

  for (const candidate of candidates) {
    // Check with extensions
    for (const ext of extensions) {
      const pathWithExt = candidate + ext;
      if (existsSync(pathWithExt)) {
        return pathWithExt;
      }
    }

    // Check exact path
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
