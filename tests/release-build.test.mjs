import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareRelease } from './prepare-release.mjs';

test('release hashing is deterministic, includes lazy manuals and rejects stale deployment files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scoreforge-release-'));
  try {
    for (const dir of ['js', 'css', 'vendor', 'icons', 'fonts', 'manual'])
      await mkdir(path.join(root, dir));
    const fixture = {
      'package.json': '{"version":"3.0.1"}',
      'index.html': '<main>ScoreForge</main>',
      'manifest.webmanifest': '{}',
      'icons/icon.svg': '<svg/>',
      'icons/icon-192.png': 'png',
      'icons/icon-512.png': 'png',
      'fonts/Bravura.woff2': 'font',
      'js/version.js': 'window.SF.VERSION = "3.0.1";\n',
      'js/app.js': 'app v1',
      'sw.js': 'const CACHE_VERSION = "3.0.1";\n',
      'manual/illustration.png': 'manual v1',
    };
    for (const [file, data] of Object.entries(fixture))
      await writeFile(path.join(root, file), data);
    const first = await prepareRelease({ root });
    assert.match(first.version, /^3\.0\.1\+[a-f0-9]{16}$/);
    assert.equal(
      first.files.some((file) => file.startsWith('manual/')),
      false,
    );
    assert.equal((await prepareRelease({ root })).version, first.version);
    await prepareRelease({ root, check: true });
    await writeFile(path.join(root, 'js/app.js'), 'app v2');
    await assert.rejects(prepareRelease({ root, check: true }), /is stale/);
    const changed = await prepareRelease({ root });
    assert.notEqual(changed.version, first.version);
    await writeFile(path.join(root, 'manual/illustration.png'), 'manual v2');
    const manualChanged = await prepareRelease({ root });
    assert.notEqual(manualChanged.version, changed.version);
    assert.equal((await prepareRelease({ root })).version, manualChanged.version);
    assert.ok((await readFile(path.join(root, 'sw.js'), 'utf8')).includes(manualChanged.version));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
