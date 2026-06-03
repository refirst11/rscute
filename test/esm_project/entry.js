import { val as val1 } from './dep.ts';
import { val as val2 } from './dep';
import { val as val3 } from './dep_js.js';
import { val as val4 } from '@/dep';

console.log('ESM project run:', val1, val2, val3, val4);
