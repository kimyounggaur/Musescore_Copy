import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('js/auth.js','utf8');
function setup(hostname='musescore-copy.vercel.app', overrides=false){
  const store=new Map([['scoreforge.supabase.url','https://attacker.invalid'],['scoreforge.supabase.publishableKey','sb_publishable_evil']]);
  const loc={hostname,href:`https://${hostname}/?share=abcdefgh1234#access_token=secret`};
  const context={window:{SF:{core:{}},SF_ALLOW_CONNECTION_OVERRIDE:overrides,SF_SUPABASE_CONFIG:{url:'https://trusted.supabase.co',publishableKey:'sb_publishable_test'},location:loc},location:loc,localStorage:{getItem:k=>store.get(k)},URL,atob};
  vm.runInNewContext(source,context);return context.window.SF.auth;
}
test('production ignores stored connection overrides even when a developer flag is injected',()=>{
  const auth=setup('musescore-copy.vercel.app',true);
  assert.equal(auth.readSupabaseConfig().url,'https://trusted.supabase.co');
  assert.equal(auth.allowsConnectionOverride(),false);
});
test('connection overrides require both explicit opt-in and a loopback origin',()=>{
  assert.equal(setup('localhost').readSupabaseConfig().url,'https://trusted.supabase.co');
  assert.equal(setup('localhost',true).readSupabaseConfig().url,'https://attacker.invalid');
});
test('authentication email redirects never forward share links or session fragments',()=>{
  assert.equal(setup().authRedirectURL(),'https://musescore-copy.vercel.app/');
});
