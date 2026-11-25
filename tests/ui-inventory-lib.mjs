// P9-1 화면 조작 요소 세기 + docs/UI_INVENTORY.md 만들기.
// 생성기(tests/tools/gen-ui-inventory.mjs)와 시험(tests/ui-simplify-browser.test.mjs)이 같은 함수를 쓴다. 그래서 문서의 숫자와
// 분류표가 실제 화면과 어긋나면 시험이 실패한다.
//
// 측정 방법(설계서의 "155개"는 세는 방법이 적혀 있지 않아 같은 숫자를 다시 만들 수 없었다. 이 저장소의 방법을 코드로 고정한다):
//   조작 요소 = `button, input, select, textarea, [role="menuitem"], [role="tab"]` 중 type=hidden이 아닌 것(악보 SVG 안은 제외).
//   "화면 조작 요소" = 대화상자(<dialog>) 밖의 것. "보이는 것" = 크기가 있고 visibility가 hidden이 아닌 것.
//   조건: 1440×900 창, 한국어, 환영 창 닫음, 첫 음표 선택(속성 패널에 음표 패널이 보이는 상태), 팝오버·대화상자는 모두 닫힘.
//   팝오버 안(파일 메뉴 등)·모바일 전용(빠른 막대·탭)·드럼 패드·잠금 안내는 DOM에는 있어도 이 조건에서는 보이지 않는다.
export const CONTROL_SELECTOR = 'button, input, select, textarea, [role="menuitem"], [role="tab"]';
export const VIEWPORT = { width: 1440, height: 900 };

