import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = [
  ['supabase.js', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.114.0/dist/umd/supabase.js'],
  ['supabase-LICENSE', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.114.0/LICENSE'],
  ['smplr/index.mjs', 'https://cdn.jsdelivr.net/npm/smplr@1.0.0/dist/index.mjs'],
  ['smplr/package.json', 'https://cdn.jsdelivr.net/npm/smplr@1.0.0/package.json'],
];
await mkdir('vendor/smplr', { recursive: true });
const manifest = [];
for (const [file, url] of files) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' ' + res.status);
  const data = Buffer.from(await res.arrayBuffer());
  await writeFile('vendor/' + file, data);
  manifest.push({ file, url, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length });
}
await writeFile('vendor/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest);
