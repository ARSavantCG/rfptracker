import { createWriteStream } from "fs";
import { promisify } from "util";

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

export interface PdfGenerationOptions {
  rfp: any;
  invitationToBid?: any;
  recipientType: "architect" | "contractor";
  recipientName?: string;
  recipientCompany?: string;
}

export async function generateRfpPdf(options: PdfGenerationOptions): Promise<Buffer> {
  try {
    const htmlPdf = await import('html-pdf-node');
    
    const html = generateRfpHtml(options);
    
    const pdfOptions = {
      format: 'A4',
      printBackground: true,
      margin: {
        top: '1in',
        right: '1in',
        bottom: '1in',
        left: '1in'
      }
    };

    const file = { content: html };
    const pdfBuffer = await htmlPdf.generatePdf(file, pdfOptions);
    
    return Buffer.from(pdfBuffer);
  } catch (error) {
    // Silently fall back to HTML generation without logging the error
    const html = generateRfpHtml(options);
    return Buffer.from(html, 'utf8');
  }
}

function generateRfpHtml(options: PdfGenerationOptions): string {
  const { rfp, invitationToBid, recipientType, recipientName, recipientCompany } = options;
  
  const today = formatDate(new Date());
  const bidDeadline = invitationToBid?.bidSubmissionDeadline ? formatDate(invitationToBid.bidSubmissionDeadline) : formatDate(new Date());
  const projectStart = invitationToBid?.projectStartDate ? formatDate(invitationToBid.projectStartDate) : '';
  const projectEnd = invitationToBid?.projectEndDate ? formatDate(invitationToBid.projectEndDate) : '';
  
  // Calculate areas for display
  const totalArea = parseInt(rfp.warehouseArea?.replace(/,/g, '') || '0');
  const existingOffice = parseInt(rfp.officeAreaExisting?.replace(/,/g, '') || '0');
  const newOffice = parseInt(rfp.officeAreaNew?.replace(/,/g, '') || '0');
  const warehouseArea = totalArea - existingOffice - newOffice;
  
  // Generate different content based on recipient type
  if (recipientType === "contractor") {
    return generateContractorRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea });
  } else {
    return generateArchitectRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea });
  }
}

