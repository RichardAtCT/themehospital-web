// Saves the demo hospital, reloads the page and checks the save survived.
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:8082/corsixth.html?dev';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (/save|error|Error/i.test(m.text())) console.log(`[${m.type()}] ${m.text()}`); });
const wait = (s) => page.waitForTimeout(s * 1000);
await page.goto(url);
await page.click('#play');
await wait(12);
await page.mouse.click(511, 122); await wait(3);          // Campaign
await page.mouse.click(511, 122); await wait(6);          // first level
await page.mouse.click(657, 478); await wait(2);          // close the intro letter
await page.keyboard.press('Alt+Shift+S'); await wait(4);  // quick save
await page.keyboard.press('Control+F8'); await wait(1);
console.log('fs:', await page.evaluate(() => { const r=[]; const v=(d)=>{ for (const n of Module.FS.readdir(d)) { if(n==='.'||n==='..') continue; const p=d+'/'+n; if (Module.FS.isDir(Module.FS.stat(p).mode)) v(p); else r.push(p);} }; v("/persist"); return r; }));
console.log('saves after quicksave:', await page.$$eval('#saves li', (l) => l.map((x) => x.textContent)));
await page.screenshot({ path: 'build/save-1.png' });
await page.reload();
await page.click('#play');
await wait(12);
await page.keyboard.press('Control+F8'); await wait(1);
console.log('saves after reload:', await page.$$eval('#saves li', (l) => l.map((x) => x.textContent)));
await page.keyboard.press('Control+F8');
await page.mouse.click(511, 272); await wait(6);          // Continue Game
await page.screenshot({ path: 'build/save-2.png' });
await browser.close();
