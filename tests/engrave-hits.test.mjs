// P5-B2: 음표머리 클릭 영역(<ellipse class="note-hit">)을 조판기(engrave.js)가 직접 그린다.
//  - 화면용 render(score)에는 음표머리마다 하나씩(표준 보표·화음·2성부·TAB·드럼 모두), data-note 그룹의 마지막 자식으로 들어간다.
//  - 내보내기(render(score, { export: true })·renderForExport)에는 하나도 없다. 검은 타원이 악보에 찍히면 안 된다(F15).
//  - 내보내기 중 예외가 나도 다음 화면용 render는 다시 클릭 영역을 그린다(모듈 변수 emitHits 복원).
//  - 앱(app.js)은 더 이상 후처리로 클릭 영역을 붙이지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ console, setTimeout, clearTimeout });
context.window = context;
context.document = { getElementById: () => null, querySelectorAll: () => [] };
for (const name of ['safe-html', 'core', 'engrave']) vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context, { filename: `${name}.js` });
const { core: C, engrave: E } = context.SF;
const pitch = (step = 0, alter = 0, oct = 4) => ({ step, alter, oct });
const note = (id, notes, d = 4, extra = {}) => ({ id, type: 'note', notes, dur: { n: 1, d, dots: 0 }, voice: 1, ...extra });
function put(score, m, events, voice, ref) {
  ref.measures[m].voices[voice - 1] = events;
  if (voice === 1) ref.measures[m].events = events;
  if (C.invalidate) C.invalidate(score, { keepNormalized: true });
}
const render = (s, opts = {}) => E.render(s, { fallback: true, ...opts });
const hitsOf = svg => [...svg.matchAll(/<ellipse class="note-hit" cx="([\d.-]+)" cy="([\d.-]+)" rx="([\d.-]+)" ry="([\d.-]+)"\/>/g)].map(m => m.slice(1, 5).map(Number));
const r2 = n => Math.round(n * 100) / 100;

// 피아노 두 보표(화음·2성부) + 기타 TAB + 드럼 — 클릭 영역이 생기는 모든 종류의 음표
function mixedScore() {
  const s = C.createScore({ measureCount: 1, parts: ['piano', 'guitar-tab', 'drumkit'] });
  const refs = C.staffRefs(s);
  const tabRef = refs.find(r => r.staff?.staffType === 'tab'), drumRef = refs.find(r => r.staff?.staffType === 'percussion');
  put(s, 0, [note('chord', [pitch(0, 0, 4), pitch(1, 0, 4), pitch(4, 0, 4)], 2), note('single', [pitch(5, 0, 5)], 2)], 1, refs[0]);
  put(s, 0, [note('lower', [pitch(2, 0, 3)], 1, { voice: 2 })], 2, refs[0]);
  put(s, 0, [note('bass', [pitch(0, 0, 2), pitch(4, 0, 2)], 1)], 1, refs[1]);
  put(s, 0, [note('tab1', [pitch(4, 0, 5)], 2, { tab: { string: 1, fret: 15 } }), note('tab2', [pitch(2, 0, 5)], 2, { tab: { string: 2, fret: 12 } })], 1, tabRef);
  put(s, 0, [{ id: 'kick', type: 'note', notes: [], drumId: 'kick', midi: 36, staffLine: 0, voice: 1, dur: { n: 1, d: 2, dots: 0 } },
    { id: 'snare', type: 'note', notes: [], drumId: 'snare', midi: 38, staffLine: 4, voice: 1, dur: { n: 1, d: 2, dots: 0 } }], 1, drumRef);
  return s;
}
const headSpec = le => (le.noteheads || []).map(head => [r2(head.x), r2(head.y), r2(Math.max(6, head.width / 2)), r2(Math.max(5, head.height / 2))]);
const sortSpecs = list => list.map(a => a.join(',')).sort();

test('P5-B2 화면용 render는 음표머리마다 .note-hit 하나를 머리 좌표·크기대로 그린다(화음·2성부·두 보표·TAB·드럼)', () => {
  const s = mixedScore();
  const r = render(s);
  const expected = [...r.layout.eventsById.values()].flatMap(headSpec);
  assert.equal(expected.length, 3 + 1 + 1 + 2 + 2 + 2, '화음 3 + 단음 1 + 2성부 1 + 왼손 화음 2 + TAB 2 + 드럼 2 = 11개');
  const hits = hitsOf(r.svg);
  assert.equal((r.svg.match(/class="note-hit"/g) || []).length, expected.length, '클릭 영역 수 = 음표머리 수');
  assert.deepEqual(sortSpecs(hits), sortSpecs(expected), '좌표·크기가 layout의 머리와 같다');
});

