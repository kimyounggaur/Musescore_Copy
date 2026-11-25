// P8-1 코드 기호 조옮김 — 실제 브라우저에서: 설정 창의 "코드 기호도 조옮김" 체크(기본 켬, 창을 열 때마다 켠 채로 시작)·
// 온음 ↑로 코드 기호·자동 코드 다이어그램·음이 함께 따라감·한 번에 되돌리기·체크를 끄면 음만·직접 만든 다이어그램은 그대로 두고 알려 줌·
// 영어 화면 안내·화살표 키 음높이 이동은 코드 기호를 건드리지 않음.
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/chord-transpose-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';

async function openApp(browser, { locale } = {}) {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1440, height: 1000 }, ...(locale ? { locale } : {}) }));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  return { context, page, pageErrors };
}

const CHORDS = ['C', 'Am7', 'F/A', 'G7'];
const STEPS = [0, 5, 3, 4];                 // C4 · A4 · F4 · G4 — 마디마다 온음표 하나

/** 4마디 악보를 새로 만든다. 첫 마디(C)에는 자동 코드 다이어그램, manual이면 넷째 마디(G7)에 "직접 만든" 다이어그램도 붙인다. */
async function setup(page, { manual = false } = {}) {
  const ids = await page.evaluate(({ manual, chords, steps }) => {
    const C = SF.core;
    C.setScore(C.createScore({ measureCount: 4, keySig: 0 }));
    const out = [];
    C.mutate('시험 편집', s => {
      chords.forEach((text, m) => {
        const id = C.inputAt(s, m, SF.Fraction.ZERO, { n: 1, d: 1, dots: 0 }, [{ step: steps[m], alter: 0, oct: 4 }]);
        C.findEvent(s, id).ev.chordSymbol = C.cloneChordSymbol(text);
        out.push(id);
      });
      const first = C.findEvent(s, out[0]).ev;
      first.fretboard = C.getDefaultFretboard(first.chordSymbol);                        // 자동 다이어그램(manual 표시 없음)
      if (manual) {
        const last = C.findEvent(s, out[3]).ev;
        last.fretboard = { ...C.getDefaultFretboard(last.chordSymbol), manual: true };   // 사용자가 직접 만든 다이어그램
      }
    });
    return out;
  }, { manual, chords: CHORDS, steps: STEPS });
  // 앞 시험에서 그린 화면이 아직 남아 있을 수 있다 — 새 악보가 그려질 때까지(코드 글자 전부 + 다이어그램 개수) 기다린다.
  await page.waitForFunction(({ chords, boards }) => {
    const drawn = [...document.querySelectorAll('#svg-host text.chord-symbol')].map(e => e.textContent);
    return drawn.length === chords.length && drawn.every((d, i) => d === chords[i]) && document.querySelectorAll('#svg-host g.fretboard').length === boards;
  }, { chords: CHORDS, boards: manual ? 2 : 1 });
  return ids;
}
/** 마디별 상태: 코드(정규화·raw)·음 높이(MIDI)·코드 다이어그램 전체(JSON) */
const snap = (page, ids) => page.evaluate(ids => ids.map(id => {
  const ev = SF.core.findEvent(SF.core.state.score, id).ev;
  return { chord: ev.chordSymbol?.normalized ?? null, raw: ev.chordSymbol?.raw ?? null, midi: ev.notes.map(SF.core.midiOf), fretboard: ev.fretboard ? JSON.stringify(ev.fretboard) : null };
}), ids);
const diagramOf = (page, chord) => page.evaluate(c => JSON.stringify(SF.core.getDefaultFretboard(SF.core.parseChordSymbol(c))), chord);
const drawnChords = page => page.$$eval('#svg-host text.chord-symbol', els => els.map(e => e.textContent));
const openSettings = async page => { await page.click('#btn-settings'); await page.waitForSelector('#dlg-settings[open]'); };
const closeSettings = async page => { await page.evaluate(() => document.querySelector('#dlg-settings').close()); await page.waitForSelector('#dlg-settings', { state: 'hidden' }); };
const transposeBy = async (page, semis) => { await page.click(`#dlg-settings [data-transpose="${semis}"]`); await page.waitForSelector('#toast.show'); };
const toastText = page => page.textContent('#toast');
const settled = page => page.waitForTimeout(150);

