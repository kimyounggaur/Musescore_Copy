import { readFileSync } from 'node:fs';
import vm from 'node:vm';
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, querySelector: () => null };
for (const file of ['safe-html', 'core', 'schema', 'engrave', 'playback', 'io']) {
  vm.runInThisContext(readFileSync(new URL(`../js/${file}.js`, import.meta.url), 'utf8'), { filename: `${file}.js` });
}
export const SF = globalThis.SF;