test('P5-B2 .note-hit은 data-note 그룹의 마지막 자식으로 들어간다', () => {
  const r = render(mixedScore());
  const groups = (r.svg.match(/<g class="nh[^"]*" data-note="\d+"/g) || []).length;
  assert.ok(groups > 0);
  assert.equal(groups, (r.svg.match(/<ellipse class="note-hit"[^>]*\/><\/g>/g) || []).length, '머리 그룹마다 닫는 </g> 바로 앞에 하나');
});

test('P5-B2 내보내기(render export·renderForExport)에는 .note-hit이 하나도 없다', async () => {
  const s = mixedScore();
  assert.ok(hitsOf(render(s).svg).length > 0);
  assert.equal((render(s, { export: true }).svg.match(/note-hit/g) || []).length, 0);
  const exported = await E.renderForExport(s);
  assert.equal(exported.pages.join('').includes('note-hit'), false);
  assert.equal(exported.svg.includes('note-hit'), false);
  // 내보낸 뒤에도 화면용 render는 다시 클릭 영역을 그린다
  assert.equal(hitsOf(render(s).svg).length, 11);
});

test('P5-B2 내보내기 render 중 예외가 나도 다음 화면용 render는 클릭 영역을 그린다', () => {
  const s = mixedScore();
  assert.throws(() => E.render(s, { export: true, fallback: true, selection: { get id() { throw new Error('boom'); } } }), /boom/);
  assert.equal(hitsOf(render(s).svg).length, 11, 'emitHits가 try/finally로 복원된다');
});

test('P5-B2 캐시를 쓰는 화면용 render와 내보내기 render가 서로의 결과를 바꾸지 않는다', () => {
  const s = mixedScore();
  const a = E.render(s, { cache: true, fallback: true });
  const x = E.render(s, { cache: true, fallback: true, export: true });
  const b = E.render(s, { cache: true, fallback: true });
  assert.equal(hitsOf(a.svg).length, 11);
  assert.equal(hitsOf(x.svg).length, 0);
  assert.equal(hitsOf(b.svg).length, 11);
});

test('P5-B2 앱(app.js)은 더 이상 후처리로 클릭 영역을 붙이지 않는다', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.equal(/note-hit/.test(app), false, 'app.js에 note-hit 후처리가 없다');
  assert.equal(/createElementNS\([^)]*ellipse/.test(app), false);
});

test('P5-B2 내보내기·인쇄 경로는 모두 export 옵션을 넘긴다 — 화면용 render 호출은 app.js의 relayout 한 곳뿐', async () => {
  const { readdirSync } = await import('node:fs');
  const calls = [];
  for (const file of readdirSync(new URL('../js/', import.meta.url)).filter(name => name.endsWith('.js') && name !== 'engrave.js')) {
    const src = readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bE\.render\(([^;]*)/g)) calls.push({ file, args: m[1] });
    for (const m of src.matchAll(/\bE\.renderForExport\(/g)) calls.push({ file, args: 'renderForExport' });
  }
  const screen = calls.filter(call => call.args !== 'renderForExport' && !/export:\s*true/.test(call.args));
  assert.deepEqual(screen.map(call => call.file), ['app.js'], '화면용 render 호출은 app.js 한 곳(relayout)');
  const exporting = calls.filter(call => !screen.includes(call));
  assert.ok(exporting.length >= 2 && exporting.every(call => call.file === 'export-ui.js'), 'SVG·PNG 내보내기와 인쇄: export-ui.js의 두 경로');
});

