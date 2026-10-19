// Measure the feed module at several window sizes and scroll positions.
import { readState, signedInPage } from '../../sandbox/lib.mjs';
const state = readState();
const out = [];
for (const [w, h] of [[1440, 900], [1280, 800], [1920, 1080], [1180, 760]]) {
  const { browser, page } = await signedInPage(state, { width: w, height: h });
  await page.goto(state.base + '/slips?v=a', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(500);
  const m = async (label) => out.push({ w, h, label, ...(await page.evaluate(() => {
    const mech = document.querySelector('.sl-mech'); const hu = document.querySelector('.sl-head-unit');
    if (!mech) return { none: true };
    const a = mech.getBoundingClientRect(), b = hu.getBoundingClientRect();
    return { scrollY: Math.round(scrollY), room: document.documentElement.scrollHeight - innerHeight,
      mech: [a.left, a.top, a.width, a.height].map(Math.round), head: [b.left, b.top].map((v) => +v.toFixed(1)), headH: Math.round(hu.offsetHeight) };
  })) });
  await m('top');
  await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(1500); await m('400');
  await page.evaluate(() => window.scrollTo(0, 1e6)); await page.waitForTimeout(2500); await m('end');
  await browser.close();
}
console.log(JSON.stringify(out));
