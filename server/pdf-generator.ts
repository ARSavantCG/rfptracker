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
          ${keyDates.map((keyDate: any) => `
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
                invitationToBid.prequalificationCriteria.map((req: any) => `<li>${req}</li>`).join('') :
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
                invitationToBid.prequalificationCriteria.map((req: any) => `<li>${req}</li>`).join('') :
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
              invitationToBid.evaluationCriteria.map((criteria: any) => `<li>${criteria}</li>`).join('') :
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
        .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
        .company-logo { position: absolute; left: 0; top: 0; height: 40px; }
        .company-info { text-align: right; margin-bottom: 20px; }
        .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; }
        .project-title { font-size: 18px; color: #666; margin-bottom: 20px; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
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
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <!-- Company logo placeholder -->
          <div style="background: rgb(0,50,130); color: white; padding: 5px 10px; font-weight: bold; font-size: 12px; border-radius: 3px;">
            BRIDGE INDUSTRIAL
          </div>
        </div>
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
        .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; }
        .company-info { text-align: right; margin-bottom: 20px; }
        .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; }
        .project-title { font-size: 18px; color: #666; margin-bottom: 20px; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-item { margin-bottom: 10px; }
        .label { font-weight: bold; color: #666; }
        .value { margin-left: 10px; }
        .requirements { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; }
        .preliminary-notice { background-color: #dbeafe; padding: 15px; border-left: 4px solid rgb(0,50,130); margin: 20px 0; font-weight: bold; }
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
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <img src="data:image/png;base64,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" style="height: 30px; width: auto; opacity: 0.8;">
          <div style="background: rgb(0,50,130); color: white; padding: 5px 10px; font-weight: bold; font-size: 12px; border-radius: 3px;">
            REQUEST FOR PROPOSAL
          </div>
        </div>
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
