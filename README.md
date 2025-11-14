# rscute &middot; [![powered by SWC](https://img.shields.io/badge/powered%20by-SWC-blue)](https://swc.rs/)

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

Run your TypeScript files directly from the command line.

**Run a single file:**

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

---

<br/>

### Programmatic API

Use `rscute`'s APIs for advanced control within your own scripts.

---

**`run(files: string[], options?: { mode?: 'parallel' | 'sequential' }): Promise<void>`**

Runs multiple TypeScript files with relative path resolution.  
Supports execution modes such as parallel or sequential.

- `files`: An array of file paths to execute.
- `options` (optional): Execution options, e.g., `{ mode: 'parallel' | 'sequential' }`.

Returns a Promise that resolves when all executions complete.

```js
import { run } from 'rscute/cli';

// Run two files in parallel (default is sequential)
await run(['./script-a.ts', './script-b.ts'], { mode: 'parallel' });
```

---

<br>

**`execute(absolutePath: string): Promise<any>`**

Executes an absolute TypeScript/JavaScript file and returns the `exports` of the executable.  
All side effects will be executed.

```js
import { execute } from 'rscute/execute';
import path from 'path';

const absolutePath = path.resolve(__dirname, './script.ts');
const module = await execute(absolutePath);

module.func(); // You can use exported functions
```

---

<br>

**`executeCode(code: string, options?: { filePath?: string }): Promise<any>`**

Executes a code string. Relative paths can be resolved by specifying a `filePath`.  
The return value is the same as `execute`.

```js
import { executeCode } from 'rscute/execute';

const code = `export function func() { return 123; }`;
const module = await executeCode(code);

console.log(module.func());
```

---

<br>

## Concept

`rscute` executes code that resolves paths dynamically (supporting both ESM and CJS) inside the JavaScript `Function` constructor, keeping execution entirely in-memory without disk writes.  
Supported extensions include `.js`, `.ts`, `.mjs`, `.mts`, `.cjs`, `.cts`, `.jsx`, and `.tsx`.

<br>

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
