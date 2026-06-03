# rscute &middot; [![powered by SWC](https://img.shields.io/badge/powered%20by-@swc/core-purple)](https://swc.rs/)

A lightweight, SWC-powered TypeScript JIT runner and bundler for Node.js.

> **What's in a name?**
>
> - **RS** = Rust (leveraging the speed of **SWC** under the hood).
> - **cute** = e**xecute** (nimble, lightweight, and smart execution).
>
> **rscute** intercepts module imports on-the-fly and compiles files on-demand to run and bundle TypeScript.

---

## Core Capabilities

- **On-the-Fly JIT Execution**: Runs `.ts`, `.tsx`, `.cts`, and `.mts` files instantly via a zero-config CLI. It intercepts module resolutions on-the-fly, loads dependencies on-demand, and resolves `tsconfig.json` path mappings.
- **Isolated VM Sandbox (`rscute/vm`)**: Compiles and evaluates TypeScript code strings inside Node's isolated `vm` context.
- **Bundler API (`rscute/bundle`)**: Resolves an entry file and bundles all its local dependencies into a single flat JavaScript string, without writing to disk.

---

## Quick Start

### Installation

```sh
npm i -D rscute
```

_Note: If you are using `pnpm`, run commands using `pnpm exec` instead of `npx`._

### CLI Execution

```sh
npx rscute script.ts
```

---

## Programmatic APIs

### 1. sandbox execution (`rscute/vm`)

```js
import { execute } from 'rscute/vm';

const exports = execute(`
  export const val = 42;
  export function greet(name: string): string {
    return \`Hello, \${name}!\`;
  }
`);

console.log(exports.val);
console.log(exports.greet('Developer'));
```

| Parameter | Type                    | Description                                                             |
| --------- | ----------------------- | ----------------------------------------------------------------------- |
| `code`    | `string`                | TypeScript or JavaScript source code string                             |
| `options` | `{ filePath?: string }` | Optional. Base path used for relative import resolution inside the code |

### 2. bundling (`rscute/bundle`)

```js
import { bundle } from 'rscute/bundle';
import path from 'path';

const bundledCode = bundle(path.resolve(__dirname, './script.ts'));
```

---

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