test('P5-B2 작게 줄인 음표머리(noteheadScale)에서도 클릭 영역은 최소 크기(rx 6·ry 5)를 지킨다', () => {
  const s = C.createScore({ measureCount: 1 });
  s.style = { ...(s.style || {}), noteheadScale: 0.6 };
  put(s, 0, [note('small', [pitch(0, 0, 4), pitch(2, 0, 4)], 2), note('small2', [pitch(4, 0, 4)], 2)], 1, C.staffRefs(s)[0]);
  const r = render(s);
  const heads = [...r.layout.eventsById.values()].flatMap(le => le.noteheads);
  assert.equal(heads.length, 3);
  assert.ok(heads.every(head => head.width / 2 < 6 && head.height / 2 < 5), '머리 자체는 최소 크기보다 작다');
  const hits = hitsOf(r.svg);
  assert.equal(hits.length, 3);
  assert.ok(hits.every(([, , rx, ry]) => rx === 6 && ry === 5), `최소 크기 rx 6·ry 5: ${JSON.stringify(hits)}`);
});

test('P5-B2 클릭 영역 크기는 예전 후처리와 같다 — 온음표 rx 12, 그 밖의 음표 rx 6·ry 5, TAB 프렛 폭 따라 rx, 드럼 rx 6·ry 5', () => {
  const whole = C.createScore({ measureCount: 1 });
  put(whole, 0, [note('w', [pitch(0, 0, 4)], 1)], 1, C.staffRefs(whole)[0]);
  assert.deepEqual(hitsOf(render(whole).svg).map(h => h.slice(2)), [[12, 5]], '온음표(폭 24): rx 12, ry 5');

  const quarter = C.createScore({ measureCount: 1 });
  put(quarter, 0, [note('q', [pitch(0, 0, 4)], 4), note('q2', [pitch(1, 0, 4)], 4), note('q3', [pitch(2, 0, 4)], 4), note('q4', [pitch(3, 0, 4)], 4)], 1, C.staffRefs(quarter)[0]);
  assert.deepEqual(hitsOf(render(quarter).svg).map(h => h.slice(2)), [[6, 5], [6, 5], [6, 5], [6, 5]], '4분음표(폭 12·높이 10): 최소값 rx 6, ry 5');

  const tab = C.createScore({ measureCount: 1, parts: ['guitar-tab'] });
  const tabRef = C.staffRefs(tab).find(r => r.staff?.staffType === 'tab');
  put(tab, 0, [note('t1', [pitch(4, 0, 4)], 2, { tab: { string: 2, fret: 3 } }), note('t2', [pitch(2, 0, 5)], 2, { tab: { string: 1, fret: 15 } })], 1, tabRef);
  assert.deepEqual(hitsOf(render(tab).svg).map(h => h.slice(2)), [[6, 7], [9.5, 7]], 'TAB 한 자리 프렛(폭 12): rx 6, 두 자리 프렛(폭 19): rx 9.5, 높이 14: ry 7');

  const drum = C.createScore({ measureCount: 1, parts: ['drumkit'] });
  const drumRef = C.staffRefs(drum).find(r => r.staff?.staffType === 'percussion');
  put(drum, 0, [{ id: 'k', type: 'note', notes: [], drumId: 'kick', midi: 36, staffLine: 0, voice: 1, dur: { n: 1, d: 1, dots: 0 } }], 1, drumRef);
  assert.deepEqual(hitsOf(render(drum).svg).map(h => h.slice(2)), [[6, 5]], '드럼(폭 12·높이 10): rx 6, ry 5');
});

test('P5-B2 클릭 영역 좌표는 소수 둘째 자리로 반올림된다 — 조판의 부동소수 찌꺼기가 SVG에 남지 않는다', () => {
  const s = C.createScore({ measureCount: 1 });
  const evs = [0, 1, 2, 3].map(i => note(`e${i}`, [pitch(i, 0, 4)], 8)).concat([note('h1', [pitch(4, 0, 4)], 4), note('h2', [pitch(5, 0, 4)], 4)]);
  put(s, 0, evs, 1, C.staffRefs(s)[0]);
  const r = render(s);
  const drifted = [...r.layout.eventsById.values()].flatMap(le => le.noteheads).filter(head => head.x !== r2(head.x));
  assert.ok(drifted.length >= 2, '이 마디의 음표머리 x에는 부동소수 찌꺼기가 실제로 있다(테스트 전제)');
  const tags = r.svg.match(/<ellipse class="note-hit"[^>]*\/>/g) || [];
  assert.equal(tags.length, 6);
  assert.ok(tags.every(tag => !/\d\.\d{3,}/.test(tag)), `소수 셋째 자리 이상이 없다: ${tags.join(' ')}`);
});
