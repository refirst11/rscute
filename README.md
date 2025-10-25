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

### Programmatic API

Use `rscute`'s APIs for advanced control within your own scripts.

**`execute(absolutePath)`**

The core API to execute a single file. Requires an absolute path for robust execution.

```js
import { execute } from 'rscute/execute';
import path from 'path';

const absolutePath = path.resolve(__dirname, './script.ts');
execute(absolutePath);
```

---

**`run(files, options)`**

The API for the CLI. Handles relative paths, multiple files, and execution modes.

```js
import { run } from 'rscute/cli';

// Run two files in parallel(default: sequential)
await run(['./script-a.ts', './script-b.ts'], { mode: 'parallel' });
```

<br>

## Concept

rscute executes the code that did the **path** resolution in the **Function** constructor, which is done in **memory**. Supported extensions are **.js, .ts, .mjs, .mts, .cjs, .cts, .jsx, and .tsx**.

<br>

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
