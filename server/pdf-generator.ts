import { createWriteStream } from "fs";
import { promisify } from "util";
import { storage } from "./storage";
import { evaluateFormula } from "@shared/formula-utils";

// Function to get template content for PDF generation
async function getTemplateContent(recipientType: string): Promise<any> {
  try {
    console.log('Loading templates for recipient type:', recipientType);
    const templates = await storage.getAllPdfTemplates();
    console.log('Available templates:', templates.map(t => t.templateKey));
    
    const templateMap: { [key: string]: string } = {};
    
    templates.forEach(template => {
      const templatePrefix = recipientType.replace('-', '_');
      console.log(`Checking template ${template.templateKey} against prefix ${templatePrefix}`);
      if (template.templateKey.startsWith(templatePrefix)) {
        const section = template.templateKey.split('_').slice(2).join('_'); // Skip both parts of broker_architect
        templateMap[section] = template.content;
        console.log(`Found template content for ${section}:`, template.content.substring(0, 100));
      }
    });
    
    const result = {
      header: templateMap.header || 'REQUEST FOR PROPOSAL',
      subtitle: templateMap.subtitle || 'ARCHITECT SERVICES',
      introduction: templateMap.introduction || 'Bridge Industrial is seeking qualified professionals to provide services for the following project. Please review the project details and requirements below.',
      scopeOfWork: templateMap.scope_of_work || 'Please provide pricing and timeline for the following scope of work items.',
      submissionRequirements: templateMap.submission_requirements || 'Please include the following in your proposal submission.',
      evaluationCriteria: templateMap.evaluation_criteria || 'Proposals will be evaluated based on the following criteria.'
    };
    
    console.log('Final template content:', result);
    return result;
  } catch (error) {
    console.error('Error fetching template content:', error);
    // Return default content if templates not available
    return {
      header: 'REQUEST FOR PROPOSAL',
      subtitle: recipientType.includes('architect') ? 'ARCHITECT SERVICES' : 'CONTRACTOR SERVICES',
      introduction: 'Bridge Industrial is seeking qualified professionals to provide services for the following project. Please review the project details and requirements below.',
      scopeOfWork: 'Please provide pricing and timeline for the following scope of work items.',
      submissionRequirements: 'Please include the following in your proposal submission.',
      evaluationCriteria: 'Proposals will be evaluated based on the following criteria.'
    };
  }
}

