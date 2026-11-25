// 악성 입력 시험용 악보 파일 생성기 — 실행: node tests/fixtures/make-xss-fixture.mjs
// 기준 악보(butterfly)의 문자열·숫자 자리에 마크업 모양의 값을 넣어 xss.scoreforge.json으로 저장한다.
// 이 파일은 시험 전용이다. 앱이 이 값들을 화면에 마크업으로 풀어 쓰면 security-browser 테스트가 실패한다.
import { readFileSync, writeFileSync } from 'node:fs';

export const PAYLOAD = '"><img src=x onerror="window.__xss=1"><svg onload="window.__xss=2"><iframe srcdoc="<script>parent.__xss=3</script>">';

const base = JSON.parse(readFileSync(new URL('../baseline/butterfly.scoreforge.json', import.meta.url), 'utf8'));
const score = JSON.parse(JSON.stringify(base));
const P = PAYLOAD;

for (const key of Object.keys(score.meta || {})) if (typeof score.meta[key] === 'string') score.meta[key] = P;
for (const key of ['title', 'subtitle', 'composer', 'lyricist', 'arranger', 'copyright']) score.meta[key] = P;
for (const part of score.parts) {
  part.name = P;
  for (const staff of part.staves || []) if ('name' in staff) staff.name = P;
}
for (const rec of Object.values(score.playbackSettings?.mixer || {})) { rec.volume = P; rec.pan = P; }

const measures = score.parts[0].staves[0].measures;
const firstNote = measures.flatMap(m => (m.voices ? m.voices.flat() : m.events || [])).find(e => e.type === 'note');
Object.assign(firstNote, { rehearsal: P, staffText: P, chordSymbol: { raw: P }, lyric: P, tempo: P, color: P, offsetX: P, offsetY: P, velocityOffset: P });
// v1 호환 별칭(events)이 같은 객체를 가리키지 않는 파일 형식이면 같은 값을 넣는다.
for (const m of measures) for (const ev of m.events || []) if (ev.id === firstNote.id) Object.assign(ev, firstNote);

writeFileSync(new URL('./xss.scoreforge.json', import.meta.url), JSON.stringify({ app: 'scoreforge', version: 1, score }, null, 1));
console.log('wrote tests/fixtures/xss.scoreforge.json, first note id =', firstNote.id);
