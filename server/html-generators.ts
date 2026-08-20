/**
 * RFP Tracker - HTML Generators for PDF/Print Reports
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 */

// Generate RFP preview HTML with custom formatting
export function generateRfpPreviewHtml(documentType: string, formatSettings: any): string {
  const { tableColumns, fonts, colors, spacing } = formatSettings;
  const scopeColumns = tableColumns.scopeOfWork;
  const spaceColumns = tableColumns.spaceRequirements;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; font-size: ${fonts.bodySize}px; margin: ${spacing.sectionMargin}px; }
        .header { font-size: ${fonts.headerSize}px; font-weight: bold; text-align: ${formatSettings.layout.headerAlignment}; margin-bottom: ${spacing.sectionMargin}px; }
        .section-title { font-size: 16px; font-weight: bold; margin: ${spacing.sectionMargin}px 0 10px 0; }
        table { border-collapse: collapse; width: 100%; margin: ${spacing.tableMargin}px 0; table-layout: fixed; }
        th { background-color: ${colors.tableHeaderBackground}; border: 1px solid ${colors.tableBorderColor}; padding: ${spacing.cellPadding}px; font-size: ${fonts.tableHeaderSize}px; font-weight: bold; }
        td { border: 1px solid ${colors.tableBorderColor}; padding: ${spacing.cellPadding}px; font-size: ${fonts.tableBodySize}px; }
        .scope-table th:nth-child(1), .scope-table td:nth-child(1) { width: ${scopeColumns.description}%; }
        .scope-table th:nth-child(2), .scope-table td:nth-child(2) { width: ${scopeColumns.quantity}%; text-align: center; }
        .scope-table th:nth-child(3), .scope-table td:nth-child(3) { width: ${scopeColumns.unit}%; text-align: center; }
        .scope-table th:nth-child(4), .scope-table td:nth-child(4) { width: ${scopeColumns.notes}%; }
        .space-table th:nth-child(1), .space-table td:nth-child(1) { width: ${spaceColumns.spaceType}%; }
        .space-table th:nth-child(2), .space-table td:nth-child(2) { width: ${spaceColumns.area}%; }
        .space-table th:nth-child(3), .space-table td:nth-child(3) { width: ${spaceColumns.notes}%; }
      </style>
    </head>
    <body>
      <div class="header">REQUEST FOR PROPOSAL</div>
      <div class="header" style="font-size: 18px;">${documentType.toUpperCase().replace('-', ' ')} SERVICES</div>
      
      <div class="section-title">PROJECT OVERVIEW</div>
      <p>This is a preview of your RFP formatting. The settings you customize will be applied to all generated RFP documents.</p>
      
      <div class="section-title">SCOPE OF WORK</div>
      <table class="scope-table">
        <tr>
          <th>Description</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Notes</th>
        </tr>
        <tr>
          <td>Sample work item description</td>
          <td>1,000</td>
          <td>sf</td>
          <td>This is a sample note showing how the Notes column will display with your current width settings and formatting.</td>
        </tr>
        <tr>
          <td>Another scope item with longer description text</td>
          <td>25</td>
          <td>ea</td>
          <td>Sample notes for testing</td>
        </tr>
      </table>
      
      <div class="section-title">SPACE REQUIREMENTS</div>
      <table class="space-table">
        <tr>
          <th>Space Type</th>
          <th>Area (sq ft)</th>
          <th>Notes</th>
        </tr>
        <tr>
          <td>Office Space</td>
          <td>5,000</td>
          <td>Executive offices and conference rooms</td>
        </tr>
        <tr>
          <td>Warehouse</td>
          <td>25,000</td>
          <td>High-ceiling storage area with loading docks</td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// Generate HTML for bid collection PDF
