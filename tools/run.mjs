// Headless Chrome check: loads the page, prints console output, screenshots.
//   node tools/run.mjs [url=http://localhost:8082/corsixth.html?dev] [seconds=20] [out=build/shot.png]
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:8082/corsixth.html?dev';
const secs = +(process.argv[3] || 20);
const out = process.argv[4] || 'build/shot.png';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
// Measures what SDL's ScriptProcessor outputs, so audio can be checked headless.
await page.addInitScript(() => {
  window.__audio = { blocks: 0, loud: 0, peak: 0 };
  const orig = AudioContext.prototype.createScriptProcessor;
  AudioContext.prototype.createScriptProcessor = function (...a) {
    const node = orig.apply(this, a);
    let cb = null;
    Object.defineProperty(node, 'onaudioprocess', {
      set(f) { cb = f; node.addEventListener('audioprocess', (e) => {
        cb(e);
        const d = e.outputBuffer.getChannelData(0);
        let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
        window.__audio.blocks++; if (m > 0.01) window.__audio.loud++;
        window.__audio.peak = Math.max(window.__audio.peak, m);
      }); },
      get() { return cb; },
    });
    return node;
  };
});
await page.goto(url);
// INSTALL=<file or dir>: go through the setup screen first.
if (process.env.INSTALL) {
  const fs = await import('node:fs');
  const isDir = fs.statSync(process.env.INSTALL).isDirectory();
  await page.setInputFiles(isDir ? '#dir' : '#file', process.env.INSTALL);
  await page.waitForSelector('#play', { state: 'visible', timeout: 600000 });
  await page.screenshot({ path: out.replace('.png', '-setup.png') });
}
await page.waitForSelector('#play', { state: 'visible' });
await page.click('#play');
for (let t = 0; t < secs; t += 5) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: out });
}
if (process.env.RESIZE) {
  const [w, h] = process.env.RESIZE.split(',').map(Number);
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out.replace('.png', '-resized.png') });
}
// Optional scripted clicks: CLICKS="x,y;x,y" (page coordinates, 3 s apart)
for (const c of (process.env.CLICKS || '').split(';').filter(Boolean)) {
  const [x, y] = c.split(',').map(Number);
  await page.mouse.click(x, y);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out.replace('.png', `-${x}-${y}.png`) });
}
console.log('audio:', JSON.stringify(await page.evaluate(() => window.__audio)));
await browser.close();
