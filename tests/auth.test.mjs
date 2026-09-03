import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = { window: { SF: {core: {}} }, atob };
vm.runInNewContext(readFileSync('js/auth.js', 'utf8'), context);
test('browser configuration accepts publishable/anon keys only', () => {
  const isPublic = context.window.SF.auth.isPublicKey;
  const token = role => 'e30.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.signature';
  assert.ok(isPublic('sb_publishable_example'));
  assert.ok(isPublic(token('anon')));
  assert.equal(isPublic(token('service_role')), false);
  assert.equal(isPublic('sb_secret_example'), false);
  assert.equal(isPublic('broken'), false);
});
