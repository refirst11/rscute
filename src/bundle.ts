import { compiler } from './compiler';
import { readFileCached } from './utils';

export function bundle(filePath: string) {
  const source = readFileCached(filePath);
  return compiler(source, filePath);
}
