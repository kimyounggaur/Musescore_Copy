// P8-3 한글 입력 상태에서도 단축키가 먹는다 — 실제 Chrome에서 확인한다.
// 한글 입력기가 켜진 Windows·Chrome은 글자 키의 e.key가 "Process"(keyCode 229)로 오고 e.code만 KeyA…로 남는다.
// CDP(Input.dispatchKeyEvent)로 그 "신뢰된 키 이벤트"를 그대로 만들어 앱 단축키가 라틴 자판과 똑같이 동작하는지 본다.
//  · N(입력 모드)·A~G(음 입력)·Shift+글자(화음 쌓기)·.(점음표) → 라틴 자판과 완전히 같은 악보가 된다
//  · 한글 자모가 그대로 오는 환경(Firefox·Safari: key="ㅊ")도 같다
//  · 타악기 악보의 K·S·H·O·C(드럼 입력) · Ctrl+Shift+S(클라우드 저장 → 로그인 창)
//  · 글자 입력칸에서는 한글을 쳐도 단축키가 켜지지 않는다 · 라틴 자판의 기존 동작은 그대로
// 실행: SF_HEADERS=1 npm run serve 를 띄운 뒤
//   PW_CHANNEL=chrome PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node --test tests/ime-keys-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchOptions, pageOptions, preparePage } from './browser-launch.mjs';
const require = createRequire(import.meta.url);
const URL_ = process.env.SF_URL || 'http://127.0.0.1:8000';
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };      // CDP modifiers 비트

async function openApp(browser, ensemble = 'solo') {
  const context = await browser.newContext(pageOptions({ viewport: { width: 1280, height: 900 } }));
  await context.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  const page = await context.newPage();
  await preparePage(page);
  page.setDefaultTimeout(10000);
  page.pageErrors = []; page.consoleErrors = [];
  page.on('pageerror', error => page.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') page.consoleErrors.push(message.text()); });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev'); await page.waitForFunction(() => SF.engrave.isFontReady());
  await page.evaluate(ensemble => { SF.core.setScore(SF.core.createScore({ measureCount: 2, ensemble })); SF.app.update(); }, ensemble);
  await page.locator('#canvas').click({ position: { x: 5, y: 5 } });     // 악보 영역에 초점(입력칸이 아님)
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}
// 시험이 일부러 막은 음원 호스트 요청은 콘솔에 "Failed to load resource"로 남는다 — 그것만 빼고 오류가 없어야 한다.
const quiet = page => assert.deepEqual([page.pageErrors, page.consoleErrors.filter(text => !/^Failed to load resource/.test(text))], [[], []], '페이지 오류·콘솔 오류 없음');
/** 한글 입력기가 가로챈 글자 키: 신뢰된 keydown(key="Process", keyCode 229, code는 자판 위치 그대로). key를 바꾸면 한글 자모가 그대로 오는 환경이 된다. */
async function ime(cdp, code, mods = 0, key = 'Process') {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: 229, modifiers: mods });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: 229, modifiers: mods });
}
/** 첫 보표 성부 1의 마디별 내용을 한 줄 문자열로: note[step.alter.oct]…@길이.점 · 드럼은 :drumId. */
const sig = page => page.evaluate(() => {
  const score = SF.core.state.score, staff = score.parts[0].staves[0];
  return staff.measures.map(measure => SF.core.getVoiceEvents(measure, 1, score).map(ev =>
    `${ev.type}${ev.drumId ? ':' + ev.drumId : ''}${(ev.notes || []).map(n => `[${n.step}.${n.alter}.${n.oct}]`).join('')}@${ev.dur.n}/${ev.dur.d}.${ev.dur.dots}`).join(' '));
});
const inputMode = page => page.evaluate(() => SF.app.ui.inputMode);
const openDialogs = page => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(dialog => dialog.id));

