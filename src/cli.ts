#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { join } from 'path';

const hookPath = join(__dirname, './index.js');

const files = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
if (!files.length) throw new Error('No files specified.');

const args = ['-r', hookPath, ...process.argv.slice(2)];

const { error, status } = spawnSync(process.execPath, args, { stdio: 'inherit' });

if (error) throw error;
process.exit(status ?? 1);
