# rscute &middot; [![powered by SWC](https://img.shields.io/badge/powered%20by-swc-skyblue)](https://swc.rs/)

Faster Executor for **TypeScript** using [**@swc/core**](https://swc.rs/docs/usage/core)

Intercepts `require` calls for TypeScript files, recursively resolves dependencies, and evaluates them as a single flat bundle — all in-memory, with automatic symbol mangling to prevent collisions.

## Installation

```sh
npm i -D rscute
```

> When using pnpm, use `pnpm exec` instead of `npx` for running commands.

## Usage

### CLI

```sh
npx rscute script.ts
```

### Register

**Node.js `-r` flag:**

```sh
node -r rscute script.ts
```

**Hook:**

```js
const { register } = require('rscute/register');

register();

require('./filename.ts');
```

> **Supported entry extensions:** `.ts`, `.tsx`, `.cts`

### Programmatic API

#### `execute(code, options)` — `rscute/vm`

Compiles and executes a TypeScript code string in a sandboxed `vm.Context`, returning its module exports.

```js
import { execute } from 'rscute/vm';

const code = `export function greet() { return 'hello'; }`;
const result = execute(code);

console.log(result.greet()); // hello
```

| Parameter | Type                    | Description                                        |
| --------- | ----------------------- | -------------------------------------------------- |
| `code`    | `string`                | TypeScript or JavaScript code string               |
| `options` | `{ filePath?: string }` | Optional. Base path for relative import resolution |

#### `bundle(filePath)` — `rscute/bundle`

Resolves an entry file and all its dependencies into a single flat JavaScript string, without executing it.

```js
import { bundle } from 'rscute/bundle';
import path from 'path';

const code = bundle(path.resolve(__dirname, './script.ts'));
```

| Parameter  | Type     | Description                     |
| ---------- | -------- | ------------------------------- |
| `filePath` | `string` | Absolute path to the entry file |

## How It Works

rscute resolves and bundles imported modules recursively at runtime using SWC, without writing to disk.

When the same symbol name appears in multiple bundled files, rscute mangles conflicting names automatically before evaluation to prevent collisions in the flat bundle scope.

| Entry Point    | Behavior                                             |
| -------------- | ---------------------------------------------------- |
| CLI / register | Compiles and evaluates via module loader             |
| rscute/bundle  | Returns compiled bundle string in-memory             |
| rscute/vm      | Compiles and evaluates inside an isolated vm sandbox |

**Supported extensions:** `.js`, `.ts`, `.mjs`, `.mts`, `.cjs`, `.cts`, `.jsx`, `.tsx`

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
