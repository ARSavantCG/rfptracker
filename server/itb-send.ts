/**
 * Send the invitation to bid to contractors and architects.
 *
 * Until now step 3 produced the invitation and then stopped. Getting it to a
 * contractor meant generating the document, downloading it, opening a mail
 * client, finding the addresses, attaching it and writing the covering note —
 * every time, for every bidder, with nothing in the app afterwards to say who
 * had actually been invited.
 *
 * What this does NOT do, deliberately: contractors reply to the sender's own
 * inbox. There is no bidder login, no upload link, no external access of any
 * kind. The one thing it records is the sending.
 *
 * Two rules worth stating because they are easy to get wrong:
 *
 *   - Every recipient gets THEIR OWN document. The generator addresses the
 *     invitation to a named company, and the contractor and architect
 *     packages are different documents. One blast with one attachment would
 *     send the wrong package to half the list.
 *
 *   - A failed send is recorded, with its error. A bounce that leaves no
 *     trace is worse than no send at all: the bid never arrives, nobody
 *     knows why, and the due date passes.
 */
import type { Express } from 'express';
import puppeteer from 'puppeteer';
import { db } from './db';
import { itbSends, contacts } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import { requireAuth } from './middleware';
import { requireRfpOwnership } from './ownership';
import { storage } from './storage';
import { generateRfpPdf } from './pdf-generator';
import { getUncachableSendGridClient, getAlwaysCopyAddress, areNotificationsMuted } from './email-service';
import {
  type ItbRecipientType, type ItbRecipient, type SendItbRequest,
  isValidEmail, normalizeRecipients, defaultSubject, defaultMessage,
  messageToHtml, attachmentName,
} from '@shared/itb-send-rules';

// Re-exported so the route module stays the one import for server callers.
export type { ItbRecipientType, ItbRecipient, SendItbRequest };
export { isValidEmail, normalizeRecipients, defaultSubject, defaultMessage, messageToHtml, attachmentName };

/**
 * The invitation as a real PDF.
 *
 * generateRfpPdf returns HTML despite the name — the app has always relied on
 * the browser to print it. An HTML file attached to an email is not something
 * a contractor can forward to an estimator, so it is rendered here, the same
 * way the status-report email already does it.
 */
