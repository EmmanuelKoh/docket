// node motion.mjs <outdir> — fast scroll, frames while the motor catches up, frame times
import fs from 'node:fs';
import { readState, signedInPage } from '../../sandbox/lib.mjs';
const [out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const state = readState();
const { browser, page, errors } = await signedInPage(state, { width: 1180, height: 760 });
await page.goto(state.base + '/slips', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 300)); await page.waitForTimeout(2000);
await page.evaluate(() => { window.__ft = []; let l = 0; const f = (t) => { if (l) window.__ft.push(t - l); l = t; if (window.__ft.length < 240) requestAnimationFrame(f); }; requestAnimationFrame(f); });
await page.evaluate(() => window.scrollTo(0, 1000));
const tops = [];
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(i === 0 ? 30 : 180);
  const top = await page.evaluate(() => document.querySelector('.sl-head-unit').getBoundingClientRect().top);
  tops.push(Math.round(top));
  await page.screenshot({ path: `${out}/m${i}.png`, clip: { x: 1180 - 470, y: 0, width: 470, height: 760 } });
}
await page.waitForTimeout(1500);
const ft = await page.evaluate(() => window.__ft);
const s = [...ft].sort((a, b) => a - b);
console.log(JSON.stringify({ tops, frames: ft.length, p50: s[Math.floor(s.length / 2)]?.toFixed(1), p95: s[Math.floor(s.length * 0.95)]?.toFixed(1), max: s.at(-1)?.toFixed(1), errors }));
await browser.close();
