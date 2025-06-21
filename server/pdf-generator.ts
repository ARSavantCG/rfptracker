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

function getMilestoneRequestsSection(invitationToBid: any, recipientType: string): string {
  const isArchitect = recipientType === 'architect' || recipientType === 'broker-architect';
  const isContractor = recipientType === 'contractor' || recipientType === 'broker-contractor';
  
  const architectMilestones = invitationToBid?.architectMilestones || [];
  const contractorMilestones = invitationToBid?.contractorMilestones || [];
  
  let milestonesList = '';
  
  if (isArchitect && architectMilestones.length > 0) {
    milestonesList = architectMilestones.map((milestone: any) => `<li>${milestone.description}</li>`).join('');
  } else if (isContractor && contractorMilestones.length > 0) {
    milestonesList = contractorMilestones.map((milestone: any) => `<li>${milestone.description}</li>`).join('');
  }
  
  if (milestonesList) {
    return `
      <div class="section">
        <div class="section-title">Milestone Request(s)</div>
        <p>Please provide timeline and schedule information for the following project milestones in your response:</p>
        <ul>
          ${milestonesList}
        </ul>
      </div>
    `;
  }
  
  return '';
}

function hasMilestones(invitationToBid: any, recipientType: string): boolean {
  const isArchitect = recipientType === 'architect' || recipientType === 'broker-architect';
  const isContractor = recipientType === 'contractor' || recipientType === 'broker-contractor';
  
  const architectMilestones = invitationToBid?.architectMilestones || [];
  const contractorMilestones = invitationToBid?.contractorMilestones || [];
  
  if (isArchitect && architectMilestones.length > 0) {
    return true;
  } else if (isContractor && contractorMilestones.length > 0) {
    return true;
  }
  
  return false;
}

