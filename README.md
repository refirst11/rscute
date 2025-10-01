# rscute &middot; [![powered by SWC](https://img.shields.io/badge/powered%20by-SWC-blue)](https://swc.rs/)

Faster Executor for **TypeScript** using [**@swc/core**](https://swc.rs/docs/usage/core)

<br>

## Installation

**npm:**
```sh
npm i -D rscute
```

**pnpm:**
```sh
pnpm add -D rscute
```
> When using pnpm, use pnpm exec instead of npx for running commands.
<br>

## Usage

### 1. As a CLI

Run your TypeScript files directly from the command line.

<br>

**Run a single file:**
```sh
npx rscute script.ts
```
<br>

**Run multiple files (sequentially by default):**
```sh
npx rscute script-a.ts script-b.ts
```
<br>

**Run multiple files in parallel:**
```sh
npx rscute script-a.ts script-b.ts --parallel
```
<br>

### 2. As a Require Hook

Enable on-the-fly TypeScript compilation for `require()`.

<br>

**From the command line:**
```sh
node -r rscute script.ts
```
<br>

**From within your code:**
```js
const { register } = require('rscute/register');

register()

require('./filename.ts');
```
<br>

### 3. As a Programmatic API

Use `rscute`'s APIs for advanced control within your own scripts.

<br>

**`execute(absolutePath)`**

The core API to execute a single file. Requires an absolute path for robust execution.

```js
import { execute } from 'rscute/execute';
import path from 'path';

const absolutePath = path.resolve(__dirname, './script.ts');
execute(absolutePath);
```
<br>

**`run(files, options)`**

The API for the CLI. Handles relative paths, multiple files, and execution modes.

```js
import { run } from 'rscute/cli';

// Run two files in parallel
await run(
  ['./script-a.ts', './script-b.ts'],
  { mode: 'parallel' }
);
```
<br>

## Concept

rscute executes the code that did the **path** resolution in the **Function** constructor, which is done in **memory**. Supported extensions are **.js, .ts, .mjs, .mts, .cjs, .cts, .jsx, and .tsx**.

<br>

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