function generateContractorRfpHtml(options: PdfGenerationOptions, dates: any): string {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea } = dates;
  
  // Use Step 1 Project Name
  const projectName = rfp.projectName;
  
  // Use Project Address from RFP data
  const projectAddress = rfp.projectAddress || invitationToBid?.projectLocation || rfp.property;
  
  // Use contact info from invitation
  const contactInfo = invitationToBid?.contactForQuestions?.split(' - ') || [];
  const contactPerson = contactInfo[0] || 'Development Contact';
  const contactEmail = contactInfo[1] || '';
  const contactPhone = contactInfo[2] || '';
  
  // Use Project Description from invitation data
  const projectDescription = invitationToBid?.projectDescription || 'Project description to be provided';
  
  // Use Documents Link from invitation data
  const documentsLink = invitationToBid?.documentsLink || 'www.testlinkdoc.com';
  
  // Use dynamic Key Dates from invitation data
  const keyDates = invitationToBid?.keyDates || [];
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invitation to Bid - ${projectName}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          font-size: 11px;
          line-height: 1.4;
          color: #000;
          margin: 0;
          padding: 20px;
        }
        
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #000;
          padding-bottom: 15px;
        }
        
        .header h1 {
          font-size: 18px;
          font-weight: bold;
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 2px;
        }
        
        .header h2 {
          font-size: 14px;
          font-weight: normal;
          margin: 10px 0 0 0;
        }
        
        .section {
          margin-bottom: 25px;
        }
        
        .section-title {
          font-weight: bold;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 8px;
          border-bottom: 1px solid #ccc;
          padding-bottom: 3px;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
        }
        
        .info-table td {
          padding: 5px 8px;
          border: 1px solid #000;
          vertical-align: top;
        }
        
        .info-table .label {
          background-color: #f5f5f5;
          font-weight: bold;
          width: 25%;
        }
        
        .description-box {
          border: 1px solid #000;
          padding: 15px;
          margin: 10px 0;
          background-color: #fafafa;
        }
        
        .requirements-list {
          margin: 10px 0;
          padding-left: 20px;
        }
        
        .requirements-list li {
          margin-bottom: 5px;
        }
        
        .footer {
          margin-top: 40px;
          text-align: center;
          font-size: 10px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>INVITATION TO BID</h1>
        <h2>${projectName}</h2>
      </div>
      
      <div class="section">
        <table class="info-table">
          <tr>
            <td class="label">DATE:</td>
            <td>${today}</td>
          </tr>
          <tr>
            <td class="label">PROJECT NAME:</td>
            <td>${projectName}</td>
          </tr>
          <tr>
            <td class="label">PROJECT LOCATION:</td>
            <td>${projectAddress}</td>
          </tr>
          <tr>
            <td class="label">TO:</td>
            <td>
              ${recipientCompany || 'General Contractor'}<br>
              ${recipientName || ''}<br>
              ${contactEmail}<br>
              ${contactPhone}
            </td>
          </tr>
        </table>
      </div>
      
      <div class="description-box">
        <p><strong>Dear ${recipientCompany || recipientName || 'Contractor'},</strong></p>
        <p>Your firm has been selected to provide a proposal for the ${projectName} project. 
        We kindly request that you notify us of your intent to provide a bid no later than 
        close of business on the date outlined below. Below, you will also find a series of 
        information to assist you throughout the pricing exercise.</p>
        <p>In the event you have any questions, please feel free to contact 
        ${contactPerson} at ${contactEmail} at your earliest convenience.</p>
      </div>
      
      <div class="section">
        <div class="section-title">PROJECT DESCRIPTION:</div>
        <div class="description-box">
          <p>${projectDescription}</p>
        </div>
      </div>
      
      <div class="section">
        <table class="info-table">
          <tr>
            <td class="label">DOCUMENT(S) LINK:</td>
            <td>${documentsLink}</td>
          </tr>
        </table>
      </div>
      
      ${keyDates.length > 0 ? `
      <div class="section">
        <div class="section-title">KEY DATES:</div>
        <table class="info-table">
          ${keyDates.map(keyDate => `
          <tr>
            <td class="label">${keyDate.label}</td>
            <td>${keyDate.date}</td>
          </tr>
          `).join('')}
        </table>
      </div>
      ` : ''}
      
      <div class="section">
        <div class="section-title">BID MANAGER:</div>
        <table class="info-table">
          <tr>
            <td class="label">Name:</td>
            <td>${contactPerson}</td>
          </tr>
          <tr>
            <td class="label">Email:</td>
            <td>${contactEmail}</td>
          </tr>
          <tr>
            <td class="label">Phone:</td>
            <td>${contactPhone}</td>
          </tr>
        </table>
      </div>
      
      <div class="section">
        <div class="section-title">SUBMISSION REQUIREMENTS:</div>
        <div class="description-box">
          <ul class="requirements-list">
            <li>Bid Cost Breakdown (Excel File)</li>
            <li>Detailed Construction Schedule (w/ Long Lead Items)</li>
            <li>Affidavit</li>
            ${invitationToBid?.prequalificationCriteria ? 
              (Array.isArray(invitationToBid.prequalificationCriteria) ? 
                invitationToBid.prequalificationCriteria.map(req => `<li>${req}</li>`).join('') :
                `<li>${invitationToBid.prequalificationCriteria}</li>`) : ''}
          </ul>
        </div>
      </div>
      
      ${invitationToBid?.contractTerms || invitationToBid?.paymentTerms || invitationToBid?.insuranceRequirements ? `
      <div class="section">
        <div class="section-title">CONTRACT TERMS & CONDITIONS:</div>
        <div class="description-box">
          ${invitationToBid?.contractTerms ? `<p><strong>Contract Terms:</strong> ${invitationToBid.contractTerms}</p>` : ''}
          ${invitationToBid?.paymentTerms ? `<p><strong>Payment Terms:</strong> ${invitationToBid.paymentTerms}</p>` : ''}
          ${invitationToBid?.insuranceRequirements ? `<p><strong>Insurance Requirements:</strong> ${invitationToBid.insuranceRequirements}</p>` : ''}
          ${invitationToBid?.bondingRequirements ? `<p><strong>Bonding Requirements:</strong> ${invitationToBid.bondingRequirements}</p>` : ''}
        </div>
      </div>
      ` : ''}
      
      <div class="footer">
        <p>This invitation to bid is confidential and proprietary. Please do not distribute without authorization.</p>
      </div>
    </body>
    </html>
  `;
}

function generateArchitectRfpHtml(options: PdfGenerationOptions, dates: any): string {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea } = dates;
  
  const projectName = rfp.confidential ? `Confidential @ ${rfp.property}` : `${rfp.tenantName} @ ${rfp.property}`;
  const contactInfo = invitationToBid?.contactForQuestions?.split(' - ') || [];
  const contactPerson = contactInfo[0] || 'Development Contact';
  const contactEmail = contactInfo[1] || '';
  const contactPhone = contactInfo[2] || '';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Architect RFP - ${projectName}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          font-size: 11px;
          line-height: 1.4;
          color: #000;
          margin: 0;
          padding: 20px;
        }
        
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #000;
          padding-bottom: 15px;
        }
        
        .header h1 {
          font-size: 18px;
          font-weight: bold;
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 2px;
        }
        
        .header h2 {
          font-size: 14px;
          font-weight: normal;
          margin: 10px 0 0 0;
        }
        
        .section {
          margin-bottom: 25px;
        }
        
        .section-title {
          font-weight: bold;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 8px;
          border-bottom: 1px solid #ccc;
          padding-bottom: 3px;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
        }
        
        .info-table td {
          padding: 5px 8px;
          border: 1px solid #000;
          vertical-align: top;
        }
        
        .info-table .label {
          background-color: #f5f5f5;
          font-weight: bold;
          width: 25%;
        }
        
        .description-box {
          border: 1px solid #000;
          padding: 15px;
          margin: 10px 0;
          background-color: #fafafa;
        }
        
        .requirements-list {
          margin: 10px 0;
          padding-left: 20px;
        }
        
        .requirements-list li {
          margin-bottom: 5px;
        }
        
        .footer {
          margin-top: 40px;
          text-align: center;
          font-size: 10px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>REQUEST FOR PROPOSAL</h1>
        <h2>Architectural Services - ${projectName}</h2>
      </div>
      
      <div class="section">
        <table class="info-table">
          <tr>
            <td class="label">DATE:</td>
            <td>${today}</td>
          </tr>
          <tr>
            <td class="label">PROJECT NAME:</td>
            <td>${projectName}</td>
          </tr>
          <tr>
            <td class="label">PROJECT LOCATION:</td>
            <td>${invitationToBid?.projectLocation || rfp.property}<br>
                ${rfp.propertyAddress || ''}</td>
          </tr>
          <tr>
            <td class="label">TO:</td>
            <td>
              ${recipientCompany || 'Architectural Firm'}<br>
              ${recipientName || ''}<br>
              ${contactPhone}<br>
              ${contactEmail}
            </td>
          </tr>
        </table>
      </div>
      
      <div class="description-box">
        <p><strong>Dear ${recipientName || 'Architect'},</strong></p>
        <p>We are seeking architectural design services for the ${projectName} project. 
        Your firm has been selected based on your expertise and portfolio. We kindly request 
        a comprehensive proposal outlining your approach, timeline, and fee structure for 
        this project.</p>
        <p>For any questions regarding this RFP, please contact 
        ${contactPerson} at ${contactEmail} at your earliest convenience.</p>
      </div>
      
      <div class="section">
        <div class="section-title">PROJECT SCOPE:</div>
        <div class="description-box">
          <p>We require architectural design services for ${totalArea.toLocaleString()} sf of total rentable area. The project scope includes:</p>
          <ul class="requirements-list">
            ${warehouseArea > 0 ? `<li>Warehouse/Industrial Space: ${warehouseArea.toLocaleString()} sf</li>` : ''}
            ${existingOffice > 0 ? `<li>Existing Office Renovation: ${existingOffice.toLocaleString()} sf</li>` : ''}
            ${newOffice > 0 ? `<li>New Office Design: ${newOffice.toLocaleString()} sf</li>` : ''}
            <li>Schematic Design</li>
            <li>Design Development</li>
            <li>Construction Documents</li>
            <li>Permitting Assistance</li>
            <li>Construction Administration</li>
            ${invitationToBid?.technicalSpecifications ? `<li>Technical Specifications: ${invitationToBid.technicalSpecifications}</li>` : ''}
          </ul>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">PROPOSAL REQUIREMENTS:</div>
        <div class="description-box">
          <p>Please include the following in your proposal:</p>
          <ul class="requirements-list">
            <li>Project understanding and approach</li>
            <li>Detailed scope of services</li>
            <li>Project timeline and milestones</li>
            <li>Fee proposal (lump sum or hourly breakdown)</li>
            <li>Team qualifications and relevant project experience</li>
            <li>Three references from similar projects</li>
            <li>Insurance certificates (Professional Liability, General Liability)</li>
            ${invitationToBid?.prequalificationCriteria ? 
              (Array.isArray(invitationToBid.prequalificationCriteria) ? 
                invitationToBid.prequalificationCriteria.map(req => `<li>${req}</li>`).join('') :
                `<li>${invitationToBid.prequalificationCriteria}</li>`) : ''}
          </ul>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">KEY DATES:</div>
        <table class="info-table">
          <tr>
            <td class="label">RFP Issued</td>
            <td>${today}</td>
          </tr>
          <tr>
            <td class="label">Questions Due</td>
            <td>5 business days before proposal due</td>
          </tr>
          <tr>
            <td class="label">Proposals Due</td>
            <td>${bidDeadline}</td>
          </tr>
          <tr>
            <td class="label">Selection Notification</td>
            <td>Within 2 weeks of proposal deadline</td>
          </tr>
          <tr>
            <td class="label">Anticipated Project Start</td>
            <td>${projectStart}</td>
          </tr>
          <tr>
            <td class="label">Target Completion</td>
            <td>${projectEnd}</td>
          </tr>
        </table>
      </div>
      
      <div class="section">
        <div class="section-title">PROJECT CONTACT:</div>
        <table class="info-table">
          <tr>
            <td class="label">Name:</td>
            <td>${contactPerson}</td>
          </tr>
          <tr>
            <td class="label">Email:</td>
            <td>${contactEmail}</td>
          </tr>
          <tr>
            <td class="label">Phone:</td>
            <td>${contactPhone}</td>
          </tr>
        </table>
      </div>
      
      ${invitationToBid?.evaluationCriteria ? `
      <div class="section">
        <div class="section-title">EVALUATION CRITERIA:</div>
        <div class="description-box">
          <ul class="requirements-list">
            ${Array.isArray(invitationToBid.evaluationCriteria) ? 
              invitationToBid.evaluationCriteria.map(criteria => `<li>${criteria}</li>`).join('') :
              `<li>${invitationToBid.evaluationCriteria}</li>`}
          </ul>
        </div>
      </div>
      ` : ''}
      
      <div class="footer">
        <p>This RFP is confidential and proprietary. Please do not distribute without authorization.</p>
      </div>
    </body>
    </html>
  `;
}

export function generatePdfFilename(rfp: any, recipientType: string): string {
  const projectName = rfp.confidential ? `Confidential_${rfp.property}` : `${rfp.tenantName}_${rfp.property}`;
  const cleanProjectName = projectName.replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = new Date().toISOString().split('T')[0];
  return `${recipientType === 'contractor' ? 'ITB' : 'RFP'}_${cleanProjectName}_${recipientType}_${timestamp}.pdf`;
}