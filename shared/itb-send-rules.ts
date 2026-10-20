/**
 * The rules for sending an invitation to bid: who it can go to, what it is
 * called, and what the covering note says.
 *
 * Separate from server/itb-send.ts, which imports the database and therefore
 * opens a connection the moment it loads. Pure logic kept behind that import
 * is logic that never gets tested — a lesson this codebase has already paid
 * for once, in server/budget-audit.ts.
 */

export type ItbRecipientType = 'contractor' | 'architect';

export interface ItbRecipient {
  contactId?: number | null;
  email: string;
  name?: string | null;
  company?: string | null;
  type?: ItbRecipientType;
}

/** The shape the client posts. Narrow on purpose. */
export interface SendItbRequest {
  recipients: ItbRecipient[];
  subject?: string;
  message?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

/**
 * Clean up what the client sent.
 *
 * Addresses are lower-cased and de-duplicated, because sending the same
 * contractor two copies of the same invitation looks careless and doubles
 * the chance of two different bids coming back.
 */
export function normalizeRecipients(input: unknown): {
  recipients: ItbRecipient[];
  rejected: { email: string; reason: string }[];
} {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const recipients: ItbRecipient[] = [];
  const rejected: { email: string; reason: string }[] = [];

  for (const raw of list) {
    const email = String((raw as any)?.email ?? '').trim().toLowerCase();
    if (!email) {
      rejected.push({ email: '', reason: 'No email address' });
      continue;
    }
    if (!isValidEmail(email)) {
      rejected.push({ email, reason: 'Not a valid email address' });
      continue;
    }
    if (seen.has(email)) continue; // a duplicate is not an error, just dropped
    seen.add(email);

    const type = (raw as any)?.type === 'architect' ? 'architect' : 'contractor';
    recipients.push({
      contactId: (raw as any)?.contactId ?? null,
      email,
      name: (raw as any)?.name ?? null,
      company: (raw as any)?.company ?? null,
      type,
    });
  }
  return { recipients, rejected };
}

/** The default covering note, when the sender hasn't written one. */
export function defaultSubject(rfp: any): string {
  return `Invitation to Bid — ${rfp?.projectName ?? 'Project'} (${rfp?.rfpNumber ?? ''})`.trim();
}

export function defaultMessage(rfp: any, itb: any, senderName: string): string {
  const due = itb?.bidSubmissionDeadline
    ? new Date(itb.bidSubmissionDeadline).toLocaleDateString('en-US',
        { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  return [
    `You are invited to bid on ${rfp?.projectName ?? 'this project'}.`,
    due ? `Proposals are due ${due}.` : null,
    'The invitation to bid is attached. Please reply to this email with your proposal or any questions.',
    senderName ? `\n${senderName}` : null,
  ].filter(Boolean).join('\n\n');
}

/** Plain text to simple HTML, so a typed note keeps its paragraphs. */
export function messageToHtml(message: string): string {
  const escape = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** A filename a contractor can file without renaming it. */
export function attachmentName(rfp: any, type: ItbRecipientType): string {
  const safe = String(rfp?.rfpNumber ?? 'RFP').replace(/[^A-Za-z0-9._-]/g, '-');
  const project = String(rfp?.projectName ?? '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40);
  const kind = type === 'architect' ? 'Architect' : 'Contractor';
  return [safe, project, `ITB-${kind}`].filter(Boolean).join('_') + '.pdf';
}