export function generateBidCollectionHtml(bidCollection: any, rfp: any, lineItems: any[]) {
  const { evaluateFormula } = require('../shared/formula-utils');
  const totalAmount = lineItems.reduce((sum, item) => {
    if (!item.totalPrice) return sum;
    let value = item.totalPrice;
    // If it's a formula, evaluate it
    if (typeof value === 'string' && value.startsWith('=')) {
      try {
        const result = evaluateFormula(value);
        if (result.success) {
          value = result.value;
        } else {
          value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
        }
      } catch {
        value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
      }
    }
    return sum + (parseFloat(value) || 0);
  }, 0);
  
  const currentDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Bid Collection - ${bidCollection.contractorCompany}</title>
      <style>
        @page { size: A4; margin: 0.75in; }
        @media print { .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; line-height: 1.4; }
        .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
        .header h1 { font-size: 24px; margin: 0; color: #1f2937; }
        .header .subtitle { font-size: 14px; color: #6b7280; margin: 10px 0; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-item { margin-bottom: 8px; }
        .info-label { font-weight: 600; color: #374151; }
        .info-value { color: #6b7280; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; }
        th { background: #f9fafb; font-weight: 600; }
        .currency { text-align: right; }
        .total-row { background: #f3f4f6; font-weight: 600; }
        .attachments { margin-top: 20px; }
        .attachment-item { padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; margin: 5px 0; }
      </style>
    </head>
    <body>
      <div class="no-print">
        <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
        <br><small>This banner will not appear in the printed version.</small>
      </div>
      
      <div class="header">
        <h1>Bid Collection</h1>
        <div class="subtitle">RFP ${rfp.rfpNumber} - ${rfp.projectName}</div>
        <div class="subtitle">Generated on ${currentDate}</div>
      </div>

      <div class="section">
        <div class="section-title">Project Information</div>
        <div class="info-grid">
          <div>
            <div class="info-item">
              <span class="info-label">RFP Number:</span> ${rfp.rfpNumber}
            </div>
            <div class="info-item">
              <span class="info-label">Project Name:</span> ${rfp.projectName}
            </div>
            <div class="info-item">
              <span class="info-label">Tenant:</span> ${rfp.tenantName}
            </div>
          </div>
          <div>
            <div class="info-item">
              <span class="info-label">Company:</span> ${bidCollection.contractorCompany}
            </div>
            <div class="info-item">
              <span class="info-label">Submission Date:</span> ${(() => {
                if (!bidCollection.submissionDate) return 'N/A';
                try {
                  // Log the date value for debugging
                  console.log('PDF Date Debug - Original value:', bidCollection.submissionDate, 'Type:', typeof bidCollection.submissionDate);
                  
                  const dateValue = bidCollection.submissionDate;
                  let date;
                  
                  if (typeof dateValue === 'string') {
                    // If it's already in YYYY-MM-DD format, parse directly
                    if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                      date = new Date(dateValue + 'T00:00:00');
                    } else {
                      date = new Date(dateValue);
                    }
                  } else if (dateValue instanceof Date) {
                    date = dateValue;
                  } else {
                    date = new Date(dateValue);
                  }
                  
                  console.log('PDF Date Debug - Parsed date:', date, 'Valid:', !isNaN(date.getTime()));
                  
                  // Check if date is valid
                  if (isNaN(date.getTime())) {
                    return 'Invalid Date';
                  }
                  
                  return date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
                } catch (error) {
                  console.error('Date parsing error:', error, 'Original value:', bidCollection.submissionDate);
                  return 'Invalid Date';
                }
              })()}
            </div>
            <div class="info-item">
              <span class="info-label">Total Amount:</span> $${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Bid Line Items</div>
        <table>
          <thead>
            <tr>
              <th style="width: 40%;">Description</th>
              <th style="width: 15%;">Quantity</th>
              <th style="width: 10%;">Unit</th>
              <th style="width: 15%;">Unit Price</th>
              <th style="width: 20%;">Total Price</th>
            </tr>
          </thead>
          <tbody>
            ${lineItems.map(item => `
              <tr>
                <td>${item.description || ''}</td>
                <td class="currency">${item.quantity ? parseFloat(item.quantity).toLocaleString('en-US') : ''}</td>
                <td>${item.unit || ''}</td>
                <td class="currency">${(() => {
                  if (!item.unitPrice) return '';
                  let value = item.unitPrice;
                  // If it's a formula, evaluate it
                  if (typeof value === 'string' && value.startsWith('=')) {
                    try {
                      const result = evaluateFormula(value);
                      if (result.value !== null && !result.error) {
                        value = result.value;
                      } else {
                        value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                      }
                    } catch {
                      value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                    }
                  }
                  const numValue = parseFloat(value);
                  return isNaN(numValue) ? '' : '$' + numValue.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 });
                })()}</td>
                <td class="currency">${(() => {
                  if (!item.totalPrice) return '';
                  let value = item.totalPrice;
                  // If it's a formula, evaluate it
                  if (typeof value === 'string' && value.startsWith('=')) {
                    try {
                      const result = evaluateFormula(value);
                      if (result.value !== null && !result.error) {
                        value = result.value;
                      } else {
                        value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                      }
                    } catch {
                      value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                    }
                  }
                  const numValue = parseFloat(value);
                  return isNaN(numValue) ? '' : '$' + numValue.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 });
                })()}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td colspan="4" style="text-align: right;"><strong>Total Bid Amount:</strong></td>
              <td class="currency"><strong>$${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      ${bidCollection.notes ? `
        <div class="section">
          <div class="section-title">Notes</div>
          <div style="background: #f9fafb; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb;">
            ${bidCollection.notes.replace(/\n/g, '<br>')}
          </div>
        </div>
      ` : ''}

      ${bidCollection.attachments && bidCollection.attachments.length > 0 ? `
        <div class="section">
          <div class="section-title">Attachments</div>
          <div class="attachments">
            ${bidCollection.attachments.map((file: any) => `
              <div class="attachment-item">
                <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

    </body>
    </html>
  `;
}

// Generate HTML for all bid collections PDF
export function generateAllBidCollectionsHtml(rfp: any, allBidsData: any[]) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Categorize bids by contractor vs architect type
  const contractorBids = allBidsData.filter(({ contact }) => contact?.type === 'contractor');
  const architectBids = allBidsData.filter(({ contact }) => contact?.type === 'architect');

  // Calculate bid comparison data for contractors
  const contractorSummary = contractorBids.map(({ bid, lineItems }) => {
    const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
    return {
      company: bid.contractorCompany,
      totalAmount,
      status: bid.status,
      submissionDate: bid.submissionDate,
      lineItemCount: lineItems.length,
      type: 'contractor'
    };
  }).sort((a, b) => a.totalAmount - b.totalAmount);

  // Calculate bid comparison data for architects
  const architectSummary = architectBids.map(({ bid, lineItems }) => {
    const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
    return {
      company: bid.contractorCompany,
      totalAmount,
      status: bid.status,
      submissionDate: bid.submissionDate,
      lineItemCount: lineItems.length,
      type: 'architect'
    };
  }).sort((a, b) => a.totalAmount - b.totalAmount);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>All Bid Collections - ${rfp.rfpNumber}</title>
      <style>
        @page { size: A4; margin: 0.75in; }
        @media print { .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; line-height: 1.4; }
        .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
        .header h1 { font-size: 24px; margin: 0; color: #1f2937; }
        .header .subtitle { font-size: 14px; color: #6b7280; margin: 10px 0; }
        .section { margin-bottom: 30px; }
        .section-title { font-size: 18px; font-weight: 600; color: #1f2937; margin-bottom: 15px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
        .subsection-title { font-size: 16px; font-weight: 600; color: #1f2937; margin: 20px 0 10px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-item { margin-bottom: 8px; }
        .info-label { font-weight: 600; color: #374151; }
        .info-value { color: #6b7280; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
        th { background: #f9fafb; font-weight: 600; font-size: 11px; }
        td { font-size: 11px; }
        .currency { text-align: right; }
        .total-row { background: #f3f4f6; font-weight: 600; }
        .bid-section { margin-bottom: 40px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; }
        .bid-header { background: #f9fafb; margin: -20px -20px 20px -20px; padding: 15px 20px; border-radius: 8px 8px 0 0; }
        .summary-table th { background: #1f2937; color: white; }
        .rank-1 { background: #dcfce7; }
        .rank-2 { background: #fef3c7; }
        .rank-3 { background: #fecaca; }
      </style>
    </head>
    <body>
      <div class="no-print">
        <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
        <br><small>This banner will not appear in the printed version.</small>
      </div>
      
      <div class="header">
        <h1>Bid Collection Summary</h1>
        <div class="subtitle">RFP ${rfp.rfpNumber} - ${rfp.projectName}</div>
        <div class="subtitle">Generated on ${currentDate} • ${contractorBids.length} contractor bids • ${architectBids.length} architect bids</div>
      </div>

      <div class="section">
        <div class="section-title">Project Information</div>
        <div class="info-grid">
          <div>
            <div class="info-item">
              <span class="info-label">RFP Number:</span> ${rfp.rfpNumber}
            </div>
            <div class="info-item">
              <span class="info-label">Project Name:</span> ${rfp.projectName}
            </div>
            <div class="info-item">
              <span class="info-label">Tenant:</span> ${rfp.tenantName}
            </div>
          </div>
          <div>
            <div class="info-item">
              <span class="info-label">Contractor Bids:</span> ${contractorBids.length}
            </div>
            <div class="info-item">
              <span class="info-label">Architect Bids:</span> ${architectBids.length}
            </div>
            ${contractorSummary.length > 0 ? `
            <div class="info-item">
              <span class="info-label">Lowest Contractor Bid:</span> $${contractorSummary[0]?.totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2 }) || 'N/A'}
            </div>
            ` : ''}
            ${architectSummary.length > 0 ? `
            <div class="info-item">
              <span class="info-label">Lowest Architect Bid:</span> $${architectSummary[0]?.totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2 }) || 'N/A'}
            </div>
            ` : ''}
          </div>
        </div>
      </div>

      ${contractorSummary.length > 0 ? `
      <div class="section">
        <div class="section-title">Contractor Bid Comparison</div>
        <table class="summary-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Company</th>
              <th>Total Amount</th>
              <th>Submission Date</th>
              <th>Line Items</th>
            </tr>
          </thead>
          <tbody>
            ${contractorSummary.map((bid, index) => `
              <tr class="${index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : ''}">
                <td style="text-align: center; font-weight: 600;">${index + 1}</td>
                <td><strong>${bid.company}</strong></td>
                <td class="currency"><strong>$${bid.totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2 })}</strong></td>
                <td>${(() => {
                  if (!bid.submissionDate) return 'N/A';
                  try {
                    let date;
                    if (typeof bid.submissionDate === 'string') {
                      if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        date = new Date(bid.submissionDate + 'T00:00:00');
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                    } else {
                      date = new Date(bid.submissionDate);
                    }
                    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                  } catch (error) {
                    return 'Invalid Date';
                  }
                })()}</td>
                <td style="text-align: center;">${bid.lineItemCount}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      ${architectSummary.length > 0 ? `
      <div class="section">
        <div class="section-title">Architect Bid Comparison</div>
        <table class="summary-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Company</th>
              <th>Total Amount</th>
              <th>Submission Date</th>
              <th>Line Items</th>
            </tr>
          </thead>
          <tbody>
            ${architectSummary.map((bid, index) => `
              <tr class="${index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : ''}">
                <td style="text-align: center; font-weight: 600;">${index + 1}</td>
                <td><strong>${bid.company}</strong></td>
                <td class="currency"><strong>$${bid.totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2 })}</strong></td>
                <td>${(() => {
                  if (!bid.submissionDate) return 'N/A';
                  try {
                    let date;
                    if (typeof bid.submissionDate === 'string') {
                      if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        date = new Date(bid.submissionDate + 'T00:00:00');
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                    } else {
                      date = new Date(bid.submissionDate);
                    }
                    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                  } catch (error) {
                    return 'Invalid Date';
                  }
                })()}</td>
                <td style="text-align: center;">${bid.lineItemCount}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      ${contractorBids.length > 0 ? `<div class="section-title">Contractor Bid Details</div>` : ''}
      ${contractorBids.map(({ bid, lineItems, contact }, index) => {
        const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
        const rank = contractorSummary.findIndex(b => b.company === bid.contractorCompany) + 1;
        
        return `
          <div class="bid-section">
            <div class="bid-header">
              <h3 style="margin: 0; color: #1f2937;">Contractor Bid #${index + 1} - ${bid.contractorCompany} (Rank #${rank})</h3>
              <div style="color: #6b7280; font-size: 12px; margin-top: 5px;">Total: $${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2 })}</div>
            </div>

            <div class="subsection-title">Company Information</div>
            <div class="info-grid">
              <div>
                <div class="info-item">
                  <span class="info-label">Company:</span> ${bid.contractorCompany}
                </div>
                <div class="info-item">
                  <span class="info-label">Submission Date:</span> ${(() => {
                    if (!bid.submissionDate) return 'N/A';
                    try {
                      let date;
                      if (typeof bid.submissionDate === 'string') {
                        if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          date = new Date(bid.submissionDate + 'T00:00:00');
                        } else {
                          date = new Date(bid.submissionDate);
                        }
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                      return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                    } catch (error) {
                      return 'Invalid Date';
                    }
                  })()}
                </div>
              </div>
              <div>
                <div class="info-item">
                  <span class="info-label">Total Amount:</span> $${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div class="subsection-title">Line Items Breakdown</div>
            <table>
              <thead>
                <tr>
                  <th style="width: 40%;">Description</th>
                  <th style="width: 15%;">Quantity</th>
                  <th style="width: 10%;">Unit</th>
                  <th style="width: 15%;">Unit Price</th>
                  <th style="width: 20%;">Total Price</th>
                </tr>
              </thead>
              <tbody>
                ${lineItems.map((item: any) => `
                  <tr>
                    <td>${item.description || ''}</td>
                    <td class="currency">${item.quantity ? parseFloat(item.quantity).toLocaleString('en-US') : ''}</td>
                    <td>${item.unit || ''}</td>
                    <td class="currency">${item.unitPrice ? '$' + parseFloat(item.unitPrice).toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                    <td class="currency">${item.totalPrice ? '$' + parseFloat(item.totalPrice).toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                  </tr>
                `).join('')}
                <tr class="total-row">
                  <td colspan="4" style="text-align: right;"><strong>Bid Total:</strong></td>
                  <td class="currency"><strong>$${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
              </tbody>
            </table>

            ${bid.notes ? `
              <div class="subsection-title">Notes</div>
              <div style="background: #f9fafb; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb; margin-bottom: 15px;">
                ${bid.notes.replace(/\n/g, '<br>')}
              </div>
            ` : ''}

            ${bid.attachments && bid.attachments.length > 0 ? `
              <div class="subsection-title">Attachments</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px;">
                ${bid.attachments.map((file: any) => `
                  <div style="padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;">
                    <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}

      ${architectBids.length > 0 ? `<div class="section-title">Architect Bid Details</div>` : ''}
      ${architectBids.map(({ bid, lineItems, contact }, index) => {
        const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
        const rank = architectSummary.findIndex(b => b.company === bid.contractorCompany) + 1;
        
        return `
          <div class="bid-section">
            <div class="bid-header">
              <h3 style="margin: 0; color: #1f2937;">Architect Bid #${index + 1} - ${bid.contractorCompany} (Rank #${rank})</h3>
              <div style="color: #6b7280; font-size: 12px; margin-top: 5px;">Total: $${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2 })}</div>
            </div>

            <div class="subsection-title">Company Information</div>
            <div class="info-grid">
              <div>
                <div class="info-item">
                  <span class="info-label">Company:</span> ${bid.contractorCompany}
                </div>
                <div class="info-item">
                  <span class="info-label">Submission Date:</span> ${(() => {
                    if (!bid.submissionDate) return 'N/A';
                    try {
                      let date;
                      if (typeof bid.submissionDate === 'string') {
                        if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          date = new Date(bid.submissionDate + 'T00:00:00');
                        } else {
                          date = new Date(bid.submissionDate);
                        }
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                      return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                    } catch (error) {
                      return 'Invalid Date';
                    }
                  })()}
                </div>
              </div>
              <div>
                <div class="info-item">
                  <span class="info-label">Total Amount:</span> $${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div class="subsection-title">Pricing Breakdown</div>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                  <th>Unit Price</th>
                  <th>Total Price</th>
                </tr>
              </thead>
              <tbody>
                ${lineItems.map((item: any) => `
                  <tr>
                    <td>${item.description}</td>
                    <td style="text-align: center;">${item.quantity || ''}</td>
                    <td>${item.unit || ''}</td>
                    <td class="currency">${item.unitPrice ? '$' + parseFloat(item.unitPrice).toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                    <td class="currency">${item.totalPrice ? '$' + parseFloat(item.totalPrice).toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                  </tr>
                `).join('')}
                <tr class="total-row">
                  <td colspan="4" style="text-align: right;"><strong>Bid Total:</strong></td>
                  <td class="currency"><strong>$${totalAmount.toLocaleString('en-US', { timeZone: 'America/New_York', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
              </tbody>
            </table>

            ${bid.notes ? `
              <div class="subsection-title">Notes</div>
              <div style="background: #f9fafb; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb; margin-bottom: 15px;">
                ${bid.notes.replace(/\n/g, '<br>')}
              </div>
            ` : ''}

            ${bid.attachments && bid.attachments.length > 0 ? `
              <div class="subsection-title">Attachments</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px;">
                ${bid.attachments.map((file: any) => `
                  <div style="padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;">
                    <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}

    </body>
    </html>
  `;
}
