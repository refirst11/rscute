import * as x from './ESM_D';
import { ESM_N as AP } from './ESM_N';

const CJS_D = require('./CJS_D');
const { CJS_N } = require('./CJS_N');
console.log(import.meta.url);
console.log(x.bsumu);
console.log(x.asumu);
x.default();
AP();
CJS_D();
CJS_N();
