const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://localhost:5000';
const TOKEN = 'o7YKFVvEIjnDUJHhaN0Z_45QQFygA7Vm';
const OUT = '/tmp/rfp-screenshots';

async function shot(page, name) {
  const p = path.join(OUT, name + '.jpeg');
  await page.screenshot({ path: p, type: 'jpeg', quality: 90, fullPage: false });
  console.log('SAVED:', p);
  return p;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Inject token and load dashboard
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => localStorage.setItem('auth-token', t), TOKEN);
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForTimeout(1500);

  // ── SHOT 1: Dashboard with stats cards ──
  await shot(page, '01-dashboard-initial');
  console.log('Shot 1 done');

  // ── SHOT 2: Dashboard — click "Cancelled" filter pill to verify pill exists ──
  // First scroll to top
  await page.evaluate(() => window.scrollTo(0,0));
  await page.waitForTimeout(500);
  await shot(page, '02-dashboard-stats-cards');

  // ── SHOT 3: Click RFP-2026-018 row to open workflow panel ──
  // Find row with RFP-2026-018 and click it
  const clicked = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td, [role="cell"]'));
    const target = cells.find(c => c.textContent && c.textContent.includes('RFP-2026-018'));
    if (target) { target.closest('tr') ? target.closest('tr').click() : target.click(); return true; }
    // try text search on whole page
    const rows = Array.from(document.querySelectorAll('tr'));
    const row = rows.find(r => r.textContent && r.textContent.includes('RFP-2026-018'));
    if (row) { row.click(); return true; }
    return false;
  });
  console.log('Clicked RFP row:', clicked);
  await page.waitForTimeout(2000);
  await shot(page, '03-workflow-panel-opened');

  // ── SHOT 4: Scroll the right panel down to reveal Cancel button ──
  // Try to scroll the workflow panel
  await page.evaluate(() => {
    const panels = document.querySelectorAll('[class*="overflow"], [class*="scroll"]');
    panels.forEach(p => p.scrollTop += 600);
    window.scrollTo(0, 600);
  });
  await page.waitForTimeout(500);
  await shot(page, '04-workflow-panel-scrolled-cancel-btn');

  // ── SHOT 5: Click Cancel button ──
  const cancelBtn = await page.$('button[class*="rose"], button[class*="destructive"]') ||
    await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent && b.textContent.trim().toLowerCase().includes('cancel rfp'));
    });
  
  // Use evaluate to click
  const cancelClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent && b.textContent.trim().toLowerCase().includes('cancel rfp'));
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;
  });
  console.log('Cancel button clicked:', cancelClicked);
  await page.waitForTimeout(1200);
  await shot(page, '05-cancel-dialog-open');

  // ── SHOT 6: Fill reason + screenshot ──
  await page.evaluate(() => {
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach(ta => {
      if (!ta.value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(ta, 'Tenant signed lease at competing property — broker confirmed 2026-07-08');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
  await page.waitForTimeout(600);
  await shot(page, '06-cancel-dialog-with-reason');

  // ── SHOT 7: Submit the cancel dialog ──
  const submitClicked = await page.evaluate(() => {
    // Look for the confirm button in dialog - not the X close button
    const dialog = document.querySelector('[role="dialog"], [data-radix-dialog]') ||
      document.querySelector('.fixed.inset-0') ||
      document.body;
    const btns = Array.from(dialog.querySelectorAll('button'));
    // Find button that says "Cancel RFP" or "Confirm" but not close
    const btn = btns.find(b => {
      const t = b.textContent.trim().toLowerCase();
      return (t.includes('cancel rfp') || t === 'cancel' || t.includes('confirm')) && !b.querySelector('svg[class*="x"]');
    });
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;
  });
  console.log('Submit clicked:', submitClicked);
  await page.waitForTimeout(2500);
  await shot(page, '07-after-cancel-toast-and-badge');

  // ── SHOT 8: Click the cancelled RFP to see detail ──
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const row = rows.find(r => r.textContent && r.textContent.includes('RFP-2026-018'));
    if (row) row.click();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '08-cancelled-rfp-detail-reason-reinstate');

  // ── SHOT 9: Check stats cards ──
  // Navigate to dashboard fresh to see updated stats
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, '09-stats-cards-with-cancelled');

  // ── SHOT 10: Category-cost-breakdown report ──
  await page.goto(BASE + '/reports/category-cost-breakdown', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForTimeout(2000);
  await shot(page, '10-report-no-crash');

  await browser.close();
  console.log('ALL DONE');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
