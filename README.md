# rscute &middot; [![powered by SWC](https://img.shields.io/badge/powered%20by-SWC-blue)](https://swc.rs/)

Faster Executor for **TypeScript** using [**@swc/core**](https://swc.rs/docs/usage/core)

## Installation

```sh
npm i -D rscute
```

## Usage

Run a TypeScript file **directly**:

```sh
npx rscute script.ts
```

## Dynamic import

`await import()` to replace `await execute()`

```ts
import { execute } from 'rscute';

await execute(absolutePath);
```

## Concept

rscute executes the code that did the **path** resolution in the **Function** constructor, which is done in **memory**.

Supported extensions are **.js, .ts, .mjs, .mts, .cjs, .cts, .jsx, and .tsx**.

## License

rscute is [MIT licensed](https://github.com/refirst11/rscute/blob/main/LICENSE).