/** 같은 키 순서를 라틴 자판(Playwright 키보드)과 한글 입력 상태(CDP)로 각각 새 앱에 넣어 악보를 돌려준다. */
const KEYS = [['n'], ['c'], ['e'], ['g', 'shift'], ['4'], ['a'], ['b'], ['.'], ['c']];   // 입력 모드 → C → E → E 위에 G 쌓기 → 8분음표로 → A → B → 점 → 점 C
const latinKey = ([key, mod]) => (mod === 'shift' ? `Shift+${key.toUpperCase()}` : key);
const codeOf = key => (/^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key === '.' ? 'Period' : `Digit${key}`);
async function typeLatin(browser) {
  const { context, page } = await openApp(browser);
  for (const k of KEYS) await page.keyboard.press(latinKey(k));
  const result = await sig(page); quiet(page); await context.close(); return result;
}
async function typeIme(browser, key = () => 'Process') {
  const { context, page, cdp } = await openApp(browser);
  for (const k of KEYS) await ime(cdp, codeOf(k[0]), k[1] === 'shift' ? MOD.shift : 0, key(k[0]));
  const result = await sig(page); quiet(page); await context.close(); return result;
}
const JAMO = { n: 'ㅜ', c: 'ㅊ', e: 'ㄷ', g: 'ㅎ', a: 'ㅁ' };

