import puppeteer from "puppeteer";
import type { RfpRequest, InvitationToBid } from "@shared/schema";

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export interface PdfGenerationOptions {
  rfp: RfpRequest;
  invitationToBid?: InvitationToBid;
  recipientType: "architect" | "contractor";
  recipientName?: string;
  recipientCompany?: string;
}

export async function generateRfpPdf(options: PdfGenerationOptions): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    const html = generateRfpHtml(options);
    
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '1in',
        right: '1in',
        bottom: '1in',
        left: '1in'
      }
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function generateRfpHtml(options: PdfGenerationOptions): string {
  const { rfp, invitationToBid, recipientType, recipientName, recipientCompany } = options;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>RFP Communication - ${rfp.rfpNumber}</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        
        .header {
          border-bottom: 3px solid rgb(0,50,130);
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        
        .company-logo {
          font-size: 24px;
          font-weight: bold;
          color: rgb(0,50,130);
          margin-bottom: 10px;
        }
        
        .document-title {
          font-size: 20px;
          font-weight: 600;
          margin: 20px 0 10px 0;
        }
        
        .rfp-number {
          font-size: 16px;
          color: #6b7280;
          margin-bottom: 5px;
        }
        
        .date {
          font-size: 14px;
          color: #6b7280;
        }
        
        .recipient-info {
          background: #f8fafc;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        
        .section {
          margin: 25px 0;
        }
        
        .section h3 {
          font-size: 16px;
          font-weight: 600;
          color: #1f2937;
          border-bottom: 1px solid #e5e7eb;
          padding-bottom: 5px;
          margin-bottom: 15px;
        }
        
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin: 20px 0;
        }
        
        .info-item {
          margin-bottom: 10px;
        }
        
        .info-label {
          font-weight: 600;
          color: #374151;
        }
        
        .info-value {
          color: #6b7280;
          margin-top: 2px;
        }
        
        .request-types {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        
        .request-type {
          background: #dbeafe;
          color: #1e40af;
          padding: 4px 12px;
          border-radius: 16px;
          font-size: 12px;
          font-weight: 500;
        }
        
        .files-list {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 15px;
          margin-top: 10px;
        }
        
        .file-item {
          display: flex;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .file-item:last-child {
          border-bottom: none;
        }
        
        .file-icon {
          width: 16px;
          height: 16px;
          margin-right: 10px;
          background: #3b82f6;
          border-radius: 2px;
        }
        
        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          font-size: 12px;
          color: #6b7280;
          text-align: center;
        }
        
        .invitation-details {
          background: #fef3c7;
          border: 1px solid #f59e0b;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
        }
        
        .invitation-title {
          color: #92400e;
          font-weight: 600;
          margin-bottom: 15px;
        }
        
        .requirements-list {
          list-style: none;
          padding: 0;
        }
        
        .requirements-list li {
          padding: 5px 0;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .requirements-list li:last-child {
          border-bottom: none;
        }
        
        @media print {
          body {
            padding: 0;
          }
          
          .info-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-logo">Leasing Management</div>
        <div class="document-title">Request for Proposal Communication</div>
        <div class="rfp-number">RFP Number: ${rfp.rfpNumber}</div>
        <div class="date">Generated: ${new Date().toLocaleDateString()}</div>
      </div>

      ${recipientName || recipientCompany ? `
      <div class="recipient-info">
        <h3>Recipient Information</h3>
        ${recipientName ? `<div><strong>Contact:</strong> ${recipientName}</div>` : ''}
        ${recipientCompany ? `<div><strong>Company:</strong> ${recipientCompany}</div>` : ''}
        <div><strong>Type:</strong> ${recipientType.charAt(0).toUpperCase() + recipientType.slice(1)}</div>
      </div>
      ` : ''}

      <div class="section">
        <h3>Project Overview</h3>
        <div class="info-grid">
          <div>
            <div class="info-item">
              <div class="info-label">Property</div>
              <div class="info-value">${rfp.property}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Tenant Name</div>
              <div class="info-value">${rfp.tenantName}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Project Name</div>
              <div class="info-value">${rfp.projectName}</div>
            </div>
            ${rfp.projectAddress ? `
            <div class="info-item">
              <div class="info-label">Project Address</div>
              <div class="info-value">${rfp.projectAddress}</div>
            </div>
            ` : ''}
          </div>
          <div>
            <div class="info-item">
              <div class="info-label">Sent On</div>
              <div class="info-value">${formatDate(rfp.sentOn)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Sent By</div>
              <div class="info-value">${rfp.sentBy}</div>
            </div>
            ${rfp.dueDate ? `
            <div class="info-item">
              <div class="info-label">Due Date</div>
              <div class="info-value">${formatDate(rfp.dueDate)}</div>
            </div>
            ` : ''}
            ${rfp.projectSize ? `
            <div class="info-item">
              <div class="info-label">Project Size</div>
              <div class="info-value">${rfp.projectSize}</div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>

      <div class="section">
        <h3>Request Details</h3>
        <div class="info-item">
          <div class="info-label">Requested Services</div>
          <div class="request-types">
            ${rfp.requestTypes.map(type => `
              <span class="request-type">${type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
            `).join('')}
          </div>
        </div>
        
        ${rfp.estimatedValue ? `
        <div class="info-item">
          <div class="info-label">Estimated Project Value</div>
          <div class="info-value">${rfp.estimatedValue}</div>
        </div>
        ` : ''}
        
        ${rfp.timelineRequirements ? `
        <div class="info-item">
          <div class="info-label">Timeline Requirements</div>
          <div class="info-value">${rfp.timelineRequirements}</div>
        </div>
        ` : ''}
        
        ${rfp.specialRequirements ? `
        <div class="info-item">
          <div class="info-label">Special Requirements</div>
          <div class="info-value">${rfp.specialRequirements}</div>
        </div>
        ` : ''}
      </div>

      ${invitationToBid ? `
      <div class="invitation-details">
        <div class="invitation-title">Invitation to Bid Details</div>
        
        ${invitationToBid.projectScope ? `
        <div class="info-item">
          <div class="info-label">Project Scope</div>
          <div class="info-value">${invitationToBid.projectScope}</div>
        </div>
        ` : ''}
        
        ${invitationToBid.bidSubmissionDeadline ? `
        <div class="info-item">
          <div class="info-label">Bid Submission Deadline</div>
          <div class="info-value">${new Date(invitationToBid.bidSubmissionDeadline).toLocaleDateString()}</div>
        </div>
        ` : ''}
        
        ${invitationToBid.prequalificationCriteria && invitationToBid.prequalificationCriteria.length > 0 ? `
        <div class="info-item">
          <div class="info-label">Prequalification Requirements</div>
          <ul class="requirements-list">
            ${invitationToBid.prequalificationCriteria.map(criteria => `<li>• ${criteria}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
        
        ${invitationToBid.evaluationCriteria && invitationToBid.evaluationCriteria.length > 0 ? `
        <div class="info-item">
          <div class="info-label">Evaluation Criteria</div>
          <ul class="requirements-list">
            ${invitationToBid.evaluationCriteria.map(criteria => `<li>• ${criteria}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>
      ` : ''}

      <div class="section">
        <h3>Contact Information</h3>
        <div class="info-grid">
          <div>
            ${rfp.contactPerson ? `
            <div class="info-item">
              <div class="info-label">Contact Person</div>
              <div class="info-value">${rfp.contactPerson}</div>
            </div>
            ` : ''}
            ${rfp.contactEmail ? `
            <div class="info-item">
              <div class="info-label">Email</div>
              <div class="info-value">${rfp.contactEmail}</div>
            </div>
            ` : ''}
          </div>
          <div>
            <div class="info-item">
              <div class="info-label">RFP Status</div>
              <div class="info-value">${rfp.status.charAt(0).toUpperCase() + rfp.status.slice(1).replace('-', ' ')}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Workflow Phase</div>
              <div class="info-value">${rfp.workflowPhase.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
            </div>
          </div>
        </div>
      </div>

      ${rfp.files && rfp.files.length > 0 ? `
      <div class="section">
        <h3>Attached Files</h3>
        <div class="files-list">
          ${rfp.files.map(file => `
            <div class="file-item">
              <div class="file-icon"></div>
              <div>
                <div style="font-weight: 500;">${file.name}</div>
                <div style="font-size: 12px; color: #6b7280;">
                  ${Math.round(file.size / 1024)} KB • ${file.type}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${rfp.notes ? `
      <div class="section">
        <h3>Additional Notes</h3>
        <div style="background: #f9fafb; padding: 15px; border-radius: 6px; white-space: pre-wrap;">${rfp.notes}</div>
      </div>
      ` : ''}

      <div class="footer">
        <p>This document was generated automatically from the RFP Management System</p>
        <p>Generated on ${new Date().toLocaleString()} for ${recipientType} communication</p>
      </div>
    </body>
    </html>
  `;
}

export function generatePdfFilename(rfp: RfpRequest, recipientType: string): string {
  const date = new Date().toISOString().split('T')[0];
  const projectName = rfp.projectName || `RFP-${rfp.rfpNumber}`;
  const sanitizedProject = projectName
    .replace(/[@]/g, '_at_')
    .replace(/[^\w\s\-\.]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${sanitizedProject}_${recipientType}_${date}.pdf`;
}