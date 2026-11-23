// 배포 뒤 점검(P3-6): CSP 판정 함수와, 점검 스크립트가 실제로 좋은·나쁜 서버를 가려내는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectCsp } from './deploy-lib.mjs';
const run = promisify(execFile);

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const production = vercel.headers.flatMap(rule => rule.headers).find(header => header.key.toLowerCase() === 'content-security-policy').value;

test('운영 CSP(vercel.json)는 문제가 없다', () => assert.deepEqual(inspectCsp(production), []));
test('헤더가 없거나 비어 있으면 문제', () => { assert.equal(inspectCsp(undefined).length, 1); assert.equal(inspectCsp('').length, 1); });
test('CDN이 들어 있으면 문제', () => {
  assert.ok(inspectCsp("default-src 'self'; script-src 'self' https://cdn.jsdelivr.net").some(text => /CDN/.test(text)));
  assert.ok(inspectCsp("default-src 'self'; script-src 'self'; img-src https://unpkg.com").some(text => /CDN/.test(text)));
});
test("script-src가 없거나 'self'뿐이 아니면 문제", () => {
  assert.ok(inspectCsp("default-src 'self'").some(text => /script-src가 없/.test(text)));
  assert.ok(inspectCsp("default-src 'self'; script-src 'self' 'unsafe-inline'").some(text => /'self'뿐이 아니/.test(text)));
  assert.ok(inspectCsp("script-src https://example.com").some(text => /'self'뿐이 아니/.test(text)));
  assert.deepEqual(inspectCsp("SCRIPT-SRC 'self'; img-src data:"), [], '지시어 이름은 대소문자를 가리지 않는다');
});

test('점검 스크립트: SF_URL이 없으면 종료 코드 2', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const env = { ...process.env }; delete env.SF_URL;
  await assert.rejects(run(process.execPath, ['tests/verify-deploy.mjs'], { env }), error => error.code === 2 && /SF_URL/.test(error.stderr));
});

test('점검 스크립트: 운영과 같은 헤더를 내는 서버는 통과하고, CDN을 허용하는 서버는 CSP 문제로 실패한다', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const page = () => `<!doctype html><meta charset="utf-8"><title>t</title><div id="svg-host"><svg></svg></div><script src="/v.js"></script>`;
  const serve = (csp, { as = version, boom = false } = {}) => new Promise(resolve => {
    const server = createServer((req, res) => {
      if (req.url === '/v.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(`window.SF={VERSION:${JSON.stringify(as)}};${boom ? 'throw new Error("boom");' : ''}`); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp }); res.end(page());
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
  const policy = "default-src 'self'; script-src 'self'";
  const good = await serve(policy), bad = await serve("default-src 'self'; script-src 'self' https://cdn.jsdelivr.net");
  const old = await serve(policy, { as: '0.0.1' }), broken = await serve(policy, { boom: true });
  try {
    const env = base => ({ ...process.env, SF_URL: `http://127.0.0.1:${base.address().port}/` });
    const failure = async server => { try { await run(process.execPath, ['tests/verify-deploy.mjs'], { env: env(server) }); } catch (error) { assert.equal(error.code, 1); return JSON.parse(error.stderr); } assert.fail('통과하면 안 되는 서버가 통과했어요'); };
    const ok = await run(process.execPath, ['tests/verify-deploy.mjs'], { env: env(good) });
    assert.equal(JSON.parse(ok.stdout).ok, true); assert.equal(JSON.parse(ok.stdout).version, version);
    const cdn = await failure(bad);
    assert.ok(cdn.problems.some(text => /CDN/.test(text)) && cdn.problems.some(text => /'self'뿐이 아니/.test(text)));
    assert.ok((await failure(old)).problems.some(text => /VERSION\(0\.0\.1\)/.test(text)), '버전이 다르면 실패');
    assert.ok((await failure(broken)).problems.some(text => /페이지 오류 1건: .*boom/.test(text)), '첫 화면 페이지 오류가 있으면 실패');
  } finally { good.close(); bad.close(); old.close(); broken.close(); }
});