/** 측정 조건(위 주석)대로 앱을 연다. 보기 수준 저장값은 지우고 시작한다(처음 방문한 사람과 같은 상태). */
export async function openForInventory(page, url) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => { try { localStorage.setItem('scoreforge.welcomed', '1'); localStorage.removeItem('sf.viewLevel'); } catch (err) { /* 저장소를 못 쓰면 그대로 */ } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.waitForFunction(() => SF.engrave.isFontReady());
  await page.evaluate(() => {
    const id = SF.core.state.score.measures[0].events[0].id;
    document.querySelector(`[data-ref="${id}"] .note-hit`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForSelector('#note-v3', { state: 'attached' });
}

const REGIONS = [
  ['header', '위쪽 줄'], ['#file-menu', '파일 메뉴(팝오버)'], ['.palette-bar', '입력 팔레트'], ['#drum-pad', '드럼 패드'],
  ['#properties-panel', '속성 패널'], ['.statusbar', '아래 막대'], ['#lock-banner', '잠금 안내'], ['#sample-wait', '음원 대기 안내'],
  ['#lyric-editor', '가사 입력칸']
];

/** 화면에서 조작 요소를 모은다. 보기 수준은 바꾸지 않는다(부르는 쪽이 정한다). */
export async function collectControls(page) {
  return page.evaluate(({ selector, regions }) => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const VL = window.SF.viewLevel;
    const refOf = el => {
      if (el.id) return `#${el.id}`;
      for (const name of el.getAttributeNames()) {
        if (name.startsWith('data-') && name !== 'data-tier' && el.getAttribute(name) !== '') return `[${name}="${el.getAttribute(name)}"]`;
      }
      const cls = String(el.className || '').split(/\s+/).filter(Boolean)[0];
      return el.tagName.toLowerCase() + (cls ? `.${cls}` : '');
    };
    const labelOf = el => {
      const aria = clean(el.getAttribute('aria-label'));
      if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return aria || clean(el.title) || clean(el.getAttribute('placeholder')) || el.tagName.toLowerCase();
      return clean(el.textContent) || aria || clean(el.title);
    };
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      if (el.type === 'hidden' || el.closest('svg, #svg-host, template')) continue;
      const dialog = el.closest('dialog');
      const style = getComputedStyle(el);
      const tagged = el.closest('[data-tier]');
      const rows = VL?.TIERS || [];
      const why = tagged ? (rows.filter(r => { try { return tagged.matches(r.sel) && r.tier === tagged.dataset.tier; } catch (e) { return false; } }).at(-1)?.why || '') : '';
      let region = dialog ? `대화상자 #${dialog.id}` : '기타';
      if (!dialog) for (const [sel, name] of regions) if (el.closest(sel)) { region = name; break; }
      out.push({
        ref: refOf(el), tag: el.tagName.toLowerCase(), label: labelOf(el).slice(0, 40), region, inDialog: !!dialog,
        visible: el.getClientRects().length > 0 && style.visibility !== 'hidden',
        tier: tagged ? tagged.dataset.tier : 'basic', why
      });
    }
    return out;
  }, { selector: CONTROL_SELECTOR, regions: REGIONS });
}

/** 고급 보기와 기본 보기에서 각각 모아 합친다. 끝나면 원래 보기 수준으로 되돌린다. */
export async function collectInventory(page) {
  const original = await page.evaluate(() => SF.viewLevel.get());
  const gather = async level => {
    await page.evaluate(l => SF.viewLevel.set(l), level);
    return collectControls(page);
  };
  const advanced = await gather('advanced');
  const basic = await gather('basic');
  await page.evaluate(l => SF.viewLevel.set(l), original);
  if (advanced.length !== basic.length) throw new Error(`보기를 바꾸자 조작 요소 수가 달라졌다: ${advanced.length} → ${basic.length}`);
  const controls = advanced.map((a, i) => ({ ...a, visibleAdvanced: a.visible, visibleBasic: basic[i].visible }));
  for (const c of controls) delete c.visible;
  const outside = controls.filter(c => !c.inDialog);
  const count = (list, key) => list.filter(c => c[key]).length;
  return {
    controls,
    counts: {
      total: controls.length,
      dialogs: controls.filter(c => c.inDialog).length,
      outside: outside.length,
      visibleAdvanced: count(outside, 'visibleAdvanced'),
      visibleBasic: count(outside, 'visibleBasic'),
      tiers: { basic: outside.filter(c => c.tier === 'basic').length, advanced: outside.filter(c => c.tier === 'advanced').length, rare: outside.filter(c => c.tier === 'rare').length }
    }
  };
}

const cell = text => String(text ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim() || '—';
const TIER_NAME = { basic: '기본', advanced: '고급', rare: '드묾' };

/** docs/UI_INVENTORY.md 본문. 같은 입력이면 항상 같은 글이 나온다(날짜·시각을 넣지 않는다). */
export function renderInventory({ controls, counts }) {
  const lines = [];
  const push = (...l) => lines.push(...l);
  push('# ScoreForge 화면 조작 요소 분류표', '',
    '> `node tests/tools/gen-ui-inventory.mjs`가 만든 문서입니다. 손으로 고치지 말고 `js/view-level.js`의 분류표(`TIERS`)를 고친 뒤 다시 만드세요.',
    '> `tests/ui-simplify-browser.test.mjs`가 이 문서와 실제 화면이 같은지 확인합니다.', '',
    '## 숫자', '',
    '| 구분 | 개수 |', '| --- | ---: |',
    `| DOM에 있는 조작 요소 전체(대화상자 포함) | ${counts.total} |`,
    `| 그중 대화상자 안 | ${counts.dialogs} |`,
    `| **화면 조작 요소**(대화상자 밖) | ${counts.outside} |`,
    `| 고급 보기에서 보이는 것 | ${counts.visibleAdvanced} |`,
    `| **기본 보기에서 보이는 것** | **${counts.visibleBasic}** |`,
    `| 분류: 기본 / 고급 / 드묾 | ${counts.tiers.basic} / ${counts.tiers.advanced} / ${counts.tiers.rare} |`, '',
    '- 설계서의 "조작 요소 155개"는 세는 방법이 적혀 있지 않아 같은 숫자를 다시 만들 수 없었습니다. 위 숫자는 아래 방법으로 잰 이 저장소의 값입니다.',
    '- **측정 방법** (`tests/ui-inventory-lib.mjs`): `button·input·select·textarea·[role=menuitem]·[role=tab]` 중 type=hidden이 아닌 것(악보 SVG 안 제외).',
    '  "화면 조작 요소"는 `<dialog>` 밖의 것, "보이는 것"은 크기가 있고 `visibility`가 hidden이 아닌 것입니다.',
    '  조건은 1440×900 창·한국어·환영 창 닫음·첫 음표 선택·팝오버와 대화상자 모두 닫힘입니다.',
    '- 파일 메뉴 같은 팝오버 안, 모바일 전용 빠른 막대·탭, 드럼 패드, 잠금 안내는 DOM에는 있어도 이 조건에서는 보이지 않으므로 "보이는 것"에 들어가지 않습니다.',
    '- 분류에서 **기본**은 `TIERS`에 없는 모든 요소입니다(새로 만든 조작은 먼저 보이도록 한 안전한 기본값).',
    '- **고급**과 **드묾**은 기본 보기에서 똑같이 숨겨지고(고급 보기에서는 모두 보임), 드묾은 "화면에서 없애도 되는 후보"를 가려내는 표시일 뿐 이번 단계에서 지우지 않았습니다.',
    '- 숨긴 기능도 명령 팔레트(Ctrl+Shift+P)·단축키·메뉴에서는 그대로 쓸 수 있습니다.', '',
    '## 분류 원칙(초안 — 사람이 검토합니다)', '',
    '- **기본**: 악보 열기·저장·되돌리기·확대, 음높이·길이·쉼표·임시표·점·붙임줄·이음줄, 재생·메트로놈·빠르기, 제목·조표·박자, 기본 강약(pp~ff, 크레셴도·디미누엔도), 가사·코드 기호.',
    '- **고급**: 꾸밈음·글리산도·아르페지오·트레몰로·트릴·오타바, 연습 기호·문구, 쪽·구역 나눔, 믹서·타임라인·내비게이터·빈 보표 숨김·보기·스윙, 속성 패널의 위치 미세 조정·세기·꾸밈 칩, 반복 세부.',
    '- **드묾**: 관리자·계정 삭제·중복 단추·MIDI 장치 선택처럼 한 번 설정하면 거의 건드리지 않는 것.', '');
  const outside = controls.filter(c => !c.inDialog);
  const regions = [...new Set(outside.map(c => c.region))];
  push('## 화면 조작 요소 분류표', '');
  for (const region of regions) {
    const rows = outside.filter(c => c.region === region);
    push(`### ${region} (${rows.length}개)`, '', '| 요소 | 글자 | 분류 | 고급 보기 | 기본 보기 | 이유 |', '| --- | --- | --- | :-: | :-: | --- |');
    for (const c of rows) push(`| \`${cell(c.ref)}\` | ${cell(c.label)} | ${TIER_NAME[c.tier]} | ${c.visibleAdvanced ? '보임' : '–'} | ${c.visibleBasic ? '보임' : '–'} | ${cell(c.why)} |`);
    push('');
  }
  const dialogs = [...new Set(controls.filter(c => c.inDialog).map(c => c.region))];
  push('## 대화상자 안 조작 요소', '', '대화상자는 열었을 때만 보이므로 이번 분류 대상이 아닙니다(보기 수준과 상관없이 모두 기본).', '',
    '| 대화상자 | 개수 |', '| --- | ---: |');
  for (const d of dialogs) push(`| ${cell(d)} | ${controls.filter(c => c.inDialog && c.region === d).length} |`);
  push('');
  return lines.join('\n');
}
