# rscute &middot; [![powered by SWC](https://img.shields.io/badge/powered%20by-swc-yellow)](https://swc.rs/)

Faster Executor for **TypeScript** using [**@swc/core**](https://swc.rs/docs/usage/core)

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

## Usage

### CLI

Run TypeScript files directly from the command line.

```sh
npx rscute script.ts
```

---

**Run multiple files (sequential by default):**

```sh
npx rscute script-a.ts script-b.ts
```

---

**Run multiple files in parallel(-p or --parallel):**

```sh
npx rscute script-a.ts script-b.ts -p
```

---

### Require Hook

Enable on-the-fly TypeScript compilation for `require()`.

**From the command line:**

```sh
node -r rscute script.ts
```

**From within your code:**

```js
const { register } = require('rscute/register');

register();

require('./filename.ts');
```

### Programmatic API

#### `run(files, options)`

Runs multiple TypeScript files with relative path resolution. Supports parallel or sequential execution.

```js
import { run } from 'rscute/cli';

await run(['./script-a.ts', './script-b.ts'], { mode: 'parallel' });
```

**Parameters:**

- `files` - Array of file paths to execute
- `options` - Execution options: `{ mode: 'parallel' | 'sequential' }`

#### `execute(absolutePath)`

Executes an absolute TypeScript/JavaScript file and returns the module exports.

```js
import { execute } from 'rscute/execute';
import path from 'path';

const absolutePath = path.resolve(__dirname, './script.ts');
const module = await execute(absolutePath);

module.func(); // Use exported functions
```

#### `executeCode(code, options)`

Executes a code string. Relative paths can be resolved by specifying a `filePath`.

```js
import { executeCode } from 'rscute/execute';

const code = `export function func() { return 123; }`;
const module = await executeCode(code);

console.log(module.func()); // 123
```

**Parameters:**

- `code` - Code string to execute
- `options` - Optional: `{ filePath?: string }` for relative path resolution

---

## How It Works

`rscute` executes code that resolves paths dynamically (supporting both ESM and CJS) inside the JavaScript `Function` constructor, keeping execution entirely in-memory without disk writes.

**Supported extensions:** `.js`, `.ts`, `.mjs`, `.mts`, `.cjs`, `.cts`, `.jsx`, `.tsx`

---

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
