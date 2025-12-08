import sgMail from '@sendgrid/mail';
import { storage } from './storage';
import { RfpRequest, Contact } from '@shared/schema';
import path from 'path';
import fs from 'fs';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

export async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
  };
}

export async function getOwnerContacts(): Promise<Contact[]> {
  return await storage.getContactsByType('owner');
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

function getPhaseDisplayName(phase: string): string {
  const phaseNames: Record<string, string> = {
    'rfp-entry': 'RFP Entry',
    'rfp-validation': 'Validation',
    'invitation-to-bid': 'Invitation to Bid',
    'bid-collection': 'Bid Collection',
    'evaluation': 'Evaluation',
    'publish': 'Published'
  };
  return phaseNames[phase] || phase;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    'received': '#3b82f6',
    'in-progress': '#f59e0b',
    'completed': '#10b981',
    'on-hold': '#6b7280',
    'archived': '#9ca3af'
  };
  return colors[status] || '#6b7280';
}

function getPhaseColor(phase: string): string {
  const colors: Record<string, string> = {
    'rfp-entry': '#3b82f6',
    'rfp-validation': '#8b5cf6',
    'invitation-to-bid': '#f59e0b',
    'bid-collection': '#ef4444',
    'evaluation': '#06b6d4',
    'publish': '#10b981'
  };
  return colors[phase] || '#6b7280';
}

