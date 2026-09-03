import { readdir, readFile, writeFile } from 'node:fs/promises';
const files = ['index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/Bravura.woff2'];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = dir + '/' + item.name;
    if (item.isDirectory()) await walk(file);
    else if (/\.(js|mjs|css|html|svg|png|jpe?g|woff2)$/.test(file)) files.push(file);
  }
}
for (const dir of ['js', 'css', 'vendor', 'manual']) await walk(dir);
await writeFile('precache-manifest.json', JSON.stringify([...new Set(files)].sort(), null, 2) + '\n');
console.log('Precache entries:', files.length);
const version = (await readFile('js/version.js', 'utf8')).match(/SF\.VERSION = "([^"]+)"/)[1];
if (!(await readFile('sw.js', 'utf8')).includes('CACHE_VERSION = "' + version + '"')) throw new Error('App/SW version mismatch');