function formatDate(date: string | Date): string {
  if (typeof date === 'string') {
    // If it's already a date string like "2025-07-28", parse it directly without timezone conversion
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = date.split('-').map(Number);
      const d = new Date(year, month - 1, day); // Create date in local timezone
      return d.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric'
      });
    } else {
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric'
      });
    }
  } else {
    // For Date objects from database (UTC format), simply format as string
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth(); // 0-11 (July = 6)
    const day = date.getUTCDate();
    
    // Extract UTC date components to avoid timezone conversion issues
    // When Date objects come from database in UTC format, we need to prevent
    // automatic timezone conversion that causes date display to shift backward
    
    // Create new date using UTC components in local timezone
    const localDate = new Date(year, month, day);
    return localDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    });
  }
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
  // Facility Details section removed per user request
  return '';
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
  // Helper function to safely evaluate formula or parse number
  const evaluateValue = (value: string | number): number => {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    
    const strValue = String(value).trim();
    if (strValue.startsWith('=')) {
      const result = evaluateFormula(strValue);
      return result.value || 0;
    }
    
    const numValue = parseFloat(strValue);
    return isNaN(numValue) ? 0 : numValue;
  };

  const formatCurrency = (value: string | number) => {
    const numValue = evaluateValue(value);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numValue);
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
                  <td class="unit-price-col">${formatCurrency(item.unitPrice)}</td>
                  <td class="total-price-col">${formatCurrency(item.totalPrice)}</td>
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
          width: 30%; 
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
        .notes-col {
          width: 50%;
          text-align: left;
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
  try {
    const html = await generateRfpHtml(options);
    
    // Ensure clean UTF-8 encoding
    const cleanHtml = html.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    
    // Return HTML for browser-based PDF generation
    return Buffer.from(cleanHtml, 'utf8');
  } catch (error) {
    console.error('PDF generation error:', error);
    // Return a simple fallback HTML
    const fallbackHtml = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>RFP Document</title></head>
      <body>
        <h1>RFP Document Generation Error</h1>
        <p>Please try again or contact support.</p>
      </body>
      </html>
    `;
    return Buffer.from(fallbackHtml, 'utf8');
  }
}

async function generateRfpHtml(options: PdfGenerationOptions): Promise<string> {
  const { rfp, invitationToBid, recipientType, recipientName, recipientCompany } = options;
  
  // Get current date in EST/EDT timezone to match user expectations
  const today = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'America/New_York'
  });
  const bidDeadline = invitationToBid?.bidSubmissionDeadline ? formatDate(invitationToBid.bidSubmissionDeadline) : formatDate(new Date());
  const projectStart = invitationToBid?.projectStartDate ? formatDate(invitationToBid.projectStartDate) : '';
  const projectEnd = invitationToBid?.projectEndDate ? formatDate(invitationToBid.projectEndDate) : '';
  
  // Calculate areas for display using area breakdown data
  const areaBreakdown = (rfp as any).areaBreakdown || [];
  const totalBreakdownArea = areaBreakdown.reduce((sum: number, item: any) => sum + (parseInt(item.squareFootage) || 0), 0);
  const totalArea = parseInt(rfp.warehouseArea?.replace(/,/g, '') || '0') || totalBreakdownArea;
  const warehouseArea = totalArea - totalBreakdownArea;
  
  // Legacy support for old office area fields
  const existingOffice = parseInt(rfp.officeAreaExisting?.replace(/,/g, '') || '0');
  const newOffice = parseInt(rfp.officeAreaNew?.replace(/,/g, '') || '0');
  
  // Get warehouse notes from RFP data
  const warehouseNotes = rfp.warehouseNotes || "";

  // Get template content for this recipient type
  const templateContent = await getTemplateContent(recipientType);

  // Generate different content based on recipient type
  if (recipientType === "contractor") {
    return await generateContractorRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes }, templateContent);
  } else if (recipientType === "broker-contractor") {
    return await generateBrokerContractorRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes }, templateContent);
  } else if (recipientType === "broker-architect") {
    return await generateBrokerArchitectRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes }, templateContent);
  } else if (recipientType === "financial-summary") {
    return generateFinancialSummaryHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes });
  } else {
    return await generateArchitectRfpHtml(options, { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes }, templateContent);
  }
}

async function generateContractorRfpHtml(options: PdfGenerationOptions, dates: any, templateContent: any): Promise<string> {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea } = dates;
  
  // Use Step 1 Project Name
  const projectName = rfp.projectName;
  
  // Use Project Address from RFP data
  const projectAddress = rfp.propertyAddress || invitationToBid?.projectLocation || rfp.property;
  
  // Use contact info from RFP development contact or invitation fallback
  const developmentContactInfo = rfp.developmentContact ? rfp.developmentContact.split(' - ') : [];
  const invitationContactInfo = invitationToBid?.contactForQuestions?.split(' - ') || [];
  
  // Prefer development contact from RFP, fallback to invitation contact
  const contactInfo = developmentContactInfo.length >= 2 ? developmentContactInfo : invitationContactInfo;
  const contactPerson = contactInfo[0] || 'Development Contact';
  const contactEmail = contactInfo[1] || 'AReutlinger@bridgeindustrial.com';
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
      
      ${rfp.requestTypes && rfp.requestTypes.length > 0 ? `
      <div class="section">
        <div class="section-title">REQUEST TYPES:</div>
        <div class="description-box">
          <p><strong>Please provide the following information in your proposal:</strong></p>
          <ul class="requirements-list">
            ${rfp.requestTypes.includes('pricing') ? '<li>✓ Pricing estimates and cost breakdown</li>' : ''}
            ${rfp.requestTypes.includes('schedule') ? '<li>✓ Project schedule and timeline</li>' : ''}
            ${rfp.requestTypes.includes('space-plan') ? '<li>✓ Space planning and design concepts</li>' : ''}
          </ul>
        </div>
      </div>
      ` : ''}
      
      ${dates.areaBreakdown && dates.areaBreakdown.length > 0 ? `
      <div class="section">
        <div class="section-title">AREA BREAKDOWN:</div>
        <table class="info-table">
          ${dates.areaBreakdown.map((area: any) => `
          <tr>
            <td class="label">${area.description}</td>
            <td>${parseInt(area.squareFootage || '0').toLocaleString()} SF${area.notes ? ` - ${area.notes}` : ''}</td>
          </tr>
          `).join('')}
          ${dates.totalArea > dates.areaBreakdown.reduce((sum: number, area: any) => sum + parseInt(area.squareFootage || '0'), 0) ? `
          <tr>
            <td class="label">Remaining Rentable Area</td>
            <td>${(dates.totalArea - dates.areaBreakdown.reduce((sum: number, area: any) => sum + parseInt(area.squareFootage || '0'), 0)).toLocaleString()} SF</td>
          </tr>
          ` : ''}
        </table>
      </div>
      ` : ''}
      
      ${invitationToBid?.scopeOfWork && invitationToBid.scopeOfWork.length > 0 ? `
      <div class="section">
        <div class="section-title">SCOPE OF WORK:</div>
        <div class="description-box">
          <p><strong>Please provide pricing and timeline for the following scope of work items:</strong></p>
          <table class="info-table" style="margin-top: 15px; table-layout: fixed; width: 100%;">
            <colgroup>
              <col style="width: 30%;">
              <col style="width: 12%;">
              <col style="width: 8%;">
              <col style="width: 50%;">
            </colgroup>
            <thead>
              <tr>
                <th style="text-align: left;">Description</th>
                <th style="text-align: center;">Quantity</th>
                <th style="text-align: center;">Unit</th>
                <th style="text-align: left;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${invitationToBid.scopeOfWork.map((item: any) => `
                <tr>
                  <td>${item.description || ''}</td>
                  <td style="text-align: center;">${item.quantity || ''}</td>
                  <td style="text-align: center;">${item.unit || ''}</td>
                  <td>${item.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}
      
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

async function generateArchitectRfpHtml(options: PdfGenerationOptions, dates: any, templateContent: any): Promise<string> {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea } = dates;
  
  const projectName = rfp.projectName || (rfp.confidential ? `Confidential @ ${rfp.propertyAddress || rfp.property}` : `${rfp.tenantName} @ ${rfp.propertyAddress || rfp.property}`);
  const projectLocation = rfp.propertyAddress || invitationToBid?.projectLocation || rfp.property;
  // Use contact info from RFP development contact or invitation fallback
  const developmentContactInfo = rfp.developmentContact ? rfp.developmentContact.split(' - ') : [];
  const invitationContactInfo = invitationToBid?.contactForQuestions?.split(' - ') || [];
  
  // Prefer development contact from RFP, fallback to invitation contact
  const contactInfo = developmentContactInfo.length >= 2 ? developmentContactInfo : invitationContactInfo;
  const contactPerson = contactInfo[0] || 'Development Contact';
  const contactEmail = contactInfo[1] || 'AReutlinger@bridgeindustrial.com';
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
      
      ${rfp.requestTypes && rfp.requestTypes.length > 0 ? `
      <div class="section">
        <div class="section-title">REQUEST TYPES:</div>
        <div class="description-box">
          <p><strong>Please provide the following information in your proposal:</strong></p>
          <ul class="requirements-list">
            ${rfp.requestTypes.includes('pricing') ? '<li>✓ Pricing estimates and cost breakdown</li>' : ''}
            ${rfp.requestTypes.includes('schedule') ? '<li>✓ Project schedule and timeline</li>' : ''}
            ${rfp.requestTypes.includes('space-plan') ? '<li>✓ Space planning and design concepts</li>' : ''}
          </ul>
        </div>
      </div>
      ` : ''}
      
      <div class="section">
        <div class="section-title">PROJECT SCOPE:</div>
        <div class="description-box">
          <p>We require architectural design services for ${totalArea.toLocaleString()} sf of total rentable area. The project scope includes:</p>
          ${dates.areaBreakdown && dates.areaBreakdown.length > 0 ? `
          <p><strong>Area Requirements:</strong></p>
          <ul class="requirements-list">
            ${dates.areaBreakdown.map((area: any) => `<li>${area.description}: ${parseInt(area.squareFootage || '0').toLocaleString()} SF${area.notes ? ` - ${area.notes}` : ''}</li>`).join('')}
            <li>Remaining Rentable Area: ${(dates.totalArea - dates.areaBreakdown.reduce((sum: number, area: any) => sum + parseInt(area.squareFootage || '0'), 0)).toLocaleString()} SF</li>
          </ul>
          <p><strong>Design Services Required:</strong></p>
          ` : ''}
          <ul class="requirements-list">
            <li>Schematic Design</li>
            <li>Design Development</li>
            <li>Construction Documents</li>
            <li>Permitting Assistance</li>
            <li>Construction Administration</li>
            ${invitationToBid?.technicalSpecifications ? `<li>Technical Specifications: ${invitationToBid.technicalSpecifications}</li>` : ''}
          </ul>
        </div>
      </div>
      
      ${invitationToBid?.scopeOfWork && invitationToBid.scopeOfWork.length > 0 ? `
      <div class="section">
        <div class="section-title">SCOPE OF WORK:</div>
        <div class="description-box">
          <p><strong>Please provide pricing and timeline for the following scope of work items:</strong></p>
          <table class="info-table" style="margin-top: 15px; table-layout: fixed; width: 100%;">
            <colgroup>
              <col style="width: 30%;">
              <col style="width: 12%;">
              <col style="width: 8%;">
              <col style="width: 50%;">
            </colgroup>
            <thead>
              <tr>
                <th style="text-align: left;">Description</th>
                <th style="text-align: center;">Quantity</th>
                <th style="text-align: center;">Unit</th>
                <th style="text-align: left;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${invitationToBid.scopeOfWork.map((item: any) => `
                <tr>
                  <td>${item.description || ''}</td>
                  <td style="text-align: center;">${item.quantity || ''}</td>
                  <td style="text-align: center;">${item.unit || ''}</td>
                  <td>${item.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}
      
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

async function generateBrokerArchitectRfpHtml(options: PdfGenerationOptions, dates: any, templateContent: any): Promise<string> {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes } = dates;


  


  // Use contact info from RFP development contact or invitation fallback
  const developmentContactInfo = rfp.developmentContact ? rfp.developmentContact.split(' - ') : [];
  const invitationContactInfo = invitationToBid?.contactForQuestions?.split(' - ') || [];
  
  // Prefer development contact from RFP, fallback to invitation contact
  const contactInfo = developmentContactInfo.length >= 2 ? developmentContactInfo : invitationContactInfo;
  const contactPerson = contactInfo[0] || 'Development Team';
  const contactEmail = contactInfo[1] || 'AReutlinger@bridgeindustrial.com';
  const contactPhone = contactInfo[2] || '';

  const projectName = rfp.projectName || invitationToBid?.projectScope || (rfp.confidential ? `Confidential @ ${rfp.property}` : `${rfp.tenantName} @ ${rfp.property}`);

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
        th:nth-child(1), td:nth-child(1) { width: 25%; }
        th:nth-child(2), td:nth-child(2) { width: 20%; }
        th:nth-child(3), td:nth-child(3) { width: 55%; }
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
        <div class="document-title">${templateContent.header}</div>
        <div class="project-title">${projectName}</div>
        <div style="font-size: 14px; color: #666;">RFP Number: ${rfp.rfpNumber}</div>
      </div>

      <div class="preliminary-notice">
        <strong>${templateContent.subtitle}</strong><br>
        ${templateContent.introduction}
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

        ${invitationToBid?.documentsLink ? `
        <div class="info-item" style="margin-top: 15px;">
          <span class="label">Project Documents:</span>
          <span class="value"><a href="${invitationToBid.documentsLink}" target="_blank">${invitationToBid.documentsLink}</a></span>
        </div>
        ` : ''}
      </div>

      ${totalArea > 0 || (areaBreakdown && areaBreakdown.length > 0) ? `
      <div class="section">
        <div class="section-title">Space Requirements</div>
        <table style="border-collapse: collapse; width: 100%; table-layout: fixed;">
          <colgroup>
            <col style="width: 30%;">
            <col style="width: 30%;">
            <col style="width: 40%;">
          </colgroup>
          <tr><th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left;">Space Type</th><th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left;">Area (sq ft)</th><th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left;">Notes</th></tr>
          ${warehouseArea > 0 ? `<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">Warehouse</td><td style="border: 1px solid #e5e7eb; padding: 8px;">${warehouseArea.toLocaleString()}</td><td style="border: 1px solid #e5e7eb; padding: 8px;">${warehouseNotes}</td></tr>` : ''}
          ${areaBreakdown && areaBreakdown.length > 0 ? areaBreakdown.map((item: any) => 
            `<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">${item.description || 'Area'}</td><td style="border: 1px solid #e5e7eb; padding: 8px;">${parseInt(item.squareFootage || '0').toLocaleString()}</td><td style="border: 1px solid #e5e7eb; padding: 8px;">${item.notes || ''}</td></tr>`
          ).join('') : ''}
          ${existingOffice > 0 && (!areaBreakdown || areaBreakdown.length === 0) ? `<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">Existing Office</td><td style="border: 1px solid #e5e7eb; padding: 8px;">${existingOffice.toLocaleString()}</td><td style="border: 1px solid #e5e7eb; padding: 8px;">Renovation level TBD</td></tr>` : ''}
          ${newOffice > 0 && (!areaBreakdown || areaBreakdown.length === 0) ? `<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">New Office Space</td><td style="border: 1px solid #e5e7eb; padding: 8px;">${newOffice.toLocaleString()}</td><td style="border: 1px solid #e5e7eb; padding: 8px;">New construction</td></tr>` : ''}
          ${totalArea > 0 ? `<tr><td style="border: 1px solid #e5e7eb; padding: 8px;"><strong>Total</strong></td><td style="border: 1px solid #e5e7eb; padding: 8px;"><strong>${totalArea.toLocaleString()}</strong></td><td style="border: 1px solid #e5e7eb; padding: 8px;"></td></tr>` : ''}
        </table>
      </div>
      ` : ''}

      ${invitationToBid?.scopeOfWork && invitationToBid.scopeOfWork.length > 0 ? `
      <div class="section">
        <div class="section-title">SCOPE OF WORK:</div>
        <div class="description-box">
          <p><strong>Please provide pricing and timeline for the following scope of work items:</strong></p>
          <table class="info-table" style="margin-top: 15px;">
            <thead>
              <tr>
                <th style="width: 30% !important;">Description</th>
                <th style="width: 12% !important; text-align: center;">Quantity</th>
                <th style="width: 8% !important; text-align: center;">Unit</th>
                <th style="width: 50% !important;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${invitationToBid.scopeOfWork.map((item: any) => `
                <tr>
                  <td>${item.description || ''}</td>
                  <td style="text-align: center;">${item.quantity || ''}</td>
                  <td style="text-align: center;">${item.unit || ''}</td>
                  <td>${item.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}

      ${rfp.requestTypes && rfp.requestTypes.length > 0 ? `
      <div class="section">
        <div class="section-title">Request Types</div>
        <div class="description-box">
          <p><strong>Please provide the following information in your proposal:</strong></p>
          <ul class="requirements-list">
            ${rfp.requestTypes.includes('pricing') ? '<li>✓ Pricing estimates and cost breakdown</li>' : ''}
            ${rfp.requestTypes.includes('schedule') ? '<li>✓ Project schedule and timeline</li>' : ''}
            ${rfp.requestTypes.includes('space-plan') ? '<li>✓ Space planning and design concepts</li>' : ''}
          </ul>
        </div>
      </div>
      ` : ''}

      <div class="section">
        <div class="section-title">Requested Deliverables</div>
        <ul>
          <li>Preliminary space plan</li>
          <li>Timeline estimate for design phases${hasMilestones(invitationToBid, 'broker-architect') ? ' based on milestone request(s) below' : ''}</li>
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

async function generateBrokerContractorRfpHtml(options: PdfGenerationOptions, dates: any, templateContent: any): Promise<string> {
  const { rfp, invitationToBid, recipientName, recipientCompany } = options;
  const { today, bidDeadline, projectStart, projectEnd, warehouseArea, existingOffice, newOffice, totalArea, areaBreakdown, warehouseNotes } = dates;

  // Use contact info from RFP development contact or invitation fallback
  const developmentContactInfo = rfp.developmentContact ? rfp.developmentContact.split(' - ') : [];
  const invitationContactInfo = invitationToBid?.contactForQuestions?.split(' - ') || [];
  
  // Prefer development contact from RFP, fallback to invitation contact
  const contactInfo = developmentContactInfo.length >= 2 ? developmentContactInfo : invitationContactInfo;
  const contactPerson = contactInfo[0] || 'Development Team';
  const contactEmail = contactInfo[1] || 'AReutlinger@bridgeindustrial.com';
  const contactPhone = contactInfo[2] || '';

  const projectName = rfp.projectName || invitationToBid?.projectScope || (rfp.confidential ? `Confidential @ ${rfp.property}` : `${rfp.tenantName} @ ${rfp.property}`);

  // Format bid deadline with E.O.B.
  const formattedDeadline = bidDeadline.replace(/(\d{4})$/, '$1 E.O.B.');

  // Generate scope of work HTML using template content instead of invitation data
  let scopeOfWorkHtml = '';
  if (templateContent.scopeOfWork) {
    // Convert template content to HTML format
    const scopeContent = templateContent.scopeOfWork.replace(/\n/g, '<br>');
    scopeOfWorkHtml = `<div class="section"><div class="section-title">Scope of Work</div><div>${scopeContent}</div></div>`;
  }

  // Generate space requirements table HTML safely using area breakdown data
  let spaceRequirementsHtml = '';
  if (totalArea > 0) {
    let spaceRows = '';
    
    // Add warehouse area if it exists
    if (warehouseArea > 0) {
      spaceRows += '<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">Warehouse</td><td style="border: 1px solid #e5e7eb; padding: 8px;">' + warehouseArea.toLocaleString() + '</td><td style="border: 1px solid #e5e7eb; padding: 8px;">' + warehouseNotes + '</td></tr>';
    }
    
    // Add dynamic area breakdown items with custom notes
    if (areaBreakdown && areaBreakdown.length > 0) {
      areaBreakdown.forEach((item: any) => {
        const description = item.description || 'Area';
        const squareFootage = parseInt(item.squareFootage || '0');
        const notes = item.notes || '';
        if (squareFootage > 0) {
          spaceRows += '<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">' + description + '</td><td style="border: 1px solid #e5e7eb; padding: 8px;">' + squareFootage.toLocaleString() + '</td><td style="border: 1px solid #e5e7eb; padding: 8px;">' + notes + '</td></tr>';
        }
      });
    } else {
      // Fallback to legacy office areas if no area breakdown exists
      if (existingOffice > 0) {
        spaceRows += '<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">Existing Office</td><td style="border: 1px solid #e5e7eb; padding: 8px;">' + existingOffice.toLocaleString() + '</td><td style="border: 1px solid #e5e7eb; padding: 8px;">Renovation level TBD</td></tr>';
      }
      if (newOffice > 0) {
        spaceRows += '<tr><td style="border: 1px solid #e5e7eb; padding: 8px;">New Office Space</td><td style="border: 1px solid #e5e7eb; padding: 8px;">' + newOffice.toLocaleString() + '</td><td style="border: 1px solid #e5e7eb; padding: 8px;">New construction</td></tr>';
      }
    }
    
    spaceRows += '<tr><td style="border: 1px solid #e5e7eb; padding: 8px;"><strong>Total</strong></td><td style="border: 1px solid #e5e7eb; padding: 8px;"><strong>' + totalArea.toLocaleString() + '</strong></td><td style="border: 1px solid #e5e7eb; padding: 8px;"></td></tr>';
    
    spaceRequirementsHtml = '<div class="section"><div class="section-title">Space Requirements</div><table style="border-collapse: collapse; width: 100%; table-layout: fixed;"><colgroup><col style="width: 30%;"><col style="width: 30%;"><col style="width: 40%;"></colgroup><tr><th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left;">Space Type</th><th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left;">Area (sq ft)</th><th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left;">Notes</th></tr>' + spaceRows + '</table></div>';
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
        th:nth-child(1), td:nth-child(1) { width: 25%; }
        th:nth-child(2), td:nth-child(2) { width: 20%; }
        th:nth-child(3), td:nth-child(3) { width: 55%; }
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
        <div class="project-title">${projectName}</div>
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

        ${invitationToBid?.documentsLink ? `
        <div class="info-item" style="margin-top: 15px;">
          <span class="label">Project Documents:</span>
          <span class="value"><a href="${invitationToBid.documentsLink}" target="_blank">${invitationToBid.documentsLink}</a></span>
        </div>
        ` : ''}
      </div>

      ${spaceRequirementsHtml}

      ${invitationToBid?.scopeOfWork && invitationToBid.scopeOfWork.length > 0 ? `
      <div class="section">
        <div class="section-title">SCOPE OF WORK:</div>
        <div class="description-box">
          <p><strong>Please provide pricing and timeline for the following scope of work items:</strong></p>
          <table class="info-table" style="margin-top: 15px; table-layout: fixed; width: 100%;">
            <colgroup>
              <col style="width: 30%;">
              <col style="width: 12%;">
              <col style="width: 8%;">
              <col style="width: 50%;">
            </colgroup>
            <thead>
              <tr>
                <th style="text-align: left;">Description</th>
                <th style="text-align: center;">Quantity</th>
                <th style="text-align: center;">Unit</th>
                <th style="text-align: left;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${invitationToBid.scopeOfWork.map((item: any) => `
                <tr>
                  <td>${item.description || ''}</td>
                  <td style="text-align: center;">${item.quantity || ''}</td>
                  <td style="text-align: center;">${item.unit || ''}</td>
                  <td>${item.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}

      ${rfp.requestTypes && rfp.requestTypes.length > 0 ? `
      <div class="section">
        <div class="section-title">Request Types</div>
        <div class="description-box">
          <p><strong>Please provide the following information in your proposal:</strong></p>
          <ul class="requirements-list">
            ${rfp.requestTypes.includes('pricing') ? '<li>✓ Pricing estimates and cost breakdown</li>' : ''}
            ${rfp.requestTypes.includes('schedule') ? '<li>✓ Project schedule and timeline</li>' : ''}
          </ul>
        </div>
      </div>
      ` : ''}

      <div class="section">
        <div class="section-title">Requested Deliverables</div>
        <ul>
          <li>Preliminary cost estimate</li>
          <li>Timeline estimate for construction phases${hasMilestones(invitationToBid, 'broker-contractor') ? ' based on milestone request(s) below' : ''}</li>
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
