import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);

test('UI architecture and shortcut table have one authoritative definition', async () => {
  const names = ['app', 'input', 'editing', 'panels', 'keymap', 'ui-dialog', 'ui-v3', 'palette', 'export-ui'];
  const sources = await Promise.all(names.map(name => readFile(new URL(`../js/${name}.js`, import.meta.url), 'utf8')));
  assert.ok(sources[0].split('\n').length <= 1600);
  for (const source of sources) assert.doesNotMatch(source, /\b(?:window\.)?(?:prompt|confirm)\s*\(|document\.execCommand/);
  const context = { window: { SF: {} } }; vm.runInNewContext(sources[4], context);
  const keymap = context.window.SF.keymap.KEYMAP;
  assert.equal(keymap.find(x => x.keys.includes('Ctrl+K')).action, 'applyChordSymbol');
  assert.equal(keymap.find(x => x.keys.includes('Ctrl+Shift+P')).action, 'openCommandPalette');
  for (const mode of ['normal', 'speedy']) {
    const keys = keymap.filter(x => x.mode === 'all' || x.mode === mode).flatMap(x => x.keys);
    assert.equal(new Set(keys).size, keys.length, `${mode}: duplicate shortcut`);
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script\s*>/);
  assert.ok(html.indexOf('js/auth.js') < html.indexOf('js/app.js'));
});

test('real browser UI editing, persistence, pagination, exports and responsive controls', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000 }, async t => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('scoreforge.welcomed', '1'));
  await page.goto(process.env.SF_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await page.waitForSelector('#svg-host .ev');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => SF.engrave.isFontReady());
  await mkdir('output/playwright', { recursive: true });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await settle();
  const reset = async (count = 8) => {
    await page.evaluate(count => {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      SF.app.setReadOnly(false); SF.app.actions.stopPlayback();
      Object.assign(SF.app.ui, { inputMode: false, speedy: false, selection: null, selAnchor: null, selectedNoteIdx: null, selectAll: false, cursorId: null, pageMode: 'continuous', viewMode: { type: 'full' }, zoom: 1, loop: null, loopIds: null });
      SF.core.setScore(SF.core.createScore({ measureCount: count }));
      SF.app.update({ immediate: true }); document.activeElement?.blur();
    }, count); await settle();
  };
  try {
    await t.test('selection leaves SVG and autosave intact; shortcuts and accessible dialog cancel work', async () => {
      await page.evaluate(() => { window.uiSvg = document.querySelector('#svg-host svg'); window.saveCalls = 0; const original = SF.io.autosave; SF.io.autosave = (...args) => { window.saveCalls++; return original(...args); }; SF.app.actions.select(SF.core.state.score.measures[0].events[0].id, { silent: true }); });
      await settle();
      assert.deepEqual(await page.evaluate(() => [uiSvg === document.querySelector('#svg-host svg'), saveCalls]), [true, 0]);
      await page.keyboard.press('Control+k');
      assert.equal(await page.locator('#lyric-editor').getAttribute('data-mode'), 'chord');
      await page.keyboard.press('Escape'); await page.keyboard.press('Control+Shift+p');
      assert.equal(await page.locator('#dlg-command').evaluate(el => el.open), true);
      await page.locator('#cmd-input').fill('반복 횟수');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dlg-prompt[open]');
      const before = await page.evaluate(() => SF.core.state.revision); await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => SF.core.state.revision), before);
      await page.locator('#btn-shortcuts').click(); await page.keyboard.press('Control+k');
      assert.equal(await page.locator('#shortcut-list .pulse').count(), 1);
      await page.keyboard.press('Escape');
    });
    await t.test('speedy 64th, 32nd, breve and double-dot lengths', async () => {
      for (const [key, value] of [['1', [1,64]], ['2', [1,32]], ['8', [2,1]]]) {
        await reset(); await page.keyboard.press('q'); await page.keyboard.press(key); await settle();
        assert.deepEqual(await page.evaluate(() => { const e=SF.core.findEvent(SF.core.state.score,SF.app.ui.lastInsertedId).ev;return [SF.app.ui.curDur.n,SF.app.ui.curDur.d,e.type]; }), [...value,'note']);
      }
      await reset(); await page.keyboard.press('q'); await page.keyboard.press('5'); await page.keyboard.press('.'); await page.keyboard.press('.'); await settle();
      assert.equal(await page.evaluate(() => SF.core.durValue(SF.core.findEvent(SF.core.state.score,SF.app.ui.lastInsertedId).ev.dur).toString()), '7/16');
    });
    await t.test('individual chord head selection, transposition, deletion, decorated duration and paste', async () => {
      await reset();
      const id=await page.evaluate(() => {
        const C=SF.core;let id;C.mutate('test chord',s=>{id=C.inputAt(s,0,SF.Fraction.ZERO,{n:1,d:4,dots:0},[{step:0,alter:0,oct:4},{step:2,alter:0,oct:4},{step:4,alter:0,oct:4}]);Object.assign(C.findEvent(s,id).ev,{staffText:'pizz.',soundFlag:'pizzicato',color:'#884488',ornament:'turn'});});SF.app.update({immediate:true});return id;
      });
      await page.locator(`[data-ref="${id}"] [data-note="1"] .note-hit`).click(); await settle();
      assert.equal(await page.evaluate(() => SF.app.ui.selectedNoteIdx), 1);
      const old=await page.evaluate(() => SF.app.actions.selectedEvent().ev.notes.map(SF.core.midiOf));
      await page.keyboard.press('ArrowUp'); await settle();
      const moved=await page.evaluate(() => SF.app.actions.selectedEvent().ev.notes.map(SF.core.midiOf));
      assert.deepEqual(moved, [old[0],old[1]+1,old[2]]);
      await page.keyboard.press('Delete');await settle();
      assert.equal(await page.evaluate(() => SF.app.actions.selectedEvent().ev.notes.length),2);
      await page.keyboard.press('Alt+0');await page.keyboard.press('4');await settle();
      assert.deepEqual(await page.evaluate(() => {const e=SF.app.actions.selectedEvent().ev;return [e.dur.d,e.staffText,e.soundFlag,e.color,e.ornament];}),[8,'pizz.','pizzicato','#884488','turn']);
      await page.keyboard.press('Control+c');await page.keyboard.press('ArrowRight');await page.keyboard.press('Control+v');await settle();
      assert.equal(await page.evaluate(() => SF.app.actions.selectedEvent().ev.ornament),'turn');
    });
    await t.test('measure insert/delete, meter, key, clef, split/join and pickup', async () => {
      await reset(4);await page.evaluate(()=>SF.app.actions.select(SF.core.state.score.measures[1].events[0].id,{silent:true}));await settle();
      await page.locator('#measure-key').selectOption('2');await page.locator('#canvas').focus();await settle();
      await page.locator('#measure-clef').selectOption('alto');await page.locator('#canvas').focus();await settle();
      await page.locator('#measure-time').fill('3/4');await page.locator('#measure-time').press('Tab');await page.locator('#canvas').focus();await settle();
      assert.deepEqual(await page.evaluate(()=>[SF.core.keySigAt(SF.core.state.score,1),SF.core.clefAt(SF.core.activeRef(SF.core.state.score),1),SF.core.measureLenAt(SF.core.state.score,1).toString()]),[2,'alto','3/4']);
      const count=await page.evaluate(()=>SF.core.state.score.measures.length);
      await page.locator('#measure-before').click();await page.locator('#canvas').focus();await settle();
      assert.equal(await page.evaluate(()=>SF.core.state.score.measures.length),count+1);
      await page.locator('#measure-delete').click();await page.locator('#canvas').focus();await settle();
      assert.equal(await page.evaluate(()=>SF.core.state.score.measures.length),count);
      await reset(2);await page.evaluate(()=>SF.app.actions.select(SF.core.state.score.measures[0].events[0].id,{silent:true}));await settle();
      await page.locator('#measure-split').click();await page.locator('#prompt-value').fill('1/2');await page.locator('#dlg-prompt button[type=submit]').click();await page.locator('#canvas').focus();await settle();
      assert.equal(await page.evaluate(()=>SF.core.state.score.measures.length),3);
      await page.locator('#measure-join').click();await page.locator('#canvas').focus();await settle();assert.equal(await page.evaluate(()=>SF.core.state.score.measures.length),2);
      await page.locator('#measure-pickup').click();await page.locator('#prompt-value').fill('1/4');await page.locator('#dlg-prompt button[type=submit]').click();await settle();assert.equal(await page.evaluate(()=>SF.core.measureLenAt(SF.core.state.score,0).toString()),'1/4');
    });
    await t.test('actual mutations autosave exact revision and history labels coalesce', async () => {
      await reset();await page.evaluate(()=>{SF.core.mutate('검증',s=>{s.meta.title='변경';});SF.core.mutate('빠르기',s=>s.tempo=100,{coalesce:'tempo'});SF.core.mutate('빠르기',s=>s.tempo=105,{coalesce:'tempo'});});
      await page.waitForFunction(()=>SF.core.isAutosaved());
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('scoreforge.autosave.v1')).revision===SF.core.state.revision),true);
      assert.match(await page.locator('#btn-undo').getAttribute('title'),/빠르기/);
      await page.locator('#btn-undo').click();assert.equal(await page.evaluate(()=>SF.core.state.score.tempo),100);
      await page.evaluate(()=>SF.app.setReadOnly(true));const revision=await page.evaluate(()=>SF.core.state.revision);await page.keyboard.press('Control+z');await page.evaluate(()=>SF.app.actions.pasteClipboard());assert.equal(await page.evaluate(()=>SF.core.state.revision),revision);await page.evaluate(()=>SF.app.setReadOnly(false));
    });
    await t.test('pages keep coordinates, title editing and vector/font exports', async () => {
      await reset(48);await page.evaluate(()=>SF.core.mutate('페이지 검증',s=>{s.layout.measuresPerSystem=4;}));await page.locator('#page-mode').selectOption('pages');await settle();assert.ok(await page.locator('#svg-host svg.page').count()>1);
      await page.locator('#score-svg-page-1 [data-ref]').first().click();await settle();assert.ok(await page.evaluate(()=>SF.app.actions.selectedEvent().m)>0);
      assert.equal(await page.evaluate(()=>{const el=document.querySelector('#score-svg-page-1 [data-ref]');const r=el.getBoundingClientRect();const p=SF.app.actions.svgPoint({target:el,clientX:r.x+r.width/2,clientY:r.y+r.height/2});return SF.engrave.hitTest(p.x,p.y).page;}),1);
      await page.locator('#score-svg-page-0 [data-meta=title]').click();await page.locator('#score-meta-editor').fill('검증 제목');await page.locator('#score-meta-editor').press('Enter');await settle();assert.equal(await page.evaluate(()=>SF.core.state.score.meta.title),'검증 제목');
      const info=await page.evaluate(async()=>{const before=SF.engrave.getLayout();const result=await SF.exportUI.exportPages();return {pages:result.pages.length,font:result.pages[0].includes('data:font/woff2;base64,'),same:before===SF.engrave.getLayout()};});assert.ok(info.pages>1&&info.font&&info.same);
      await page.screenshot({path:'output/playwright/ui-v3-pages.png'});
    });
    await t.test('folded measure navigation, piano keyboard input, transport rate and live mixer are connected', async () => {
      await reset(8);await page.locator('#view-select').selectOption('0');await settle();assert.equal(await page.evaluate(()=>SF.engrave.getLayout().multiRest),true);
      await page.evaluate(()=>SF.app.actions.scrollToMeasure(5));await settle();assert.equal(await page.evaluate(()=>SF.app.actions.selectedEvent().m),5);
      await page.locator('#canvas').focus();await page.keyboard.press('n');await settle();assert.equal(await page.evaluate(()=>SF.engrave.getLayout().multiRest),false);
      await page.locator('#piano-keys [data-midi="60"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.midi),'61');
      await page.keyboard.press('Enter');await settle();assert.equal(await page.evaluate(()=>SF.core.midiOf(SF.core.findEvent(SF.core.state.score,SF.app.ui.lastInsertedId).ev.notes[0])),61);assert.equal(await page.locator('#piano-keys [tabindex="0"]').count(),1);
      await page.locator('#canvas').focus();await page.keyboard.press('Escape');
      const old=await page.evaluate(()=>[SF.core.state.revision,SF.core.state.score.tempo]);await page.locator('#playback-rate').selectOption('2');assert.deepEqual(await page.evaluate(()=>[SF.core.state.revision,SF.core.state.score.tempo]),old);
      await page.evaluate(()=>{window.mixerCalls=0;const update=SF.playback.updateMixer;SF.playback.updateMixer=(...args)=>{window.mixerCalls++;return update(...args);};});
      await page.locator('#btn-mixer').click();await page.locator('[data-mix=mute]').first().check();assert.equal(await page.evaluate(()=>window.mixerCalls),1);await page.keyboard.press('Escape');
    });
    await t.test('MIDI options, safe names, responsive properties and accessibility', async () => {
      await reset();
      await page.evaluate(()=>{SF.io.requestMidiOptions({tracks:[{index:0,name:'<img src=x onerror=alert(1)>'}]},{name:'검증.mid'}).then(v=>window.midiOptionResult=v);});
      await page.locator('#midi-grid').selectOption(String(1/32));await page.locator('#midi-triplets').check();await page.locator('#dlg-midi-import button[type=submit]').click();assert.deepEqual(await page.evaluate(()=>window.midiOptionResult),{grid:1/32,detectTriplets:true,tracks:[0]});
      await page.evaluate(()=>{SF.core.mutate('이름',s=>{s.parts[0].name='<img src=x onerror=alert(1)>';});SF.app.update({immediate:true});});assert.equal(await page.locator('#staff-select img,#view-select img').count(),0);
      for(const [width,height]of [[375,812],[768,1024]]) {
        await page.setViewportSize({width,height});await page.evaluate(()=>{document.querySelector('#properties-panel').classList.add('collapsed');SF.app.update();});await settle();
        await page.locator('#btn-props').click();assert.equal(await page.locator('#properties-panel').isVisible(),true);await page.screenshot({path:`output/playwright/ui-v3-${width}-properties.png`});await page.locator('#btn-props-close').click();
        await page.locator('#palette-tab-duration').click();await page.screenshot({path:`output/playwright/ui-v3-${width}-palette.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await page.setViewportSize({width:1440,height:1080});await settle();
      if(process.env.AXE_MODULE) {
        await page.addScriptTag({path:process.env.AXE_MODULE});
        for(const theme of ['dark','light','pretty','cute']) {
          await page.locator('#theme-select').selectOption(theme);
          const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.filter(v=>v.impact==='critical').map(v=>({id:v.id,help:v.help}));});assert.deepEqual(violations,[],theme);
        }
      }
    });
    await t.test('actual playback keeps live mixer running, selected loop, count-in and click seek', async () => {
      await reset();await page.evaluate(()=>{SF.core.setScore(SF.io.DEMOS.butterfly());const ids=SF.core.state.score.measures[0].events.map(e=>e.id);SF.app.ui.selection=ids[0];SF.app.ui.selAnchor=ids.at(-1);SF.app.update({immediate:true});});
      await page.locator('#canvas').focus();await page.keyboard.press('Control+l');await settle();
      assert.ok(await page.evaluate(()=>SF.app.ui.loop.endSec>SF.app.ui.loop.startSec));assert.ok(await page.locator('.loop-overlay').count());
      await page.locator('#btn-metronome').click();await page.locator('#count-in').check();await page.locator('#btn-play').click();await page.waitForFunction(()=>SF.playback.player.playing);
      await page.locator('#btn-mixer').click();await page.locator('[data-mix=solo]').first().check();assert.equal(await page.evaluate(()=>SF.playback.player.playing),true);await page.keyboard.press('Escape');
      await page.locator('#btn-loop').click();
      const target=await page.evaluate(()=>SF.core.state.score.measures[2].events[0].id);await page.locator(`[data-ref="${target}"] .note-hit`).first().click();
      assert.ok(await page.evaluate(()=>SF.playback.pausePos())>1);
      await page.locator('#btn-stop').click();assert.equal(await page.evaluate(()=>SF.playback.player.playing),false);
    });
    await t.test('PNG download has A4 300dpi pixels and density metadata; baseline browser round trips pass', async () => {
      await reset(2);const pending=page.waitForEvent('download');await page.evaluate(()=>SF.exportUI.download('png'));const download=await pending;
      const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const buffer=Buffer.concat(chunks);
      assert.equal(buffer.readUInt32BE(16),2480);assert.equal(buffer.readUInt32BE(20),3508);
      const density=buffer.indexOf(Buffer.from('pHYs'));assert.ok(density>0);assert.equal(buffer.readUInt32BE(density+4),11811);
      const regression=await browser.newPage();await regression.goto((process.env.SF_URL||'http://127.0.0.1:8000')+'/tests/browser.html');await regression.waitForFunction(()=>window.__TEST_RESULT);assert.equal(await regression.evaluate(()=>window.__TEST_RESULT.fail),0);await regression.close();
    });
    await t.test('touch tap input, long press context menu and two-finger pinch work on a phone', async () => {
      const phone=await browser.newPage({viewport:{width:375,height:812},hasTouch:true,isMobile:true,deviceScaleFactor:1});
      phone.on('pageerror',e=>errors.push(e.message));await phone.addInitScript(()=>localStorage.setItem('scoreforge.welcomed','1'));await phone.goto(process.env.SF_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
      await phone.evaluate(()=>{SF.core.setScore(SF.core.createScore({measureCount:4}));SF.app.actions.setInputMode(true);SF.app.update({immediate:true});});
      const point=await phone.evaluate(()=>{const le=SF.engrave.getLayout().eventsById.values().next().value,svg=document.querySelector('#svg-host svg'),r=svg.getBoundingClientRect(),s=r.width/svg.viewBox.baseVal.width;return{x:r.left+le.x*s,y:r.top+le.staff.middleY*s};});
      await phone.touchscreen.tap(point.x,point.y);assert.ok(await phone.evaluate(()=>SF.core.state.score.measures[0].events.some(e=>e.type==='note')));
      await phone.evaluate(()=>{SF.app.actions.setInputMode(false);SF.app.update({immediate:true});});
      const cdp=await phone.context().newCDPSession(phone);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});await phone.waitForSelector('#measure-context');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.equal(await phone.locator('#measure-context').isVisible(),true);await phone.evaluate(()=>document.querySelector('#measure-context').remove());
      const box=await phone.locator('#canvas').boundingBox(),y=box.y+Math.min(140,box.height/2),before=await phone.evaluate(()=>SF.app.ui.zoom);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:130,y},{id:2,x:230,y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:90,y},{id:2,x:270,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.ok(await phone.evaluate(()=>SF.app.ui.zoom)>before);await phone.screenshot({path:'output/playwright/ui-v3-touch.png'});await phone.close();
    });
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
