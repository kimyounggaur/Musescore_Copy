import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSET_EXTENSION = /\.(js|mjs|css|html|svg|png|jpe?g|woff2|wav|mp3|ogg|m4a)$/;
const VERSION_PATTERN = /SF\.VERSION = "[^"]+"/;
const CACHE_PATTERN = /CACHE_VERSION = "[^"]+"/;

async function walk(root, dir) {
  const files = [];
  for (const item of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${item.name}`;
    if (item.isDirectory()) files.push(...(await walk(root, file)));
    else if (ASSET_EXTENSION.test(file)) files.push(file);
  }
  return files;
}

// Normalize generated fields to keep consecutive builds byte-for-byte stable.
export async function releaseArtifacts(root = process.cwd()) {
  const files = new Set([
    'index.html',
    'manifest.webmanifest',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'fonts/Bravura.woff2',
  ]);
  for (const dir of ['js', 'css', 'vendor']) {
    for (const file of await walk(root, dir)) files.add(file);
  }
  const precache = [...files].sort();
  const inputs = [...precache, 'sw.js', ...(await walk(root, 'manual'))].sort();
  const digest = createHash('sha256');
  for (const file of inputs) {
    let data = await readFile(path.join(root, file));
    if (file === 'js/version.js')
      data = Buffer.from(data.toString().replace(VERSION_PATTERN, 'SF.VERSION = "GENERATED"'));
    if (file === 'sw.js')
      data = Buffer.from(data.toString().replace(CACHE_PATTERN, 'CACHE_VERSION = "GENERATED"'));
    digest
      .update(file + '\0')
      .update(data)
      .update('\0');
  }
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = `${pkg.version.split('+')[0]}+${digest.digest('hex').slice(0, 16)}`;
  const sourceVersion = await readFile(path.join(root, 'js/version.js'), 'utf8');
  const sourceSW = await readFile(path.join(root, 'sw.js'), 'utf8');
  if (!VERSION_PATTERN.test(sourceVersion) || !CACHE_PATTERN.test(sourceSW))
    throw new Error('Missing generated release version markers');
  return {
    version,
    files: precache,
    artifacts: {
      'precache-manifest.json': JSON.stringify(precache, null, 2) + '\n',
      'js/version.js': sourceVersion.replace(VERSION_PATTERN, `SF.VERSION = "${version}"`),
      'sw.js': sourceSW.replace(CACHE_PATTERN, `CACHE_VERSION = "${version}"`),
    },
  };
}

export async function prepareRelease({ root = process.cwd(), check = false } = {}) {
  const result = await releaseArtifacts(root);
  for (const [file, expected] of Object.entries(result.artifacts)) {
    const target = path.join(root, file);
    if (check) {
      if ((await readFile(target, 'utf8')) !== expected)
        throw new Error(`${file} is stale. Run npm run build before publishing.`);
    } else await writeFile(target, expected);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await prepareRelease({ check: process.argv.includes('--check') });
  console.log(
    `Release ${result.version}: ${result.files.length} shell assets. Manual assets load on demand.`,
  );
}
