// node shots.mjs <outdir> [w h] — screenshots of /slips at scroll top / 400 / end, light and dark, + lens state
import fs from 'node:fs';
import { readState, signedInPage } from '../../sandbox/lib.mjs';
const [out, W = '1440', H = '900'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const state = readState(); const res = [];
for (const dark of [false, true]) {
  const { browser, page, errors } = await signedInPage(state, { width: +W, height: +H, dark });
  await page.goto(state.base + '/slips', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);
  for (const [label, y] of [['top', 0], ['mid', 400], ['end', 1e6]]) {
    await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(2500);
    const info = await page.evaluate(() => ({ gl: !!document.querySelector('.sl-head-unit.sl-gl'),
      head: document.querySelector('.sl-head-unit')?.getBoundingClientRect().top }));
    const f = `${out}/${dark ? 'dark' : 'light'}-${label}.png`;
    await page.screenshot({ path: f, clip: { x: +W - 560, y: 0, width: 560, height: +H } });
    res.push({ f, ...info });
  }
  res.push({ errors });
  await browser.close();
}
console.log(JSON.stringify(res));
