// D1(Supabase 프로젝트 분리) 전환 도구 — 새 프로젝트의 주소·공개 키로 앱 설정을 바꾼다. (설계서 8-5, 사람이 새 프로젝트를 만든 뒤 한 번 실행한다)
//
//   node tests/switch-supabase-project.mjs --url https://<ref>.supabase.co --key sb_publishable_… [--enable-delete-account] [--dry-run]
//
// 바꾸는 것: js/config.js의 프로젝트 주소·공개 키, vercel.json CSP의 supabase 주소(와일드카드 → 새 프로젝트 하나). --enable-delete-account를 주면 탈퇴 플래그도 켠다.
// 안 바꾸는 것: 그 밖의 모든 파일. 이 도구는 네트워크에 접속하지 않고, 비밀 키(sb_secret_·service_role)는 거절하며, 키 값을 출력하지 않는다.
// --root <폴더>: 저장소 대신 다른 폴더(임시 복사본 등)에 적용한다. 기본값은 이 파일이 있는 저장소.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SwitchError, findStaleReferences, switchProject } from './project-switch-lib.mjs';

const USAGE = `사용법: node tests/switch-supabase-project.mjs --url https://<ref>.supabase.co --key sb_publishable_… [--enable-delete-account] [--dry-run] [--root <폴더>]`;

function parseArgs(argv) {
  const options = { dryRun: false, enableDeleteAccount: false, root: fileURLToPath(new URL('..', import.meta.url)) };
  const take = (name, inline, index) => {
    if (inline !== undefined) return [inline, index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new SwitchError(`${name} 다음에 값을 주세요.\n${USAGE}`);
    return [value, index + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [name, ...rest] = argv[i].split('=');
    const inline = rest.length ? rest.join('=') : undefined;
    if (name === '--url') [options.url, i] = take(name, inline, i);
    else if (name === '--key') [options.key, i] = take(name, inline, i);
    else if (name === '--root') [options.root, i] = take(name, inline, i);
    else if (name === '--dry-run' && inline === undefined) options.dryRun = true;
    else if (name === '--enable-delete-account' && inline === undefined) options.enableDeleteAccount = true;
    else if (name === '--help' || name === '-h') { options.help = true; }
    else throw new SwitchError(`알 수 없는 옵션이에요: ${name.slice(0, 40)}\n${USAGE}`);
  }
  return options;
}

const TEXT_FILE = /\.(js|mjs|html|md|sql|ts|json|yml|yaml|webmanifest|txt)$/;
function collectFiles(root) {
  const files = new Map();
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (['node_modules', '.git', 'vendor', 'output', 'fonts', 'icons'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (TEXT_FILE.test(entry.name)) {
        try { if (statSync(path).size <= 2 * 1024 * 1024) files.set(relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8')); } catch { /* 못 읽는 파일은 건너뜀 */ }
      }
    }
  };
  walk(root);
  return files;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) { console.log(USAGE); return 0; }
  if (options.url === undefined || options.key === undefined) throw new SwitchError(`--url 과 --key 를 모두 주세요.\n${USAGE}`);
  const configPath = join(options.root, 'js', 'config.js'), vercelPath = join(options.root, 'vercel.json');
  let configText, vercelText;
  try { configText = readFileSync(configPath, 'utf8'); vercelText = readFileSync(vercelPath, 'utf8'); }
  catch { throw new SwitchError(`js/config.js 와 vercel.json 을 읽을 수 없어요(폴더: ${options.root}).`); }
  const result = switchProject({ configText, vercelText, url: options.url, key: options.key, enableDeleteAccount: options.enableDeleteAccount });
  const s = result.summary;
  const flag = { unchanged: '그대로(꺼짐 유지)', enabled: '켰어요', 'already-enabled': '이미 켜져 있어요' }[s.deleteAccount];
  console.log(`Supabase 프로젝트 전환 ${options.dryRun ? '미리보기 (dry-run — 파일은 바꾸지 않아요)' : '적용'}`);
  console.log(`  옛 주소: ${s.previousUrl || '(없음)'}`);
  console.log(`  새 주소: ${s.url}`);
  console.log(`  키 종류: ${s.keyKind} (키 값은 출력하지 않아요)`);
  console.log(`  vercel.json CSP: supabase 주소 ${s.cspTokens}곳을 새 프로젝트 하나로 맞췄어요`);
  console.log(`  탈퇴 플래그(deleteAccount): ${flag}`);
  if (options.dryRun) return 0;
  if (!s.changed) { console.log('이미 이 프로젝트로 바뀌어 있어요(바뀐 것이 없어요). 파일은 그대로 두었어요.'); return 0; }

  writeFileSync(configPath, result.config);
  try { writeFileSync(vercelPath, result.vercel); }
  catch (err) { writeFileSync(configPath, configText); throw new SwitchError(`vercel.json을 쓰지 못해 js/config.js도 되돌렸어요: ${err.code || err.message}`); }
  console.log('js/config.js, vercel.json 을 바꿨어요.');

  if (s.previousRef && s.previousRef !== s.ref) {
    const stale = findStaleReferences(collectFiles(options.root), s.previousRef);
    if (stale.length) {
      console.log('\n옛 프로젝트 주소가 아직 적힌 파일(내용은 사람이 확인하세요 — 옛 기록이면 그대로 둬도 돼요):');
      for (const item of stale) console.log(`  - ${item.file} (${item.count}곳)`);
    }
  }
  console.log('\n다음 순서:');
  console.log('  1. npm run release   ← 앱 파일(js/config.js)이 바뀌었으니 sw.js 해시 등 릴리스 파일을 다시 만들어요');
  console.log('  2. git diff 로 바뀐 줄을 확인하고(주소·공개 키·CSP 외에는 없어야 해요) 커밋 → 배포');
  console.log('  3. 새 프로젝트의 Auth 설정(URL Configuration·메일 문구·비밀번호 정책)을 다시 확인');
  console.log(s.deleteAccount === 'unchanged'
    ? '  4. 탈퇴 기능은 꺼져 있어요. 새 프로젝트에 delete-account Edge Function을 배포하고 ALLOWED_ORIGINS를 정한 뒤, --enable-delete-account 로 다시 실행하세요.'
    : '  4. 탈퇴 기능(deleteAccount)을 켰어요. delete-account Edge Function 배포와 ALLOWED_ORIGINS 설정이 끝난 뒤에만 이 변경을 배포하세요.');
  return 0;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (err) {
  if (err instanceof SwitchError) { console.error(`오류: ${err.message}`); process.exitCode = 1; }
  else { console.error(`예상하지 못한 오류: ${err && err.message}`); process.exitCode = 2; }
}
