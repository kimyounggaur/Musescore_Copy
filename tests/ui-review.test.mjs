import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function modules(...names) {
  const context = vm.createContext({ console, Date, Math, Map, Set, WeakMap, SF: {} });
  context.window = context;
  for (const name of names) vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context);
  return context.SF;
}

function panelApi(SF) {
  const controls = new Map();
  const $ = selector => {
    if (!controls.has(selector)) controls.set(selector, {
      value: '', dataset: {}, handlers: {}, innerHTML: '',
      addEventListener(type, fn) { this.handlers[type] = fn; }, close() {},
    });
    return controls.get(selector);
  };
  const api = { C: SF.core, E: {}, P: {}, IO: {}, ui: {}, $, $$: () => [], Fraction: SF.Fraction,
    update() {}, applyZoom() {}, stopPlayback() {}, toast() {}, flashHint() {}, selectedMeasureRange: () => null,
    selectedIds: () => new Set(), targetEvent: () => null,
  };
  return { api, $ };
}

test('malicious event tempo cannot inject an attribute into properties markup', () => {
  const SF = modules('core', 'panels');
  SF.core.setScore(SF.core.createScore({ measureCount: 1 }));
  const id = SF.core.state.score.measures[0].events[0].id;
  SF.core.state.score.measures[0].events[0].tempo = '\"><img src=x onerror=attack()>';
  const { api, $ } = panelApi(SF);
  api.selectedIds = () => new Set([id]);
  SF.panels.create(api).renderPropertiesPanel();
  assert.doesNotMatch($('#properties-body').innerHTML, /attack|<img|onerror/);
  assert.match($('#properties-body').innerHTML, /data-prop="tempo"[^>]*value=""/);
});

test('canceling an ensemble change preserves all staff notes and history', async () => {
  const SF = modules('core', 'panels');
  const C = SF.core;
  const score = C.createScore({ measureCount: 1, ensemble: 'piano' });
  C.inputAt(score, 0, SF.Fraction.ZERO, { n: 1, d: 4 }, [{ step: 0, alter: 0, oct: 3 }], { partIdx: 0, staffIdx: 1 });
  C.setScore(score);
  const { api, $ } = panelApi(SF);
  let warning;
  SF.ui = { confirmDialog: async value => { warning = value; return false; } };
  $('#set-time').value = '4/4'; $('#set-key').value = '0'; $('#set-clef').value = 'treble'; $('#set-ensemble').value = 'solo';
  SF.panels.create(api).bindSettings();
  const before = JSON.stringify(C.toJSON(C.state.score));
  await $('#set-apply').handlers.click({ preventDefault() {} });
  assert.match(warning.message, /1개 음표·화음/);
  assert.equal(JSON.stringify(C.toJSON(C.state.score)), before);
  assert.equal(C.canUndo(), false);
});

test('compound meter display keeps internal quarter-note tempo unchanged', () => {
  const SF = modules('ui-v3');
  for (const num of [6, 9, 12]) {
    const score = { timeSig: { num, den: 8 }, tempo: 120 };
    assert.equal(SF.uiV3.tempoDisplay(score), 80);
    assert.equal(SF.uiV3.tempoFromDisplay(80, score), 120);
  }
  assert.equal(SF.uiV3.tempoDisplay({ timeSig: { num: 3, den: 8 }, tempo: 120 }), 120);
});

// Small DOM nodes exercise the actual translator's inline traversal and round trip.
function text(value) { return { nodeType: 3, nodeValue: value }; }
function element(tag, ...nodes) {
  const attrs = new Map();
  const result = { nodeType: 1, tagName: tag.toUpperCase(), childNodes: nodes, children: nodes.filter(n => n.nodeType === 1),
    closest: () => null, getAttribute: key => attrs.get(key) ?? null, hasAttribute: key => attrs.has(key),
    setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key),
    get textContent() { return nodes.map(n => n.nodeType === 3 ? n.nodeValue : n.textContent).join(''); },
  };
  nodes.forEach((node, i) => { node.parentElement = result; node.previousSibling = nodes[i - 1]; node.nextSibling = nodes[i + 1]; });
  return result;
}

test('English inline welcome text has word spaces and round trips to exact Korean', () => {
  const SF = modules('i18n');
  const lines = [
    element('div', text('보표를 '), element('b', text('클릭')), text('하거나 아래 '), element('b', text('피아노 건반')), text('을 눌러 음표 넣기')),
    element('div', element('kbd', text('스페이스')), text(' 키로 '), element('b', text('재생')), text('해서 들어보기')),
  ];
  const root = element('section', ...lines);
  const before = root.textContent;
  SF.i18n.init({ root, language: 'en' });
  assert.match(lines[0].textContent, /click or use/);
  assert.match(lines[1].textContent, /play and listen/);
  assert.equal(SF.i18n.audit(root).joinedWords.length, 0);
  SF.i18n.decorate(root);
  assert.doesNotMatch(lines[0].textContent, /click  or/);
  SF.i18n.setLanguage('ko');
  assert.equal(root.textContent, before);
});
