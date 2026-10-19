import { readState, signedInPage } from '../../sandbox/lib.mjs';
const out = process.argv[2]; const state = readState(); const res = [];
for (const dark of [false, true]) {
  const { browser, page, errors } = await signedInPage(state, { width: 1440, height: 900, dark });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(state.base + '/slips', { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(1200);
  const gl = await page.evaluate(() => !!document.querySelector('.sl-gl'));
  await page.screenshot({ path: `${out}-${dark ? 'dark' : 'light'}.png`, clip: { x: 980, y: 80, width: 460, height: 460 } });
  res.push({ dark, gl, errors }); await browser.close();
}
console.log(JSON.stringify(res));
