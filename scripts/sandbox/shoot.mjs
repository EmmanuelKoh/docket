// Screenshot a page of the running sandbox, signed in.
//   node scripts/sandbox/shoot.mjs <route> <out.png> [--width 1440]
//     [--height 1000] [--dark] [--full] [--signed-out]
// Prints the console errors the page logged (hydration errors show here).

import fs from 'node:fs';
import path from 'node:path';
import { readState, signedInPage } from './lib.mjs';

const a = process.argv.slice(2);
const [route, out] = a;
if (!route || !out) {
  console.error('usage: node scripts/sandbox/shoot.mjs <route> <out.png> [--width N] [--dark] [--full]');
  process.exit(1);
}
const flag = (name) => a.includes(name);
const num = (name, d) => (a.includes(name) ? Number(a[a.indexOf(name) + 1]) : d);

const state = readState();
const { browser, page, errors } = await signedInPage(state, {
  width: num('--width', 1440),
  height: num('--height', 1000),
  dark: flag('--dark'),
  signedIn: !flag('--signed-out'),
});
await page.goto(state.base + route, { waitUntil: 'networkidle', timeout: 120_000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: out, fullPage: flag('--full') });
console.log(JSON.stringify({ shot: path.resolve(out), errors }));
await browser.close();