export async function renderItbPdf(options: {
  rfp: any; invitationToBid: any; recipientType: ItbRecipientType;
  recipientName?: string | null; recipientCompany?: string | null; userEmail?: string;
}): Promise<Buffer> {
  const htmlBuffer = await generateRfpPdf({
    rfp: options.rfp,
    invitationToBid: options.invitationToBid,
    recipientType: options.recipientType,
    recipientName: options.recipientName || undefined,
    recipientCompany: options.recipientCompany || undefined,
    userEmail: options.userEmail,
  } as any);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlBuffer.toString('utf8'), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export function registerItbSendRoutes(app: Express): void {
  /** Who has been invited, most recent first. */
  app.get('/api/rfp-requests/:id/invitation-to-bid/sends',
    requireAuth, requireRfpOwnership('id'), async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });
        const rows = await db.select().from(itbSends)
          .where(eq(itbSends.rfpId, id))
          .orderBy(desc(itbSends.sentAt));
        res.json({ sends: rows });
      } catch (error) {
        res.status(500).json({
          message: error instanceof Error ? error.message : 'Failed to load the send history',
        });
      }
    });

  /** Who should be offered — the directory, filtered to people who build things. */
  app.get('/api/rfp-requests/:id/invitation-to-bid/candidates',
    requireAuth, requireRfpOwnership('id'), async (req, res) => {
      try {
        const all = await db.select().from(contacts);
        const offered = all
          .filter((c) => c.isActive !== false)
          .filter((c) => ['contractor', 'architect'].includes(String(c.type ?? '').toLowerCase()))
          .filter((c) => isValidEmail(c.email))
          .map((c) => ({
            contactId: c.id, name: c.name, email: c.email, company: c.company,
            type: String(c.type).toLowerCase() as ItbRecipientType,
          }));
        res.json({ candidates: offered });
      } catch (error) {
        res.status(500).json({
          message: error instanceof Error ? error.message : 'Failed to load contacts',
        });
      }
    });

  app.post('/api/rfp-requests/:id/invitation-to-bid/send',
    requireAuth, requireRfpOwnership('id'), async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });

        const rfp = await storage.getRfpRequest(id);
        if (!rfp) return res.status(404).json({ message: 'RFP request not found' });

        const itb = await storage.getInvitationToBid(id);
        if (!itb) {
          return res.status(400).json({
            message: 'Fill in the invitation to bid before sending it.',
          });
        }

        const { recipients, rejected } = normalizeRecipients((req.body as SendItbRequest)?.recipients);
        if (recipients.length === 0) {
          return res.status(400).json({
            message: rejected.length
              ? `No valid recipients. ${rejected.map((r) => `${r.email || '(blank)'}: ${r.reason}`).join('; ')}`
              : 'Choose at least one contractor or architect.',
          });
        }

        // Muting exists so test RFPs don't spam the team. Sending an
        // invitation is a deliberate act, so say plainly that it was stopped
        // rather than reporting a success that never left the building.
        if (await areNotificationsMuted()) {
          return res.status(409).json({
            message: 'Email notifications are muted, so nothing was sent. Unmute them in Admin and send again.',
          });
        }

        const user = (req as any).user;
        const senderEmail: string = user?.email || user?.username || '';
        const senderName: string = user?.name || user?.fullName || '';

        let client: any, fromEmail: string;
        try {
          ({ client, fromEmail } = await getUncachableSendGridClient());
        } catch (e) {
          return res.status(503).json({
            message: e instanceof Error ? e.message : 'Email is not configured, so nothing was sent.',
          });
        }

        // rfp.property holds the property ID as TEXT; getProperty takes a
        // number. A non-numeric value here is a legacy row that stored the
        // name, and the address simply falls back to it.
        const propertyId = parseInt(String(rfp.property ?? ''), 10);
        const property = Number.isFinite(propertyId)
          ? await storage.getProperty(propertyId).catch(() => undefined)
          : undefined;
        const rfpWithAddress = {
          ...rfp,
          propertyAddress: property
            ? `${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}`
            : rfp.property,
        };

        const subject = String((req.body as SendItbRequest)?.subject || '').trim()
          || defaultSubject(rfp);
        const message = String((req.body as SendItbRequest)?.message || '').trim()
          || defaultMessage(rfp, itb, senderName);
        const html = messageToHtml(message);
        const alwaysCopy = await getAlwaysCopyAddress();

        const results: { email: string; status: 'sent' | 'failed'; error?: string }[] = [];

        for (const r of recipients) {
          const type: ItbRecipientType = r.type === 'architect' ? 'architect' : 'contractor';
          let status: 'sent' | 'failed' = 'sent';
          let error: string | null = null;

          try {
            const pdf = await renderItbPdf({
              rfp: rfpWithAddress,
              invitationToBid: itb,
              recipientType: type,
              recipientName: r.name,
              recipientCompany: r.company,
              userEmail: senderEmail,
            });

            await client.send({
              to: r.email,
              from: fromEmail,
              // The whole point of this send: the reply lands with the person
              // who sent it, not in a no-reply mailbox nobody reads.
              ...(senderEmail ? { replyTo: senderEmail } : {}),
              ...(alwaysCopy && alwaysCopy !== r.email ? { bcc: alwaysCopy } : {}),
              subject,
              html,
              text: message,
              attachments: [{
                content: pdf.toString('base64'),
                filename: attachmentName(rfp, type),
                type: 'application/pdf',
                disposition: 'attachment',
              }],
            });
          } catch (e) {
            status = 'failed';
            error = e instanceof Error ? e.message : String(e);
            console.error(`[itb-send] ${rfp.rfpNumber} → ${r.email} failed:`, error);
          }

          // Recorded either way, before moving on, so a crash halfway through
          // a list still leaves a truthful account of what went out.
          try {
            await db.insert(itbSends).values({
              rfpId: id,
              contactId: r.contactId ?? null,
              recipientEmail: r.email,
              recipientName: r.name ?? null,
              recipientCompany: r.company ?? null,
              recipientType: type,
              subject,
              status,
              error,
              sentBy: senderEmail || null,
            } as any);
          } catch (logError) {
            console.error('[itb-send] could not record the send:', logError);
          }

          results.push({ email: r.email, status, ...(error ? { error } : {}) });
        }

        const sent = results.filter((r) => r.status === 'sent').length;
        const failed = results.length - sent;
        res.json({
          sent,
          failed,
          results,
          rejected,
          // Stated rather than left for the client to phrase, so the count on
          // screen always matches what actually happened.
          message: failed === 0
            ? `Invitation sent to ${sent} ${sent === 1 ? 'recipient' : 'recipients'}.`
            : `${sent} sent, ${failed} failed. The failures are listed with their reasons.`,
        });
      } catch (error) {
        console.error('[itb-send] unexpected failure:', error);
        res.status(500).json({
          message: error instanceof Error ? error.message : 'Failed to send the invitation',
        });
      }
    });
}
