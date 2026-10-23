/**
 * Table headers are centered over their column app-wide (index.css). For a
 * money column that only works when the column is as narrow as its amounts:
 * a wide column leaves right-aligned numbers far from a centered header.
 * So every number column — most body cells right-aligned — is shrunk to fit
 * its widest amount (or its header), and the spare width goes to the text
 * columns. Tables with a fixed layout, or headers with their own width, are
 * left alone; a table can opt out with data-no-fit.
 */
const right = (el: Element) => { const a = getComputedStyle(el).textAlign; return a === 'right' || a === 'end'; };

function fit(table: HTMLTableElement) {
  if (table.dataset.noFit != null || getComputedStyle(table).tableLayout === 'fixed') return;
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  const body = Array.from(table.tBodies).flatMap((b) => Array.from(b.rows)).filter((r) => head && r.cells.length === head.cells.length).slice(0, 25);
  if (!head || !body.length) return;
  Array.from(head.cells).forEach((th, i) => {
    if (th.colSpan > 1 || /\bw-\[|\bw-\d|\bmin-w-/.test(th.className) || (th.style.width && th.dataset.fit !== '1')) return;
    const cells = body.map((r) => r.cells[i]).filter((c) => c && c.textContent && c.textContent.trim());
    if (!cells.length) return;
    const isNumber = cells.filter(right).length / cells.length >= 0.6;
    if (isNumber && th.dataset.fit !== '1') {
      th.style.width = '1%'; th.style.whiteSpace = 'nowrap'; th.dataset.fit = '1';
      cells.forEach((c) => { (c as HTMLElement).style.whiteSpace = 'nowrap'; });
    } else if (!isNumber && th.dataset.fit === '1') {
      th.style.width = ''; th.style.whiteSpace = ''; delete th.dataset.fit;
    }
  });
}

export function startTableFit() {
  let t: number | undefined;
  const run = () => { t = undefined; document.querySelectorAll('table').forEach((x) => fit(x as HTMLTableElement)); };
  const schedule = () => { if (t === undefined) t = window.setTimeout(run, 150); };
  new MutationObserver((muts) => {
    // Only when rows or tables come and go — not on every keystroke inside an input.
    if (muts.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && ((n as Element).matches('table,tr,tbody') || (n as Element).querySelector?.('table,tr'))))) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  schedule();
}
