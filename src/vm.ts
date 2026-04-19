import { compiler } from './compiler';
import { resolve, dirname } from 'path';
import vm from 'vm';

export function execute(code: string, options?: { filePath?: string }) {
  const filePath = options?.filePath ?? resolve(process.cwd(), 'inline.ts');
  const finalBundle = compiler(code, filePath);
  const moduleObj = { exports: {} };
  const context = vm.createContext({
    require,
    console,
    process,
    __dirname: dirname(filePath),
    __filename: filePath,
    module: moduleObj,
    exports: moduleObj.exports,
  });

  const script = new vm.Script(finalBundle);
  script.runInContext(context);

  return moduleObj.exports;
}