test('코드 기호 조옮김(설정 창): 체크 상자·함께 따라감·한 번에 되돌리기·체크 끄면 음만·직접 만든 다이어그램 안내·방향키는 음만', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser);

    await t.test('설정 창의 조옮김 칩 아래에 "코드 기호도 조옮김" 체크 상자가 있고 켜져 있다', async () => {
      await openSettings(page);
      assert.equal(await page.locator('#set-transpose-chords').count(), 1);
      assert.equal(await page.isChecked('#set-transpose-chords'), true);
      assert.match(await page.textContent('label:has(#set-transpose-chords)'), /코드 기호도 조옮김/);
      assert.equal(await page.evaluate(() => {
        const box = document.querySelector('#set-transpose-chords'), chip = document.querySelector('#dlg-settings [data-transpose="2"]');
        return !!(chip.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING);
      }), true, '칩 줄보다 아래에 있다');
      await closeSettings(page);
    });

    let ids, before;
    await t.test('온음 ↑: 코드 기호·자동 코드 다이어그램·음이 함께 올라가고 그린 글자도 바뀐다', async () => {
      ids = await setup(page);
      before = await snap(page, ids);
      assert.deepEqual(before.map(b => b.chord), CHORDS);
      assert.deepEqual(await drawnChords(page), CHORDS);
      assert.equal(await page.locator('#svg-host g.fretboard').count(), 1);
      await openSettings(page);
      await transposeBy(page, 2);
      const after = await snap(page, ids);
      assert.deepEqual(after.map(a => a.chord), ['D', 'Bm7', 'G/B', 'A7']);
      assert.deepEqual(after.map(a => a.raw), ['D', 'Bm7', 'G/B', 'A7'], 'raw도 함께 바뀐다(저장·다시 열기에서 유지)');
      assert.deepEqual(after.map((a, i) => a.midi.map(m => m - before[i].midi[0])), [[2], [2], [2], [2]], '음도 온음');
      assert.equal(after[0].fretboard, await diagramOf(page, 'D'), '자동 다이어그램은 새 코드(D)의 것으로 다시 만든다');
      assert.deepEqual(after.slice(1).map(a => a.fretboard), [null, null, null]);
      assert.equal(await page.inputValue('#set-key'), '2');
      assert.match(await toastText(page), /2반음 올렸어요/);
      await closeSettings(page);
      await page.waitForFunction(() => document.querySelector('#svg-host text.chord-symbol')?.textContent === 'D');
      assert.deepEqual(await drawnChords(page), ['D', 'Bm7', 'G/B', 'A7']);
      assert.equal(await page.locator('#svg-host g.fretboard').count(), 1);
    });

    await t.test('한 번 되돌리면 코드·다이어그램·음·조표가 모두 제자리(기록 한 칸)', async () => {
      assert.equal(await page.evaluate(() => SF.core.undoLabel()), '조옮김');
      await page.locator('#canvas').focus();
      await page.keyboard.press('Control+z'); await settled(page);
      assert.deepEqual(await snap(page, ids), before);
      assert.equal(await page.evaluate(() => SF.core.state.score.keySig), 0);
      assert.equal(await page.evaluate(() => SF.core.undoLabel()), '시험 편집', '기록은 정확히 한 칸만 물러났다');
      await page.waitForFunction(() => document.querySelector('#svg-host text.chord-symbol')?.textContent === 'C');
      assert.deepEqual(await drawnChords(page), CHORDS);
      await page.keyboard.press('Control+y'); await settled(page);
      assert.deepEqual((await snap(page, ids)).map(a => a.chord), ['D', 'Bm7', 'G/B', 'A7'], '다시 실행하면 함께 옮겨진 채로 돌아온다');
    });

    await t.test('체크를 끄고 온음 ↑: 음만 올라가고 코드 기호·다이어그램은 그대로, 창을 다시 열면 체크는 다시 켜져 있다', async () => {
      ids = await setup(page);
      before = await snap(page, ids);
      await openSettings(page);
      await page.uncheck('#set-transpose-chords');
      await transposeBy(page, 2);
      const after = await snap(page, ids);
      assert.deepEqual(after.map(a => a.chord), CHORDS);
      assert.deepEqual(after.map(a => a.fretboard), before.map(b => b.fretboard));
      assert.deepEqual(after.map((a, i) => a.midi[0] - before[i].midi[0]), [2, 2, 2, 2]);
      assert.equal(await page.inputValue('#set-key'), '2');
      assert.match(await toastText(page), /2반음 올렸어요/);
      await closeSettings(page);
      await page.waitForFunction(() => document.querySelector('#svg-host text.chord-symbol')?.textContent === 'C');
      assert.deepEqual(await drawnChords(page), CHORDS);
      await openSettings(page);
      assert.equal(await page.isChecked('#set-transpose-chords'), true, '창을 열 때마다 켠 채로 시작한다');
      await closeSettings(page);
    });

    await t.test('직접 만든 코드 다이어그램은 그대로 두고 몇 개를 두었는지 알려 준다(자동 다이어그램은 따라간다)', async () => {
      ids = await setup(page, { manual: true });
      before = await snap(page, ids);
      assert.equal(await page.locator('#svg-host g.fretboard').count(), 2);
      await openSettings(page);
      await transposeBy(page, 2);
      const after = await snap(page, ids);
      assert.deepEqual(after.map(a => a.chord), ['D', 'Bm7', 'G/B', 'A7']);
      assert.equal(after[0].fretboard, await diagramOf(page, 'D'));
      assert.equal(after[3].fretboard, before[3].fretboard, '직접 만든 G7 다이어그램은 코드가 A7로 바뀌어도 그대로');
      assert.equal(JSON.parse(after[3].fretboard).manual, true);
      assert.equal(await toastText(page), '직접 만든 코드 다이어그램 1개는 그대로 두었어요');
      await closeSettings(page);
    });

    await t.test('내림(반음 ↓): 코드 기호가 새 조의 철자로 따라간다', async () => {
      ids = await setup(page);
      await openSettings(page);
      await transposeBy(page, -1);
      assert.deepEqual((await snap(page, ids)).map(a => a.chord), ['B', 'G#m7', 'E/G#', 'F#7'], 'C장조 −1 = B장조(♯5개): 새 조의 철자(샤프)로');
      assert.equal(await page.evaluate(() => SF.core.state.score.keySig), 5);
      await closeSettings(page);
    });

    await t.test('방향키로 음높이를 바꿔도 코드 기호·다이어그램은 그대로(MuseScore와 같음)', async () => {
      ids = await setup(page);
      before = await snap(page, ids);
      await page.evaluate(id => SF.app.actions.select(id), ids[0]);
      await page.locator('#canvas').focus();
      await page.keyboard.press('ArrowUp'); await settled(page);
      const after = await snap(page, ids);
      assert.equal(after[0].midi[0], before[0].midi[0] + 1, '음은 반음 올라갔다');
      assert.equal(after[0].chord, 'C'); assert.equal(after[0].raw, 'C');
      assert.equal(after[0].fretboard, before[0].fretboard);
      assert.deepEqual(after.slice(1), before.slice(1));
    });

    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});

test('코드 기호 조옮김(설정 창): 영어 화면', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    const { page, pageErrors } = await openApp(browser, { locale: 'en-US' });
    const ids = await setup(page, { manual: true });
    await openSettings(page);
    assert.match(await page.textContent('label:has(#set-transpose-chords)'), /Transpose chord symbols too/);
    await transposeBy(page, 2);
    assert.equal(await toastText(page), 'Left 1 hand-made chord diagrams unchanged');
    assert.deepEqual((await snap(page, ids)).map(a => a.chord), ['D', 'Bm7', 'G/B', 'A7']);
    await closeSettings(page);
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
