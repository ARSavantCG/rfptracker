import { createWriteStream } from "fs";
import { promisify } from "util";
import puppeteer from "puppeteer";

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
  recipientType: "architect" | "contractor" | "broker-architect" | "broker-contractor" | "financial-summary";
  recipientName?: string;
  recipientCompany?: string;
}

function generateFinancialSummaryHtml(options: PdfGenerationOptions, dates: any): string {
  const { rfp } = options;
  const { today } = dates;
  
  // Calculate totals from bid collections and line items
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Calculate category totals from all line items
  const calculateCategoryTotal = (category: string) => {
    if (!rfp.allLineItems) return 0;
    return rfp.allLineItems.reduce((sum: number, item: any) => {
      if (item.category?.toLowerCase() === category.toLowerCase()) {
        return sum + (parseFloat(item.totalPrice) || 0);
      }
      return sum;
    }, 0);
  };

  const tenantImprovementsTotal = calculateCategoryTotal("tenant improvements");
  const designSoftCostsTotal = calculateCategoryTotal("design/soft costs");
  const existingImprovementsTotal = calculateCategoryTotal("existing improvements");
  const grandTotal = tenantImprovementsTotal + designSoftCostsTotal + existingImprovementsTotal;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Financial Summary - ${rfp.projectName}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; line-height: 1.4; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2563eb; padding-bottom: 20px; }
        .company-info { text-align: left; margin-bottom: 20px; }
        .document-title { font-size: 24px; font-weight: bold; color: #2563eb; margin: 10px 0; }
        .project-title { font-size: 18px; font-weight: bold; margin: 5px 0; }
        .section { margin: 20px 0; }
        .section-title { font-size: 16px; font-weight: bold; color: #2563eb; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 15px 0; }
        .info-item { display: flex; margin: 5px 0; }
        .label { font-weight: bold; min-width: 120px; }
        .value { margin-left: 10px; }
        .cost-summary { background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .cost-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
        .cost-item:last-child { border-bottom: none; }
        .cost-label { font-weight: bold; }
        .cost-value { font-size: 18px; font-weight: bold; }
        .total-row { background-color: #2563eb; color: white; padding: 15px; border-radius: 5px; margin-top: 10px; }
        .bid-summary { margin: 20px 0; }
        .bid-item { background-color: #f9fafb; padding: 15px; margin: 10px 0; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; }
        .export-info { background-color: #dbeafe; padding: 15px; border-radius: 8px; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 12px; text-align: left; }
        th { background-color: #f9fafb; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-info">
          <div><strong>Financial Summary Report</strong></div>
          <div>Generated: ${today}</div>
          <div>RFP Number: ${rfp.rfpNumber}</div>
        </div>
        <div class="document-title">PROJECT FINANCIAL SUMMARY</div>
        <div class="project-title">${rfp.projectName}</div>
      </div>

      <div class="section">
        <div class="section-title">Project Overview</div>
        <div class="info-grid">
          <div>
            <div class="info-item"><span class="label">RFP Number:</span><span class="value">${rfp.rfpNumber}</span></div>
            <div class="info-item"><span class="label">Project Name:</span><span class="value">${rfp.projectName}</span></div>
            <div class="info-item"><span class="label">Tenant:</span><span class="value">${rfp.tenantName}</span></div>
          </div>
          <div>
            <div class="info-item"><span class="label">Project Area:</span><span class="value">${rfp.projectArea} sq ft</span></div>
            <div class="info-item"><span class="label">Development Contact:</span><span class="value">${rfp.developmentContact}</span></div>
            <div class="info-item"><span class="label">Report Date:</span><span class="value">${today}</span></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Cost Breakdown Summary</div>
        <div class="cost-summary">
          <div class="cost-item">
            <span class="cost-label">Tenant Improvements</span>
            <span class="cost-value" style="color: #16a34a;">${formatCurrency(tenantImprovementsTotal)}</span>
          </div>
          <div class="cost-item">
            <span class="cost-label">Design / Soft Costs / Other Fees</span>
            <span class="cost-value" style="color: #2563eb;">${formatCurrency(designSoftCostsTotal)}</span>
          </div>
          ${existingImprovementsTotal > 0 ? `
          <div class="cost-item">
            <span class="cost-label">Existing Improvements</span>
            <span class="cost-value" style="color: #ea580c;">${formatCurrency(existingImprovementsTotal)}</span>
          </div>
          ` : ''}
          <div class="cost-item total-row">
            <span class="cost-label" style="font-size: 20px;">Total Project Cost</span>
            <span class="cost-value" style="font-size: 24px;">${formatCurrency(grandTotal)}</span>
          </div>
        </div>
      </div>



      <div class="section">
        <div class="section-title">Financial Analysis Notes</div>
        <div class="export-info">
          <p><strong>Purpose:</strong> This financial summary provides a comprehensive breakdown of project costs for integration into internal financial modeling systems.</p>
          
          <p><strong>Cost Categories:</strong></p>
          <ul>
            <li><strong>Tenant Improvements:</strong> Direct construction and improvement costs</li>
            <li><strong>Design / Soft Costs:</strong> Architectural, engineering, and project management fees</li>
            ${existingImprovementsTotal > 0 ? '<li><strong>Existing Improvements:</strong> Costs related to existing facility modifications</li>' : ''}
          </ul>
          
          <p><strong>Data Source:</strong> Compiled from evaluated bids and internal cost assessments during the RFP evaluation phase.</p>
          
          <p><strong>Next Steps:</strong> Use these figures for lease negotiation modeling, budget approval processes, and project financial planning.</p>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Document Information</div>
        <table>
          <tr><th>Field</th><th>Value</th></tr>
          <tr><td>Document Type</td><td>Financial Summary Report</td></tr>
          <tr><td>Generated By</td><td>RFP Management System</td></tr>
          <tr><td>Generation Date</td><td>${today}</td></tr>
          <tr><td>Project Phase</td><td>Evaluation Complete</td></tr>
          <tr><td>Status</td><td>Ready for Financial Modeling</td></tr>
        </table>
      </div>
    </body>
    </html>
  `;
}

export async function generateRfpPdf(options: PdfGenerationOptions): Promise<Buffer> {
  const html = generateRfpHtml(options);
  
  // For now, return optimized HTML that browsers can convert to PDF
  // This allows the client-side print functionality to work properly
  return Buffer.from(html, 'utf8');
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
  } else if (recipientType === "broker-contractor") {
    return generateBrokerContractorRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea });
  } else if (recipientType === "broker-architect") {
    return generateBrokerArchitectRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea });
  } else if (recipientType === "financial-summary") {
    return generateFinancialSummaryHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea });
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
  const projectAddress = rfp.propertyAddress || invitationToBid?.projectLocation || rfp.property;
  
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
  
  const projectName = rfp.confidential ? `Confidential @ ${rfp.propertyAddress || rfp.property}` : `${rfp.tenantName} @ ${rfp.propertyAddress || rfp.property}`;
  const projectLocation = rfp.propertyAddress || invitationToBid?.projectLocation || rfp.property;
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
            <td>${projectLocation}</td>
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

function generateBrokerArchitectRfpHtml(options: PdfGenerationOptions, dates: any): string {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea } = dates;

  // Extract contact information from invitation to bid
  const contactInfo = invitationToBid?.contactForQuestions || '';
  const contactParts = contactInfo.split(' - ');
  const contactPerson = contactParts[0] || 'Development Team';
  const contactEmail = contactParts[1] || 'contact@company.com';
  const contactPhone = contactParts[2] || '';

  const projectName = rfp.confidential ? `Confidential @ ${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}` : `${rfp.tenantName} @ ${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}`;

  // Format bid deadline with E.O.B.
  const formattedDeadline = bidDeadline.replace(/(\d{4})$/, '$1 E.O.B.');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Broker Response RFP - Architect Services</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.4; color: #333; }
        .header { border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
        .company-info { text-align: right; margin-bottom: 20px; }
        .document-title { font-size: 24px; font-weight: bold; color: #2563eb; margin-bottom: 10px; }
        .project-title { font-size: 18px; color: #666; margin-bottom: 20px; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: bold; color: #2563eb; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-item { margin-bottom: 10px; }
        .label { font-weight: bold; color: #666; }
        .value { margin-left: 10px; }
        .requirements { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; }
        .preliminary-notice { background-color: #dbeafe; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
        th { background-color: #f9fafb; font-weight: bold; }
        .project-description { background-color: #f9fafb; padding: 15px; border-radius: 5px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-info">
          <div><strong>Development Team</strong></div>
          <div>${contactPerson}</div>
          <div>Email: ${contactEmail}</div>
          <div>Date: ${today}</div>
        </div>
        <div class="document-title">PRELIMINARY REQUEST FOR PROPOSAL</div>
        <div class="project-title">Architectural Services - ${projectName}</div>
        <div style="font-size: 14px; color: #666;">RFP Number: ${rfp.rfpNumber}</div>
      </div>

      <div class="preliminary-notice">
        <strong>PRELIMINARY BROKER RESPONSE RFP</strong><br>
        This is a preliminary request for space planning and conceptual pricing to support broker discussions with a prospective tenant. This is not a formal project commitment.
      </div>

      <div class="section">
        <div class="section-title">Project Overview</div>
        <div class="info-grid">
          <div>
            <div class="info-item"><span class="label">Project:</span><span class="value">${invitationToBid?.projectScope || rfp.tenantName}</span></div>
            <div class="info-item"><span class="label">Property Address:</span><span class="value">${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}</span></div>
          </div>
          <div>
            <div class="info-item"><span class="label">Requested Response:</span><span class="value">${formattedDeadline}</span></div>
            <div class="info-item"><span class="label">Project Type:</span><span class="value">Preliminary Assessment</span></div>
          </div>
        </div>

        ${invitationToBid?.projectDescription ? `
        <div class="project-description">
          <strong>Project Description:</strong><br>
          ${invitationToBid.projectDescription}
        </div>
        ` : ''}

        ${invitationToBid?.scopeOfWork && Array.isArray(invitationToBid.scopeOfWork) && invitationToBid.scopeOfWork.length > 0 ? `
        <div class="scope-of-work">
          <strong>Scope of Work:</strong>
          <ul>
            ${invitationToBid.scopeOfWork.map(item => `
              <li>${item.description}${item.quantity ? ` - ${item.quantity.toLocaleString()} ${item.unit || ''}` : ''}</li>
            `).join('')}
          </ul>
        </div>
        ` : ''}

        ${invitationToBid?.documentsLink ? `
        <div class="info-item" style="margin-top: 15px;">
          <span class="label">Project Documents:</span>
          <span class="value"><a href="${invitationToBid.documentsLink}" target="_blank">${invitationToBid.documentsLink}</a></span>
        </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">Requested Deliverables</div>
        <ul>
          <li>Preliminary space plan</li>
          <li>Timeline estimate for design phases</li>
          <li>Fee proposal for full architectural services</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-title">Pricing Considerations</div>
        <ul>
          <li>Review existing building conditions and space requirements</li>
          <li>Develop preliminary space planning concepts</li>
          <li>Provide conceptual floor plans showing potential layout options</li>
          <li>Identify major building system impacts and requirements</li>
          <li>Preliminary cost estimation for tenant improvements</li>
          <li>Detailed design development</li>
          <li>Construction documents</li>
          <li>Permitting support</li>
          <li>Construction administration</li>
        </ul>
      </div>

      ${totalArea > 0 ? `
      <div class="section">
        <div class="section-title">Space Requirements</div>
        <table>
          <tr><th>Space Type</th><th>Area (sq ft)</th><th>Notes</th></tr>
          ${warehouseArea > 0 ? `<tr><td>Warehouse/Industrial</td><td>${warehouseArea.toLocaleString()}</td><td>Clear height requirements TBD</td></tr>` : ''}
          ${existingOffice > 0 ? `<tr><td>Existing Office</td><td>${existingOffice.toLocaleString()}</td><td>Renovation level TBD</td></tr>` : ''}
          ${newOffice > 0 ? `<tr><td>New Office Space</td><td>${newOffice.toLocaleString()}</td><td>New construction</td></tr>` : ''}
          <tr><td><strong>Total</strong></td><td><strong>${totalArea.toLocaleString()}</strong></td><td></td></tr>
        </table>
      </div>
      ` : ''}

      <div class="requirements">
        <strong>Important Note:</strong> This preliminary RFP is issued to support ongoing lease negotiations with a prospective tenant. 
        The project may not proceed, and this request does not constitute a commitment to architectural services. 
        Please provide conceptual-level pricing suitable for initial tenant discussions.
      </div>

      <div class="footer">
        <p>This preliminary RFP was generated on ${today} for broker response purposes. 
        For questions, please contact ${contactPerson}.</p>
      </div>
    </body>
    </html>
  `;
}

function generateBrokerContractorRfpHtml(options: PdfGenerationOptions, dates: any): string {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea } = dates;

  // Extract contact information from invitation to bid
  const contactInfo = invitationToBid?.contactForQuestions || '';
  const contactParts = contactInfo.split(' - ');
  const contactPerson = contactParts[0] || 'Development Team';
  const contactEmail = contactParts[1] || 'contact@company.com';
  const contactPhone = contactParts[2] || '';

  const projectName = rfp.confidential ? `Confidential @ ${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}` : `${rfp.tenantName} @ ${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}`;

  // Format bid deadline with E.O.B.
  const formattedDeadline = bidDeadline.replace(/(\d{4})$/, '$1 E.O.B.');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Broker Response RFP - General Contractor Services</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.4; color: #333; }
        .header { border-bottom: 3px solid #059669; padding-bottom: 20px; margin-bottom: 30px; }
        .company-info { text-align: right; margin-bottom: 20px; }
        .document-title { font-size: 24px; font-weight: bold; color: #059669; margin-bottom: 10px; }
        .project-title { font-size: 18px; color: #666; margin-bottom: 20px; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: bold; color: #059669; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-item { margin-bottom: 10px; }
        .label { font-weight: bold; color: #666; }
        .value { margin-left: 10px; }
        .requirements { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; }
        .preliminary-notice { background-color: #d1fae5; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
        th { background-color: #f9fafb; font-weight: bold; }
        .project-description { background-color: #f9fafb; padding: 15px; border-radius: 5px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-info">
          <div><strong>Development Team</strong></div>
          <div>${contactPerson}</div>
          <div>Email: ${contactEmail}</div>
          <div>Date: ${today}</div>
        </div>
        <div class="document-title">PRELIMINARY REQUEST FOR PROPOSAL</div>
        <div class="project-title">General Contractor Services - ${projectName}</div>
        <div style="font-size: 14px; color: #666;">RFP Number: ${rfp.rfpNumber}</div>
      </div>

      <div class="preliminary-notice">
        <strong>PRELIMINARY BROKER RESPONSE RFP</strong><br>
        This is a preliminary request for conceptual pricing and scheduling to support broker discussions with a prospective tenant. This is not a formal project commitment.
      </div>

      <div class="section">
        <div class="section-title">Project Overview</div>
        <div class="info-grid">
          <div>
            <div class="info-item"><span class="label">Property:</span><span class="value">${invitationToBid?.projectScope || rfp.tenantName}</span></div>
            <div class="info-item"><span class="label">Prospective Tenant:</span><span class="value">${rfp.confidential ? 'Confidential' : rfp.tenantName}</span></div>
            ${totalArea > 0 ? `<div class="info-item"><span class="label">Total Area:</span><span class="value">${totalArea.toLocaleString()} sq ft</span></div>` : ''}
          </div>
          <div>
            <div class="info-item"><span class="label">Requested Response:</span><span class="value">${formattedDeadline}</span></div>
            <div class="info-item"><span class="label">Project Type:</span><span class="value">Preliminary Pricing</span></div>
          </div>
        </div>

        ${invitationToBid?.projectDescription ? `
        <div class="project-description">
          <strong>Project Description:</strong><br>
          ${invitationToBid.projectDescription}
        </div>
        ` : ''}

        ${invitationToBid?.documentsLink ? `
        <div class="info-item" style="margin-top: 15px;">
          <span class="label">Project Documents:</span>
          <span class="value"><a href="${invitationToBid.documentsLink}" target="_blank">${invitationToBid.documentsLink}</a></span>
        </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">Preliminary Scope of Work</div>
        <p><strong>Conceptual Phase (Requested):</strong></p>
        <ul>
          <li>Review tenant improvement requirements and building conditions</li>
          <li>Provide conceptual cost estimates for typical build-out scenarios</li>
          <li>Preliminary scheduling for design and construction phases</li>
          <li>Identify potential challenges or special requirements</li>
          <li>Unit cost guidance for common improvement types</li>
        </ul>
        
        <p><strong>Future Phases (If Project Proceeds):</strong></p>
        <ul>
          <li>Detailed cost estimation based on final plans</li>
          <li>Value engineering recommendations</li>
          <li>Construction execution</li>
          <li>Project management and coordination</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-title">Space Breakdown</div>
        <table>
          <tr><th>Space Type</th><th>Area (sq ft)</th><th>Typical Improvement Level</th></tr>
          <tr><td>Warehouse/Industrial</td><td>${warehouseArea.toLocaleString()}</td><td>Minimal - painting, basic utilities</td></tr>
          <tr><td>Existing Office Renovation</td><td>${existingOffice.toLocaleString()}</td><td>Moderate - updated finishes, HVAC</td></tr>
          <tr><td>New Office Construction</td><td>${newOffice.toLocaleString()}</td><td>Full build-out</td></tr>
          <tr><td><strong>Total Project Area</strong></td><td><strong>${totalArea.toLocaleString()}</strong></td><td></td></tr>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Requested Pricing Information</div>
        <ul>
          <li>Conceptual cost per square foot by space type</li>
          <li>Total project cost range (low/medium/high scenarios)</li>
          <li>Timeline estimate for construction (assuming plans available)</li>
          <li>Key factors that could impact pricing</li>
          <li>Preliminary schedule including permitting considerations</li>
        </ul>
      </div>

      <div class="requirements">
        <strong>Important Note:</strong> This preliminary RFP is issued to support ongoing lease negotiations with a prospective tenant. 
        The project may not proceed, and this request does not constitute a commitment to construction services. 
        Please provide conceptual-level pricing suitable for initial tenant discussions.
      </div>

      <div class="footer">
        <p>This preliminary RFP was generated on ${today} for broker response purposes. 
        For questions, please contact ${rfp.developmentContact || 'Development Team'}.</p>
      </div>
    </body>
    </html>
  `;
}

export function generatePdfFilename(rfp: any, recipientType: string): string {
  const projectName = rfp.confidential ? `Confidential_${rfp.property}` : `${rfp.tenantName}_${rfp.property}`;
  const cleanProjectName = projectName.replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = new Date().toISOString().split('T')[0];
  
  // Determine document type prefix
  let prefix = 'RFP';
  if (recipientType === 'contractor') {
    prefix = 'ITB';
  } else if (recipientType === 'broker-architect') {
    prefix = 'Preliminary_Architect_RFP';
  } else if (recipientType === 'broker-contractor') {
    prefix = 'Preliminary_Contractor_RFP';
  }
  
  return `${prefix}_${cleanProjectName}_${timestamp}.pdf`;
}
