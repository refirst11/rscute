import { readFileSync } from 'fs';

const fileCache = new Map<string, string>();

export function readFileCached(path: string): string {
  if (fileCache.has(path)) return fileCache.get(path)!;
  const content = readFileSync(path, 'utf-8');
  fileCache.set(path, content);
  return content;
}
