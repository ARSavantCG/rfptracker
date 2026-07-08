const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:5000';
const TOKEN = 'o7YKFVvEIjnDUJHhaN0Z_45QQFygA7Vm';
const OUT = '/tmp/rfp-screenshots';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Auth
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(t => localStorage.setItem('auth-token', t), TOKEN);
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
    await wait(2500);

    // Click RFP-2026-018 row (currently cancelled)
    const clicked = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent && r.textContent.includes('RFP-2026-018'));
      if (row) { row.click(); return true; }
      return false;
    });
    console.log('row clicked:', clicked);
    await wait(2500);

    // Scroll to top to see the banner at the top of the panel
    await page.evaluate(() => {
      // scroll right panel to top
      const panel = document.querySelector('[class*="col-span"]') || document.querySelector('.lg\\:col-span-2');
      const allScrollable = Array.from(document.querySelectorAll('*')).filter(el =>
        el.scrollHeight > el.clientHeight + 20 && 
        getComputedStyle(el).overflow !== 'visible' &&
        getComputedStyle(el).overflow !== 'hidden'
      );
      allScrollable.forEach(el => el.scrollTop = 0);
      window.scrollTo(0, 0);
    });
    await wait(600);

    // Screenshot 1: top of cancelled workflow panel - should show banner with reason
    await page.screenshot({ 
      path: path.join(OUT, 'A-cancelled-panel-top.jpeg'), 
      type: 'jpeg', quality: 92 
    });
    console.log('SAVED A-cancelled-panel-top');

    // Scroll down a bit to see if reinstate button is lower
    await page.evaluate(() => {
      window.scrollTo(0, 300);
      Array.from(document.querySelectorAll('*')).filter(el =>
        el.scrollHeight > el.clientHeight + 20
      ).forEach(el => el.scrollTop += 200);
    });
    await wait(400);

    await page.screenshot({ 
      path: path.join(OUT, 'B-cancelled-panel-scrolled.jpeg'), 
      type: 'jpeg', quality: 92 
    });
    console.log('SAVED B-cancelled-panel-scrolled');

    // Check what text is visible
    const panelText = await page.evaluate(() => {
      // find any element containing "Reinstate" or "cancelled" 
      const all = Array.from(document.querySelectorAll('*'));
      const hits = all.filter(el => 
        el.childElementCount === 0 && 
        el.textContent && 
        (el.textContent.includes('Reinstate') || el.textContent.includes('cancelled') || el.textContent.includes('Cancelled'))
      ).map(el => el.textContent.trim()).slice(0, 10);
      return hits;
    });
    console.log('Panel text hits:', JSON.stringify(panelText));

    // Also: click the "Cancelled" filter pill to show filtered view
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const btn = btns.find(b => b.textContent.trim() === 'Cancelled');
      if (btn) { btn.click(); console.log('clicked cancelled pill'); }
    });
    await wait(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ 
      path: path.join(OUT, 'C-cancelled-filter-view.jpeg'), 
      type: 'jpeg', quality: 92 
    });
    console.log('SAVED C-cancelled-filter-view');

    // Now click on the one RFP showing in the filtered view
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent && r.textContent.includes('RFP-2026-018'));
      if (row) row.click();
    });
    await wait(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ 
      path: path.join(OUT, 'D-cancelled-panel-in-filter-view.jpeg'), 
      type: 'jpeg', quality: 92 
    });
    console.log('SAVED D-cancelled-panel-in-filter-view');

    // Now click Reinstate if visible
    const reinstateResult = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => /reinstate/i.test(b.textContent));
      if (btn) { 
        const rect = btn.getBoundingClientRect();
        return { found: true, text: btn.textContent.trim(), visible: rect.width > 0 && rect.height > 0, top: rect.top };
      }
      return { found: false };
    });
    console.log('Reinstate button:', JSON.stringify(reinstateResult));

    if (reinstateResult.found) {
      // Click it
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /reinstate/i.test(b.textContent));
        if (btn) btn.click();
      });
      await wait(3000);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ 
        path: path.join(OUT, 'E-after-reinstate.jpeg'), 
        type: 'jpeg', quality: 92 
      });
      console.log('SAVED E-after-reinstate');
    }

  } finally {
    await browser.close();
    console.log('DONE');
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
