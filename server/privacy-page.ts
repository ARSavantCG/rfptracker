import type { Express } from 'express';

/**
 * Public privacy policy (no sign-in). Google requires one before an OAuth app that
 * uses Google Drive can be published; it also says plainly what the app does with Drive.
 */
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RFPTracker Privacy Policy</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#111827;line-height:1.55}
h1{font-size:26px;margin-bottom:4px}h2{font-size:17px;margin-top:28px}p,li{font-size:15px}.muted{color:#6b7280;font-size:13px}</style></head><body>
<h1>RFPTracker Privacy Policy</h1>
<p class="muted">Effective October 22, 2026 · rfptracker.app</p>
<p>RFPTracker is a private project and cost management application operated by Savant Consulting Group LLC for its own team and invited users. It is not offered to the public.</p>
<h2>Information we keep</h2>
<p>Account details for invited users (name, email, role), and the project information users enter or upload: requests for proposal, bids, budgets, contracts, pay applications, lien waivers, change orders, invoices and related files.</p>
<h2>How it is used</h2>
<p>Only to run the application for its users. We do not sell information, use it for advertising, or share it with third parties, except service providers that host the application and its data (hosting, database and file storage) and as required by law.</p>
<h2>Google user data</h2>
<p>An administrator can connect a Google account so the application can back itself up to Google Drive. The application requests only the <strong>drive.file</strong> permission, which lets it create and manage the files and folders it makes itself (a folder named "RFPTracker Backups"). It cannot see, read or change any other file in that Google Drive. It also reads the connected account's email address to show which account backups go to.</p>
<p>Google user data is used only to store and manage these backups. It is not shared, sold, used for advertising, or used to train artificial intelligence models. RFPTracker's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
<p>An administrator can disconnect Google Drive at any time from the application's Admin Panel, which deletes the stored connection. Access can also be removed at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. Backups already in the Drive remain the account owner's to keep or delete.</p>
<h2>Security and retention</h2>
<p>Data is sent over encrypted connections and access requires sign-in. Information is kept while it is needed for the projects it belongs to, or until an administrator deletes it.</p>
<h2>Contact</h2>
<p>Questions about this policy: contact the RFPTracker administrator who invited you, or the support email shown on the Google sign-in screen.</p>
</body></html>`;

export function registerPrivacyPage(app: Express) {
  app.get(['/privacy', '/privacy-policy'], (_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(HTML); });
}
