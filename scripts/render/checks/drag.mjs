// drag the printer down and back; frames of the drive; does it stay after release, return after a scroll
import fs from 'node:fs';
import { readState, signedInPage } from '../../sandbox/lib.mjs';
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const state = readState();
const { browser, page, errors } = await signedInPage(state, { width: 1440, height: 900 });
await page.goto(state.base + '/slips', { waitUntil: 'networkidle', timeout: 120000 });
await page.evaluate(() => window.scrollTo(0, 300)); await page.waitForTimeout(1800);
const top = () => page.evaluate(() => document.querySelector('.sl-head-unit').getBoundingClientRect().top);
const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('.sl-head-unit')).cursor);
const t0 = await top(); const x = 1200, y = t0 + 60;
await page.mouse.move(x, y); await page.mouse.down();
const tops = [];
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(x, y + i * 4); await page.waitForTimeout(80);
  tops.push(Math.round(await top()));
  await page.screenshot({ path: `${out}/d${i}.png`, clip: { x: 980, y: (await top()) - 70, width: 70, height: 60 } });
}
await page.mouse.move(x, y + 200); await page.waitForTimeout(100);
await page.mouse.up(); await page.waitForTimeout(700);
const afterRelease = await top();
await page.mouse.wheel(0, 100); await page.waitForTimeout(2000);
const afterScroll = await top();
console.log(JSON.stringify({ cursor, t0, tops, afterRelease, afterScroll, errors }));
await browser.close();
