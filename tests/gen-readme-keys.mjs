// Only the marked shortcut table in README is generated; surrounding prose stays hand authored.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import vm from 'node:vm';
const context = { window: { SF: {} } };
vm.runInNewContext(await readFile(new URL('../js/keymap.js', import.meta.url), 'utf8'), context);
const rows = context.window.SF.keymap.KEYMAP.map(item => `| ${item.keys.join(' / ').replaceAll('|', '\\|')} | ${item.label} | ${{ all: '공통', normal: '일반 입력', speedy: '스피디' }[item.mode]} |`);
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/SHORTCUTS.md', import.meta.url), '# ScoreForge 단축키\n\n`node tests/gen-readme-keys.mjs`로 생성합니다. Windows/Linux의 Ctrl은 macOS에서 Command로 사용할 수 있습니다.\n\n| 키 | 동작 | 모드 |\n| --- | --- | --- |\n' + rows.join('\n') + '\n');
console.log(`Generated docs/SHORTCUTS.md: ${rows.length} shortcuts`);
const readmeURL = new URL('../README.md', import.meta.url);
const readme = await readFile(readmeURL, 'utf8');
const start = '<!-- SHORTCUTS:START -->', end = '<!-- SHORTCUTS:END -->';
if (!readme.includes(start) || !readme.includes(end)) throw new Error('README shortcut markers missing');
const table = '| 키 | 동작 | 모드 |\n| --- | --- | --- |\n' + rows.join('\n');
await writeFile(readmeURL, readme.replace(/<!-- SHORTCUTS:START -->[\s\S]*?<!-- SHORTCUTS:END -->/, `${start}\n${table}\n${end}`));
