# rscute

A lightweight, SWC-powered TypeScript JIT runner for Node.js.

> **What's in a name?**
>
> - **RS** = Rust (leveraging the speed of **SWC** under the hood).
> - **cute** = e**xecute** (nimble, lightweight, and smart execution).
>
> **rscute** intercepts module imports on-the-fly and compiles TypeScript files on-demand — zero config, zero build step.

---

## Features

- Runs `.ts`, `.tsx`, `.cts`, and `.mts` files instantly via a zero-config CLI
- Intercepts module resolutions on-the-fly and loads dependencies on-demand
- Resolves `tsconfig.json` path mappings automatically
- Supports both CJS and ESM projects seamlessly

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

## Program

### `rscute/register`

Use the `register` API to hook TypeScript compilation into Node.js module resolution programmatically.

```js
const { register } = require('rscute/register');

register();

// Now you can require .ts files directly
require('./my-module.ts');
```

---

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
