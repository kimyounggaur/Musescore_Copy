// 일회용 도구(P9-7): manual/assets의 PNG 그림을 WebP로 바꿔 같은 폴더에 쓰고, 크기 비교표를 보여 준다.
// 원본 PNG는 지우지 않는다(바꾼 그림을 눈으로 확인한 뒤 따로 지운다 — 원본은 git 기록에 남는다).
// 브라우저(Chromium)의 canvas로 인코딩하므로 새 의존성이 없다.
//   PLAYWRIGHT_MODULE="$PWD/node_modules/playwright" node tests/tools/png-to-webp.mjs [품질 0~1(기본 0.85)] [폴더(기본 manual/assets)]
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { launchOptions } from '../browser-launch.mjs';

const quality = Number(process.argv[2] ?? 0.85);
const dir = process.argv[3] ?? 'manual/assets';
if (!(quality > 0 && quality <= 1)) throw new Error(`품질은 0보다 크고 1 이하여야 해요: ${process.argv[2]}`);

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const names = (await readdir(dir)).filter(name => name.endsWith('.png')).sort();
if (!names.length) throw new Error(`${dir}에 PNG가 없어요`);

const browser = await chromium.launch(launchOptions());
const rows = [];
try {
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  for (const name of names) {
    const png = await readFile(`${dir}/${name}`);
    const encoded = await page.evaluate(async ({ base64, q }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.getElementById('c');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const url = canvas.toDataURL('image/webp', q);
      return { url: url.slice(0, 22), data: url.slice(url.indexOf(',') + 1), width: image.naturalWidth, height: image.naturalHeight };
    }, { base64: png.toString('base64'), q: quality });
    if (!encoded.url.startsWith('data:image/webp')) throw new Error(`${name}: 이 브라우저는 WebP로 인코딩하지 못해요(${encoded.url})`);
    const webp = Buffer.from(encoded.data, 'base64');
    await writeFile(`${dir}/${name.replace(/\.png$/, '.webp')}`, webp);
    rows.push({ name, size: `${encoded.width}x${encoded.height}`, png: png.length, webp: webp.length });
  }
} finally { await browser.close(); }

const sum = key => rows.reduce((total, row) => total + row[key], 0);
console.log(`품질 ${quality}`);
for (const row of rows) console.log(`${row.name.padEnd(28)} ${row.size.padEnd(10)} PNG ${String(row.png).padStart(8)}  WebP ${String(row.webp).padStart(8)}  ${(row.webp / row.png * 100).toFixed(0)}%`);
console.log(`${'합계'.padEnd(28)} ${''.padEnd(10)} PNG ${String(sum('png')).padStart(8)}  WebP ${String(sum('webp')).padStart(8)}  ${(sum('webp') / sum('png') * 100).toFixed(0)}%`);
