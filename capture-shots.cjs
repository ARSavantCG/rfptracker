const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:5000';
const TOKEN = 'o7YKFVvEIjnDUJHhaN0Z_45QQFygA7Vm';
const OUT = '/tmp/rfp-screenshots';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function shot(page, name) {
  const p = path.join(OUT, name + '.jpeg');
  await page.screenshot({ path: p, type: 'jpeg', quality: 92, fullPage: false });
  console.log('SAVED:', p);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // ── Auth inject ──
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(t => localStorage.setItem('auth-token', t), TOKEN);
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
    await wait(2500);
    console.log('Page title:', await page.title());

    // ── SHOT 1: Dashboard with stats cards ──
    await shot(page, '01-dashboard-stats-cards');

    // ── Click RFP-2026-018 to open workflow panel ──
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent && r.textContent.includes('RFP-2026-018'));
      if (row) row.click();
    });
    await wait(2500);

    // ── SHOT 2: Workflow panel open (in-progress, shows Cancel button area) ──
    await shot(page, '02-workflow-panel-in-progress');

    // Scroll the page down to reveal Cancel button (it's at bottom of panel)
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach(el => {
        if (el.scrollHeight > el.clientHeight + 100) el.scrollTop += 500;
      });
      window.scrollTo(0, 500);
    });
    await wait(600);
    await shot(page, '03-cancel-button-visible');

    // ── Click Cancel RFP button ──
    const cancelBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => /cancel rfp/i.test(b.textContent));
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    console.log('Cancel btn:', cancelBtn);
    await wait(1200);
    await shot(page, '04-cancel-dialog-open');

    // ── Fill reason in dialog textarea ──
    await page.evaluate(() => {
      const ta = document.querySelector('textarea');
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, 'Tenant signed lease at competing property — broker confirmed 2026-07-08');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await wait(600);
    await shot(page, '05-cancel-dialog-with-reason');

    // ── Submit the dialog ──
    const submitBtn = await page.evaluate(() => {
      // In the dialog, find the rose/destructive submit button (not the X close)
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button, [data-radix-dialog-content] button'));
      if (!btns.length) {
        // fallback: all buttons
        const all = Array.from(document.querySelectorAll('button'));
        const b = all.find(b => /cancel rfp/i.test(b.textContent) || /confirm/i.test(b.textContent));
        if (b) { b.click(); return b.textContent.trim(); }
        return null;
      }
      // The submit button should contain "Cancel RFP" text
      const b = btns.find(b => /cancel rfp/i.test(b.textContent));
      if (b) { b.click(); return b.textContent.trim(); }
      // Last resort: click last button in dialog
      const last = btns[btns.length - 1];
      last.click();
      return last.textContent.trim();
    });
    console.log('Submit btn:', submitBtn);
    await wait(3000);

    // ── SHOT 6: After cancel — Cancelled badge on row ──
    await page.evaluate(() => window.scrollTo(0, 200));
    await wait(500);
    await shot(page, '06-cancelled-badge-on-row');

    // ── Click the cancelled RFP to open its panel ──
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent && r.textContent.includes('RFP-2026-018'));
      if (row) row.click();
    });
    await wait(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '07-cancelled-panel-banner-reason');

    // Scroll panel to show full banner + Reinstate button
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach(el => {
        if (el.scrollHeight > el.clientHeight + 50) el.scrollTop += 200;
      });
    });
    await wait(400);
    await shot(page, '08-reinstate-button-visible');

    // ── Click Reinstate ──
    const reinstateBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => /reinstate/i.test(b.textContent));
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    console.log('Reinstate btn:', reinstateBtn);
    await wait(3000);

    // ── SHOT 9: After reinstate — back to in-progress ──
    await page.evaluate(() => window.scrollTo(0, 200));
    await wait(500);
    await shot(page, '09-reinstated-in-progress-badge');

    // ── Re-cancel to show stats count with 1 cancelled ──
    await page.evaluate(async (token) => {
      return fetch('/api/rfp-requests/194/cancel', {
        method: 'PATCH',
        headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({ reason: 'Tenant signed lease at competing property — broker confirmed 2026-07-08' })
      }).then(r => r.json()).then(d => d.status);
    }, TOKEN);
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
    await wait(2000);

    // ── SHOT 10: Stats cards with Cancelled=1 ──
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(500);
    await shot(page, '10-stats-cancelled-count');

    // ── SHOT 11: Category cost breakdown report (no crash) ──
    await page.goto(BASE + '/reports/category-cost-breakdown', { waitUntil: 'networkidle0', timeout: 20000 });
    await wait(2500);
    await shot(page, '11-category-report-loaded');

    // Print API field check
    const fields = await page.evaluate(async (token) => {
      const r = await fetch('/api/rfp-requests/194', { headers: {'Authorization':'Bearer '+token} });
      const d = await r.json();
      return { status: d.status, cancellationReason: d.cancellationReason, cancelledAt: d.cancelledAt, priorWorkflowPhase: d.priorWorkflowPhase };
    }, TOKEN);
    console.log('API field check:', JSON.stringify(fields));

  } finally {
    await browser.close();
    console.log('ALL DONE');
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
