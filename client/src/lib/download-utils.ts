/**
 * Utility functions for consistent download file naming
 */

export function generateProjectBasedFilename(projectName: string, suffix: string, extension: string = 'zip'): string {
  const cacheBuster = Date.now();
  const safeFileName = projectName
    .replace(/[@]/g, '_at_')
    .replace(/[^\w\s\-\.]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  
  return `${safeFileName}_${suffix}_${cacheBuster}.${extension}`;
}

export function generateFinancialSummaryFilename(projectName: string): string {
  return generateProjectBasedFilename(projectName, 'Financial_Summary', 'html');
}

export function generateAllFilesZipFilename(projectName: string): string {
  return generateProjectBasedFilename(projectName, 'All_Files', 'zip');
}

export function generatePdfFilename(projectName: string, reportType: string): string {
  return generateProjectBasedFilename(projectName, reportType, 'pdf');
}