function getBayConfigurationSection(rfp: any): string {
  // Get bay configurations from the RFP's selected bay configurations
  const selectedBayConfigs = rfp.selectedBayConfigurations || [];
  
  if (!selectedBayConfigs.length) {
    return '';
  }

  // Calculate totals
  let totalSquareFootage = 0;
  let totalStandardDoors = 0;
  let totalOversizedDoors = 0;

  const bayRows = selectedBayConfigs.map((bay: any) => {
    totalSquareFootage += bay.squareFootage || 0;
    totalStandardDoors += bay.standardDockDoors || 0;
    totalOversizedDoors += bay.oversizedDockDoors || 0;

    return `
      <tr>
        <td>${bay.bayName}</td>
        <td style="text-align: right;">${(bay.squareFootage || 0).toLocaleString()} sf</td>
        <td style="text-align: center;">${bay.standardDockDoors || 0}</td>
        <td style="text-align: center;">${bay.oversizedDockDoors || 0}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="section">
      <div class="section-title">FACILITY DETAILS:</div>
      <div class="description-box">
        <p>The tenant space includes the following bay configurations:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
          <tr style="background-color: #f5f5f5;">
            <th style="border: 1px solid #000; padding: 8px; text-align: left;">Bay Range</th>
            <th style="border: 1px solid #000; padding: 8px; text-align: right;">Square Footage</th>
            <th style="border: 1px solid #000; padding: 8px; text-align: center;">Standard Doors</th>
            <th style="border: 1px solid #000; padding: 8px; text-align: center;">Oversized Doors</th>
          </tr>
          ${bayRows}
          <tr style="background-color: #f0f0f0; font-weight: bold;">
            <td style="border: 1px solid #000; padding: 8px;">TOTAL</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${totalSquareFootage.toLocaleString()} sf</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: center;">${totalStandardDoors}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: center;">${totalOversizedDoors}</td>
          </tr>
        </table>
        <p><strong>Dock Door Specifications:</strong></p>
        <ul class="requirements-list">
          <li>Standard Dock Doors: 8' x 9' overhead doors with dock levelers</li>
          <li>Oversized Dock Doors: 10' x 12' overhead doors with heavy-duty dock levelers</li>
          <li>All dock doors include weatherproofing and safety equipment</li>
        </ul>
      </div>
    </div>
  `;
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
  
  // Calculate totals from evaluation budget data
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Get evaluation budget data from rfp
  const evaluationBudget = rfp.evaluationBudget || {};
  const tenantImprovements = evaluationBudget.tenantImprovements || [];
  const designSoftCosts = evaluationBudget.designSoftCosts || [];
  const existingImprovements = evaluationBudget.existingImprovements || [];

  // Calculate category totals
  const calculateCategoryTotal = (items: any[]) => {
    return items.reduce((sum: number, item: any) => {
      return sum + (parseFloat(item.totalPrice) || 0);
    }, 0);
  };

  const tenantImprovementsTotal = calculateCategoryTotal(tenantImprovements);
  const designSoftCostsTotal = calculateCategoryTotal(designSoftCosts);
  const existingImprovementsTotal = calculateCategoryTotal(existingImprovements);
  const grandTotal = tenantImprovementsTotal + designSoftCostsTotal + 
    (evaluationBudget.hasExistingImprovements && evaluationBudget.includeExistingInTotal ? existingImprovementsTotal : 0);

  // Generate line item table for a category
  const generateLineItemTable = (title: string, items: any[], total: number) => {
    if (items.length === 0) return '';
    
    return `
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">${title}</h2>
          <span class="section-total">${formatCurrency(total)}</span>
        </div>
        <div class="table-container">
          <table class="line-items-table">
            <thead>
              <tr>
                <th class="description-col">DESCRIPTION</th>
                <th class="quantity-col">QUANTITY</th>
                <th class="unit-col">UNIT</th>
                <th class="unit-price-col">UNIT PRICE</th>
                <th class="total-price-col">TOTAL PRICE</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr>
                  <td class="description-col">${item.description}</td>
                  <td class="quantity-col">${item.quantity}</td>
                  <td class="unit-col">${item.unit}</td>
                  <td class="unit-price-col">${formatCurrency(parseFloat(item.unitPrice) || 0)}</td>
                  <td class="total-price-col">${formatCurrency(parseFloat(item.totalPrice) || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Financial Summary - ${rfp.projectName}</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          margin: 0; 
          padding: 20px; 
          color: #333; 
          line-height: 1.4; 
        }
        .header { 
          text-align: center; 
          margin-bottom: 30px; 
          border-bottom: 2px solid #2563eb; 
          padding-bottom: 20px; 
        }
        .company-info { text-align: left; margin-bottom: 20px; }
        .document-title { font-size: 18px; font-weight: bold; color: #2563eb; margin: 10px 0; }
        .project-title { font-size: 16px; font-weight: bold; margin: 5px 0; }
        
        .section {
          background: white;
          margin: 20px 0;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 2px solid #e9ecef;
        }
        
        .section-title {
          font-size: 16px;
          font-weight: bold;
          color: #495057;
          margin: 0;
        }
        
        .section-total {
          font-size: 18px;
          font-weight: bold;
          color: #28a745;
        }
        
        .table-container {
          overflow-x: auto;
        }
        
        .line-items-table {
          width: 100%;
          border-collapse: collapse;
          margin: 0;
        }
        
        .line-items-table th {
          background-color: #f8f9fa;
          border: 1px solid #dee2e6;
          padding: 12px 8px;
          text-align: left;
          font-weight: bold;
          font-size: 11px;
          color: #495057;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .line-items-table td {
          border: 1px solid #dee2e6;
          padding: 10px 8px;
          vertical-align: top;
          font-size: 12px;
        }
        
        .line-items-table tbody tr:nth-child(even) {
          background-color: #f8f9fa;
        }
        
        /* Column-specific styling for consistent alignment */
        .description-col { 
          width: 40%; 
          text-align: left; 
        }
        .quantity-col { 
          width: 12%; 
          text-align: center; 
        }
        .unit-col { 
          width: 8%; 
          text-align: center; 
        }
        .unit-price-col { 
          width: 20%; 
          text-align: right; 
        }
        .total-price-col { 
          width: 20%; 
          text-align: right; 
        }
        
        .grand-total {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          border-radius: 8px;
          text-align: center;
          margin: 30px 0;
          box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        
        .grand-total h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
        }
        
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 15px 0; }
        .info-item { display: flex; margin: 5px 0; }
        .label { font-weight: bold; min-width: 120px; }
        .value { margin-left: 10px; }
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
            <div class="info-item"><span class="label">Property:</span><span class="value">${rfp.property}</span></div>
            <div class="info-item"><span class="label">Development Contact:</span><span class="value">${rfp.developmentContact || 'Not specified'}</span></div>
            <div class="info-item"><span class="label">Report Date:</span><span class="value">${today}</span></div>
          </div>
        </div>
      </div>

      <!-- Detailed Line Item Tables -->
      ${generateLineItemTable("Tenant Improvements", tenantImprovements, tenantImprovementsTotal)}
      ${generateLineItemTable("Design / Soft Costs / Other Fees", designSoftCosts, designSoftCostsTotal)}
      ${existingImprovements.length > 0 ? generateLineItemTable("Existing Improvements", existingImprovements, existingImprovementsTotal) : ''}

      <div class="grand-total">
        <h2>Grand Total: ${formatCurrency(grandTotal)}</h2>
        ${evaluationBudget.hasExistingImprovements && !evaluationBudget.includeExistingInTotal ? 
          '<p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">* Existing improvements tracked separately for financial modeling</p>' : ''
        }
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
  
  // Calculate areas for display using area breakdown data
  const totalArea = parseInt(rfp.warehouseArea?.replace(/,/g, '') || '0');
  const areaBreakdown = (rfp as any).areaBreakdown || [];
  const totalBreakdownArea = areaBreakdown.reduce((sum: number, item: any) => sum + (parseInt(item.squareFootage) || 0), 0);
  const warehouseArea = totalArea - totalBreakdownArea;
  
  // Legacy support for old office area fields
  const existingOffice = parseInt(rfp.officeAreaExisting?.replace(/,/g, '') || '0');
  const newOffice = parseInt(rfp.officeAreaNew?.replace(/,/g, '') || '0');
  
  // Get warehouse notes from RFP data
  const warehouseNotes = rfp.warehouseNotes || "Clear height requirements TBD";

  // Generate different content based on recipient type
  if (recipientType === "contractor") {
    return generateContractorRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes });
  } else if (recipientType === "broker-contractor") {
    return generateBrokerContractorRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes });
  } else if (recipientType === "broker-architect") {
    return generateBrokerArchitectRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes });
  } else if (recipientType === "financial-summary") {
    return generateFinancialSummaryHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes });
  } else {
    return generateArchitectRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes });
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
      
      ${getMilestoneRequestsSection(invitationToBid, 'contractor')}
      
      <div class="section">
        <div class="section-title">SUBMISSION REQUIREMENTS:</div>
        <div class="description-box">
          <ul class="requirements-list">
            <li>Bid Cost Breakdown (Excel File)</li>
            <li>Detailed Construction Schedule (w/ Long Lead Items)${hasMilestones(invitationToBid, 'contractor') ? ' based on milestone requests below' : ''}</li>
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
      
      ${getBayConfigurationSection(rfp)}
      
      ${getMilestoneRequestsSection(invitationToBid, 'architect')}
      
      <div class="section">
        <div class="section-title">PROPOSAL REQUIREMENTS:</div>
        <div class="description-box">
          <p>Please include the following in your proposal:</p>
          <ul class="requirements-list">
            <li>Project understanding and approach</li>
            <li>Detailed scope of services</li>
            <li>Project timeline and milestones${hasMilestones(invitationToBid, 'architect') ? ' based on milestone requests below' : ''}</li>
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
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes } = dates;

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
        This is a preliminary request for architectural input in order to support early-stage discussions with a prospective tenant. It does not represent a formal project commitment.
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

      ${totalArea > 0 ? `
      <div class="section">
        <div class="section-title">Space Requirements</div>
        <table>
          <tr><th>Space Type</th><th>Area (sq ft)</th><th>Notes</th></tr>
          ${warehouseArea > 0 ? `<tr><td>Warehouse</td><td>${warehouseArea.toLocaleString()}</td><td>${warehouseNotes}</td></tr>` : ''}
          ${areaBreakdown && areaBreakdown.length > 0 ? areaBreakdown.map((item: any) => 
            `<tr><td>${item.description || 'Area'}</td><td>${parseInt(item.squareFootage || '0').toLocaleString()}</td><td>${item.notes || ''}</td></tr>`
          ).join('') : ''}
          ${existingOffice > 0 && (!areaBreakdown || areaBreakdown.length === 0) ? `<tr><td>Existing Office</td><td>${existingOffice.toLocaleString()}</td><td>Renovation level TBD</td></tr>` : ''}
          ${newOffice > 0 && (!areaBreakdown || areaBreakdown.length === 0) ? `<tr><td>New Office Space</td><td>${newOffice.toLocaleString()}</td><td>New construction</td></tr>` : ''}
          <tr><td><strong>Total</strong></td><td><strong>${totalArea.toLocaleString()}</strong></td><td></td></tr>
        </table>
      </div>
      ` : ''}

      ${getBayConfigurationSection(rfp)}

      <div class="section">
        <div class="section-title">Requested Deliverables</div>
        <ul>
          <li>Preliminary space plan</li>
          <li>Timeline estimate for design phases${hasMilestones(invitationToBid, 'broker-architect') ? ' based on milestone requests below' : ''}</li>
          <li>Fee proposal for full architectural services</li>
        </ul>
      </div>

      ${getMilestoneRequestsSection(invitationToBid, 'broker-architect')}

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
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes } = dates;

  // Extract contact information from invitation to bid
  const contactInfo = invitationToBid?.contactForQuestions || '';
  const contactParts = contactInfo.split(' - ');
  const contactPerson = contactParts[0] || 'Development Team';
  const contactEmail = contactParts[1] || 'contact@company.com';
  const contactPhone = contactParts[2] || '';

  const projectName = rfp.confidential ? `Confidential @ ${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}` : `${rfp.tenantName} @ ${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}`;

  // Format bid deadline with E.O.B.
  const formattedDeadline = bidDeadline.replace(/(\d{4})$/, '$1 E.O.B.');

  // Generate scope of work HTML safely
  let scopeOfWorkHtml = '';
  if (invitationToBid?.scopeOfWork && Array.isArray(invitationToBid.scopeOfWork) && invitationToBid.scopeOfWork.length > 0) {
    const scopeItems = invitationToBid.scopeOfWork.map(item => {
      const quantity = item.quantity ? ' - ' + item.quantity.toLocaleString() + ' ' + (item.unit || '') : '';
      return '<li>' + item.description + quantity + '</li>';
    }).join('');
    
    scopeOfWorkHtml = '<div class="scope-of-work"><strong>Scope of Work:</strong><ul>' + scopeItems + '</ul></div>';
  }

  // Generate space requirements table HTML safely using area breakdown data
  let spaceRequirementsHtml = '';
  if (totalArea > 0) {
    let spaceRows = '';
    
    // Add warehouse area if it exists
    if (warehouseArea > 0) {
      spaceRows += '<tr><td>Warehouse</td><td>' + warehouseArea.toLocaleString() + '</td><td>' + warehouseNotes + '</td></tr>';
    }
    
    // Add dynamic area breakdown items with custom notes
    if (areaBreakdown && areaBreakdown.length > 0) {
      areaBreakdown.forEach((item: any) => {
        const description = item.description || 'Area';
        const squareFootage = parseInt(item.squareFootage || '0');
        const notes = item.notes || '';
        if (squareFootage > 0) {
          spaceRows += '<tr><td>' + description + '</td><td>' + squareFootage.toLocaleString() + '</td><td>' + notes + '</td></tr>';
        }
      });
    } else {
      // Fallback to legacy office areas if no area breakdown exists
      if (existingOffice > 0) {
        spaceRows += '<tr><td>Existing Office</td><td>' + existingOffice.toLocaleString() + '</td><td>Renovation level TBD</td></tr>';
      }
      if (newOffice > 0) {
        spaceRows += '<tr><td>New Office Space</td><td>' + newOffice.toLocaleString() + '</td><td>New construction</td></tr>';
      }
    }
    
    spaceRows += '<tr><td><strong>Total</strong></td><td><strong>' + totalArea.toLocaleString() + '</strong></td><td></td></tr>';
    
    spaceRequirementsHtml = '<div class="section"><div class="section-title">Space Requirements</div><table><tr><th>Space Type</th><th>Area (sq ft)</th><th>Notes</th></tr>' + spaceRows + '</table></div>';
  }

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
            <div class="info-item"><span class="label">Project:</span><span class="value">${invitationToBid?.projectScope || rfp.tenantName}</span></div>
            <div class="info-item"><span class="label">Property Address:</span><span class="value">${invitationToBid?.projectLocation || rfp.propertyAddress || rfp.property}</span></div>
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

        ${scopeOfWorkHtml}

        ${invitationToBid?.documentsLink ? `
        <div class="info-item" style="margin-top: 15px;">
          <span class="label">Project Documents:</span>
          <span class="value"><a href="${invitationToBid.documentsLink}" target="_blank">${invitationToBid.documentsLink}</a></span>
        </div>
        ` : ''}
      </div>

      ${spaceRequirementsHtml}

      ${getBayConfigurationSection(rfp)}

      <div class="section">
        <div class="section-title">Requested Deliverables</div>
        <ul>
          <li>Preliminary cost estimate</li>
          <li>Timeline estimate for construction phases${hasMilestones(invitationToBid, 'broker-contractor') ? ' based on milestone requests below' : ''}</li>
          <li>Pricing proposal for full construction services</li>
        </ul>
      </div>

      ${getMilestoneRequestsSection(invitationToBid, 'broker-contractor')}

      <div class="section">
        <div class="section-title">Pricing Considerations</div>
        <ul>
          <li>Review tenant improvement requirements and building conditions</li>
          <li>Provide conceptual cost estimates for typical build-out scenarios</li>
          <li>Identify potential challenges or special requirements</li>
          <li>Unit cost guidance for common improvement types</li>
          <li>Preliminary construction scheduling</li>
          <li>Assessment of existing building systems and access requirements</li>
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