export function generateStatusReportHtml(rfps: RfpRequest[]): string {
  const incompleteRfps = rfps.filter(rfp => rfp.workflowPhase !== 'publish');
  
  const byPhase = incompleteRfps.reduce((acc, rfp) => {
    const phase = rfp.workflowPhase;
    if (!acc[phase]) acc[phase] = [];
    acc[phase].push(rfp);
    return acc;
  }, {} as Record<string, RfpRequest[]>);

  const phaseOrder = ['rfp-entry', 'rfp-validation', 'invitation-to-bid', 'bid-collection', 'evaluation'];
  
  let phaseSections = '';
  for (const phase of phaseOrder) {
    const phaseRfps = byPhase[phase] || [];
    if (phaseRfps.length === 0) continue;
    
    const phaseColor = getPhaseColor(phase);
    phaseSections += `
      <div style="margin-bottom: 24px;">
        <h3 style="color: ${phaseColor}; margin-bottom: 12px; font-size: 16px; border-bottom: 2px solid ${phaseColor}; padding-bottom: 8px;">
          ${getPhaseDisplayName(phase)} (${phaseRfps.length})
        </h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background-color: #f9fafb;">
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb;">RFP #</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb;">Project</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb;">Tenant</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb;">Property</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb;">Due Date</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${phaseRfps.map(rfp => `
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; font-weight: 600;">${rfp.rfpNumber}</td>
                <td style="padding: 10px;">${rfp.projectName}</td>
                <td style="padding: 10px;">${rfp.tenantName}</td>
                <td style="padding: 10px;">${rfp.property}</td>
                <td style="padding: 10px;">${formatDate(rfp.internalDueDate)}</td>
                <td style="padding: 10px;">
                  <span style="background-color: ${getStatusColor(rfp.status)}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    ${rfp.status.toUpperCase()}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const today = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa; margin: 0; padding: 20px;">
      <div style="max-width: 800px; margin: 0 auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">RFP Status Report</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">${today}</p>
        </div>
        
        <div style="padding: 24px;">
          <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin-bottom: 24px; border-radius: 0 4px 4px 0;">
            <h2 style="margin: 0 0 8px 0; color: #92400e; font-size: 16px;">Summary</h2>
            <p style="margin: 0; color: #78350f;">
              <strong>${incompleteRfps.length}</strong> active RFP${incompleteRfps.length !== 1 ? 's' : ''} currently in progress
            </p>
          </div>
          
          ${phaseSections || '<p style="color: #6b7280; text-align: center; padding: 40px;">All RFPs are complete! 🎉</p>'}
        </div>
        
        <div style="background-color: #f9fafb; padding: 16px 24px; border-radius: 0 0 8px 8px; text-align: center; color: #6b7280; font-size: 12px;">
          <p style="margin: 0;">This is an automated report from the RFP Tracker System</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function generateWorkflowCompletionHtml(
  rfp: RfpRequest, 
  completionType: 'rfp-entry' | 'publish'
): string {
  const isNewProject = completionType === 'rfp-entry';
  const title = isNewProject ? 'New RFP Initiated' : 'Project Published';
  const headerColor = isNewProject ? '#3b82f6' : '#10b981';
  const icon = isNewProject ? '📋' : '✅';
  
  const today = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="background: ${headerColor}; color: white; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 8px;">${icon}</div>
          <h1 style="margin: 0; font-size: 24px;">${title}</h1>
        </div>
        
        <div style="padding: 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 140px;">RFP Number</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${rfp.rfpNumber}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Project Name</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${rfp.projectName}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Tenant</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">${rfp.tenantName}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Property</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">${rfp.property}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Internal Due Date</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">${formatDate(rfp.internalDueDate)}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Sent By</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">${rfp.sentBy}</td>
            </tr>
            ${rfp.estimatedValue ? `
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Estimated Value</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">${rfp.estimatedValue}</td>
            </tr>
            ` : ''}
            ${completionType === 'publish' && rfp.publishedDate ? `
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Published Date</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">${formatDate(rfp.publishedDate)}</td>
            </tr>
            ` : ''}
          </table>
          
          ${rfp.notes ? `
          <div style="margin-top: 20px; padding: 16px; background-color: #f9fafb; border-radius: 4px;">
            <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #374151;">Notes</h3>
            <p style="margin: 0; color: #6b7280; font-size: 14px;">${rfp.notes}</p>
          </div>
          ` : ''}
        </div>
        
        <div style="background-color: #f9fafb; padding: 16px 24px; border-radius: 0 0 8px 8px; text-align: center; color: #6b7280; font-size: 12px;">
          <p style="margin: 0;">${today}</p>
          <p style="margin: 4px 0 0 0;">RFP Tracker System</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function getAttachmentsForRfp(rfp: RfpRequest, completionType: 'rfp-entry' | 'publish'): Promise<any[]> {
  const attachments: any[] = [];
  
  try {
    const rfpFiles = rfp.files || [];
    
    for (const file of rfpFiles) {
      try {
        const filePath = file.path || path.join('uploads', file.id);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          attachments.push({
            content: content.toString('base64'),
            filename: file.name,
            type: file.type || 'application/octet-stream',
            disposition: 'attachment'
          });
        }
      } catch (err) {
        console.error(`Failed to attach file ${file.name}:`, err);
      }
    }

    if (completionType === 'publish') {
      const budgetAttachments = await storage.getEvaluationBudgetAttachments(rfp.id);
      for (const attachment of budgetAttachments) {
        try {
          const filePath = path.join('uploads', attachment.filename);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath);
            attachments.push({
              content: content.toString('base64'),
              filename: attachment.originalName || attachment.filename,
              type: attachment.mimeType || 'application/octet-stream',
              disposition: 'attachment'
            });
          }
        } catch (err) {
          console.error(`Failed to attach budget file ${attachment.filename}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Error gathering attachments:', err);
  }
  
  return attachments;
}

export async function sendStatusReportEmail(): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    const owners = await getOwnerContacts();
    
    if (owners.length === 0) {
      console.log('No owner contacts found to send status report');
      return { success: true };
    }

    const rfps = await storage.getAllRfpRequests();
    const html = generateStatusReportHtml(rfps);
    
    const recipientEmails = owners
      .filter(owner => owner.email)
      .map(owner => owner.email);
    
    if (recipientEmails.length === 0) {
      console.log('No valid email addresses found for owners');
      return { success: true };
    }

    const today = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'short', 
      day: 'numeric' 
    });

    const msg = {
      to: recipientEmails,
      from: fromEmail,
      subject: `RFP Status Report - ${today}`,
      html: html
    };

    await client.send(msg);
    console.log(`Status report sent to ${recipientEmails.length} owner(s)`);
    return { success: true };
  } catch (error: any) {
    console.error('Failed to send status report email:', error);
    return { success: false, error: error.message };
  }
}

export async function sendTestStatusReportEmail(testEmail: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    const rfps = await storage.getAllRfpRequests();
    const html = generateStatusReportHtml(rfps);
    
    const msg = {
      to: testEmail,
      from: fromEmail,
      subject: `[TEST] RFP Status Report - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
      html: html
    };

    await client.send(msg);
    console.log(`Test status report sent to ${testEmail}`);
    return { success: true };
  } catch (error: any) {
    console.error('Failed to send test status report email:', error);
    return { success: false, error: error.message };
  }
}

export async function sendWorkflowCompletionEmail(
  rfp: RfpRequest, 
  completionType: 'rfp-entry' | 'publish'
): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    const owners = await getOwnerContacts();
    
    if (owners.length === 0) {
      console.log('No owner contacts found to send workflow completion email');
      return { success: true };
    }

    const html = generateWorkflowCompletionHtml(rfp, completionType);
    const attachments = await getAttachmentsForRfp(rfp, completionType);
    
    const recipientEmails = owners
      .filter(owner => owner.email)
      .map(owner => owner.email);
    
    if (recipientEmails.length === 0) {
      console.log('No valid email addresses found for owners');
      return { success: true };
    }

    const subjectPrefix = completionType === 'rfp-entry' ? '📋 New RFP' : '✅ Project Published';
    const msg: any = {
      to: recipientEmails,
      from: fromEmail,
      subject: `${subjectPrefix}: ${rfp.projectName} (${rfp.rfpNumber})`,
      html: html
    };

    if (attachments.length > 0) {
      msg.attachments = attachments;
    }

    await client.send(msg);
    console.log(`Workflow completion email (${completionType}) sent for RFP ${rfp.rfpNumber}`);
    return { success: true };
  } catch (error: any) {
    console.error('Failed to send workflow completion email:', error);
    return { success: false, error: error.message };
  }
}