test('한글 입력 상태 단축키(브라우저)', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 300000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch(launchOptions());
  try {
    await t.test('N·A~G·Shift+글자·.·숫자: 한글 입력(key="Process")이 라틴 자판과 똑같은 악보를 만든다', async () => {
      const latin = await typeLatin(browser), korean = await typeIme(browser);
      assert.deepEqual(korean, latin, '같은 키 순서 → 같은 악보');
      assert.match(latin[0], /^note\[0\.0\.5\]@1\/4\.0 note\[2\.0\.5\]\[4\.0\.5\]@1\/4\.0 note\[5\.0\.5\]@1\/8\.0 note\[6\.0\.5\]@1\/8\.0 note\[0\.0\.6\]@1\/8\.1 rest@1\/16\.0$/,
        'C, E+G 화음, 8분음표 A·B, 점8분음표 C(남은 16분쉼표) — 시험이 아무것도 안 해도 통과하지 않도록 값을 고정');
    });

    await t.test('한글 자모가 그대로 오는 환경(Firefox·Safari 식 key="ㅊ")도 같은 악보', async () => {
      const latin = await typeLatin(browser);
      const jamo = await typeIme(browser, key => JAMO[key] || 'Process');   // 점·숫자·화음 키는 입력기가 가로채지 않는 키라 그대로 둬도 같다
      assert.deepEqual(jamo, latin);
    });

    await t.test('입력 모드 켜기·끄기(N)와 드럼 입력(K·S·H·O·C): 타악기 악보에서 한글 입력으로도 킥·스네어·하이햇이 들어간다', async () => {
      const { context, page, cdp } = await openApp(browser, 'drumkit');
      assert.equal(await inputMode(page), false);
      await ime(cdp, 'KeyN'); assert.equal(await inputMode(page), true, 'N → 입력 모드 켜짐');
      for (const code of ['KeyK', 'KeyS', 'KeyH', 'KeyO']) await ime(cdp, code);
      await ime(cdp, 'KeyC', 0, 'ㅊ');                                    // 한글 자모가 그대로 오는 경우
      const [first, second] = await sig(page);
      assert.match(first, /^note:kick\S+ note:snare\S+ note:closed-hihat\S+ note:open-hihat\S+$/, '1마디: 킥·스네어·닫힌 하이햇·열린 하이햇');
      assert.match(second, /^note:crash/, '2마디 첫머리: 크래시');
      await ime(cdp, 'KeyN'); assert.equal(await inputMode(page), false, 'N 다시 → 꺼짐');
      quiet(page); await context.close();
    });

    await t.test('Ctrl+Shift+S: 한글 입력 상태에서도 클라우드 저장이 시작된다(로그인 안 한 상태 → 로그인 창). 다른 조합은 아무 일도 없다', async () => {
      for (const [label, send] of [['한글 입력(Process)', (cdp, page) => ime(cdp, 'KeyS', MOD.ctrl | MOD.shift)],
                                   ['한글 자모(ㄴ)', (cdp, page) => ime(cdp, 'KeyS', MOD.ctrl | MOD.shift, 'ㄴ')],
                                   ['Mac Cmd(한글 입력)', (cdp, page) => ime(cdp, 'KeyS', MOD.meta | MOD.shift)],
                                   ['라틴 자판', (cdp, page) => page.keyboard.press('Control+Shift+S')]]) {
        const { context, page, cdp } = await openApp(browser);
        assert.deepEqual(await openDialogs(page), [], label);
        await send(cdp, page);
        await page.waitForFunction(() => document.querySelector('#dlg-auth')?.open, null, { timeout: 5000 });
        assert.deepEqual(await openDialogs(page), ['dlg-auth'], `${label}: 로그인 창 하나만 열린다(저장이 두 번 불리지 않는다)`);
        quiet(page); await context.close();
      }
      const { context, page, cdp } = await openApp(browser);
      await ime(cdp, 'KeyS', MOD.ctrl);                                    // Shift 없음
      await ime(cdp, 'KeyQ', MOD.ctrl | MOD.shift);                        // 다른 글자
      await ime(cdp, 'KeyS', MOD.ctrl | MOD.shift | MOD.alt);              // Alt가 섞임
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.deepEqual(await openDialogs(page), [], '저장이 시작되지 않았다');
      quiet(page); await context.close();
    });

    await t.test('글자 입력칸에서는 한글(Process)을 쳐도 단축키가 켜지지 않는다', async () => {
      const { context, page, cdp } = await openApp(browser);
      await page.evaluate(() => { const input = document.createElement('input'); input.id = 'ime-probe'; document.body.append(input); input.focus(); });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'ime-probe');
      await ime(cdp, 'KeyN'); await ime(cdp, 'KeyC');
      assert.equal(await inputMode(page), false, '입력칸 안의 N은 입력 모드를 켜지 않는다');
      assert.deepEqual(await sig(page), ['rest@1/1.0', 'rest@1/1.0'].map(row => row), '악보도 그대로');
      quiet(page); await context.close();
    });

    await t.test('조합 중(isComposing)인 키 이벤트는 단축키로 풀지 않는다 — 입력기가 글자를 만드는 중이다', async () => {
      const { context, page } = await openApp(browser);
      const dispatch = init => page.evaluate(init => document.querySelector('#canvas').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })), init);
      await dispatch({ key: 'Process', code: 'KeyN', isComposing: true });
      assert.equal(await inputMode(page), false, '조합 중인 N(Process)은 무시');       // 이벤트마다 확인한다 — 두 번 눌려 켜졌다 꺼지면 못 잡는다
      await dispatch({ key: 'ㅜ', code: 'KeyN', isComposing: true });
      assert.equal(await inputMode(page), false, '조합 중인 N(ㅜ)도 무시');
      await dispatch({ key: 'Process', code: 'KeyN' });
      assert.equal(await inputMode(page), true, '조합 중이 아니면 켜진다(위 이벤트가 막혀서가 아니라 조합 중이라 무시된 것)');
      quiet(page); await context.close();
    });

    await t.test('라틴 자판의 기존 단축키는 그대로(N·C·Ctrl+Z)이고, Ctrl+Z는 한글 입력 상태에서도 되돌린다', async () => {
      const { context, page, cdp } = await openApp(browser);
      await page.keyboard.press('n'); assert.equal(await inputMode(page), true);
      await page.keyboard.press('c');
      const withNote = await sig(page); assert.match(withNote[0], /^note\[0\.0\.5\]/);
      await ime(cdp, 'KeyZ', MOD.ctrl);                                    // 한글 입력 상태의 Ctrl+Z
      assert.doesNotMatch((await sig(page))[0], /^note/, '되돌려졌다');
      await ime(cdp, 'KeyZ', MOD.ctrl | MOD.shift);                        // Ctrl+Shift+Z = 다시 실행
      assert.deepEqual(await sig(page), withNote, '다시 실행으로 돌아왔다');
      quiet(page); await context.close();
    });
  } finally { await browser.close(); }
});
