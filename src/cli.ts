#!/usr/bin/env node
import path from 'path';
import { execute } from './execute.js';

export async function run(
  files: string[],
  options: {
    mode?: 'sequential' | 'parallel';
  } = {}
) {
  const { mode = 'sequential' } = options;

  if (files.length === 0) {
    throw new Error('No files specified.');
  }

  try {
    if (mode === 'sequential') {
      for (const file of files) {
        const absolutePath = path.resolve(process.cwd(), file);
        await execute(absolutePath);
      }
    } else {
      const promises = files.map(file => {
        const absolutePath = path.resolve(process.cwd(), file);
        return execute(absolutePath);
      });
      await Promise.all(promises);
    }
  } catch (err) {
    throw err;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const files: string[] = [];
  let mode: 'sequential' | 'parallel' = 'sequential';

  for (const arg of args) {
    if (arg === '--parallel' || arg === '-p') {
      mode = 'parallel';
    } else if (!arg.startsWith('-')) {
      files.push(arg);
    }
  }

  run(files, { mode }).catch(err => {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error('An unknown error occurred:', err);
    }
    process.exit(1);
  });
}
