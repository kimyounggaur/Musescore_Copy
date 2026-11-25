// P5-A2: tests/capture-baseline.mjs의 --png-only 옵션 확인.
//  - 옵션을 주면 그림(PNG 4장)만 만들고, 기준 JSON·MusicXML·MIDI와 메모(ARCHITECTURE_NOTES·PERF·CONSOLE)는 쓰지 않는다.
//  - 옵션이 없으면 예전과 똑같이 파일 20개를 모두 만든다.
// 저장소의 tests/baseline은 건드리지 않도록 임시 폴더를 작업 폴더로 삼아 스크립트를 돌린다.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/capture-baseline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./capture-baseline.mjs', import.meta.url));
const appJs = fileURLToPath(new URL('../js/app.js', import.meta.url));
const PNGS = ['airplane.png', 'butterfly.png', 'rhythm.png', 'star.png'];
const ALL = [...PNGS, 'ARCHITECTURE_NOTES.md', 'CONSOLE.md', 'PERF.md',
  'airplane.mid', 'airplane.musicxml', 'airplane.scoreforge.json', 'butterfly.mid', 'butterfly.musicxml', 'butterfly.scoreforge.json',
  'quartet64.scoreforge.json', 'rhythm.mid', 'rhythm.musicxml', 'rhythm.scoreforge.json', 'star.mid', 'star.musicxml', 'star.scoreforge.json'].sort();

function capture(args) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'sf-capture-'));
  mkdirSync(path.join(cwd, 'js'));
  copyFileSync(appJs, path.join(cwd, 'js', 'app.js')); // 기본 모드가 app.js를 읽는다(메모 작성용)
  const run = spawnSync(process.execPath, [script, ...args], { cwd, env: { ...process.env, SF_BLOCK_SAMPLES: '1' }, encoding: 'utf8', timeout: 100000 });
  const dir = path.join(cwd, 'tests', 'baseline');
  let files = [];
  try { files = readdirSync(dir).sort(); } catch { /* 폴더가 없으면 아무것도 안 만든 것 */ }
  return { run, dir, cwd, files };
}

test('--png-only: 그림 4장만 만들고 다른 기준 파일은 쓰지 않는다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, () => {
  const out = capture(['--png-only']);
  try {
    assert.equal(out.run.status, 0, out.run.stderr || out.run.stdout);
    assert.deepEqual(out.files, PNGS);
    for (const name of PNGS) {
      const bytes = readFileSync(path.join(out.dir, name));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${name}은 PNG 파일`);
      assert.ok(bytes.length > 5000, `${name}은 비어 있지 않다`);
    }
  } finally { rmSync(out.cwd, { recursive: true, force: true }); }
});

test('옵션이 없으면 예전과 같이 기준 파일 20개를 모두 만든다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, () => {
  const out = capture([]);
  try {
    assert.equal(out.run.status, 0, out.run.stderr || out.run.stdout);
    assert.deepEqual(out.files, ALL);
    assert.match(readFileSync(path.join(out.dir, 'PERF.md'), 'utf8'), /\| quartet64 \|/);
  } finally { rmSync(out.cwd, { recursive: true, force: true }); }
});
