#!/usr/bin/env tsx
/**
 * TypeScript command-line interface for Vendor Workload Report generation
 * 
 * This provides the same functionality as the Python script but leverages
 * the existing TypeScript infrastructure directly.
 */

import { generateVendorWorkloadData, generateVendorWorkloadPdf, generateVendorWorkloadFilename } from '../server/vendor-workload-report';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

interface CliOptions {
  startDate?: string;
  endDate?: string;
  vendors?: string;
  output?: string;
  help?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--start-date':
        options.startDate = args[++i];
        break;
      case '--end-date':
        options.endDate = args[++i];
        break;
      case '--vendors':
        options.vendors = args[++i];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
Vendor Workload Report Generator

Usage: npm run vendor-report [options]
   or: tsx tools/vendor-workload-cli.ts [options]

Options:
  --start-date YYYY-MM-DD     Filter RFPs from this date onwards
  --end-date YYYY-MM-DD       Filter RFPs up to this date  
  --vendors "Vendor1,Vendor2" Filter to specific vendors (comma-separated)
  --output PATH               Output directory (default: ./reports/)
  --help, -h                  Show this help message

Examples:
  npm run vendor-report
  npm run vendor-report -- --start-date 2025-01-01 --end-date 2025-03-31
  npm run vendor-report -- --vendors "Gensler,ABC Construction"
  npm run vendor-report -- --output ./custom-reports/

Environment:
  DATABASE_URL   Database connection (auto-configured in Replit)
  
The report analyzes all Architect and General Contractor RFPs, grouping them
by vendor and providing workload summaries with project details.
`);
}

function validateDate(dateString: string): Date {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateString}. Use YYYY-MM-DD`);
  }
  return date;
}

async function main() {
  try {
    const options = parseArgs();
    
    if (options.help) {
      showHelp();
      return;
    }
    
    // Parse and validate options
    const reportOptions: any = {};
    
    if (options.startDate) {
      reportOptions.startDate = validateDate(options.startDate);
    }
    
    if (options.endDate) {
      reportOptions.endDate = validateDate(options.endDate);
    }
    
    if (options.vendors) {
      reportOptions.vendors = options.vendors.split(',').map(v => v.trim());
    }
    
    // Validate date range
    if (reportOptions.startDate && reportOptions.endDate) {
      if (reportOptions.startDate > reportOptions.endDate) {
        console.error('Error: Start date cannot be after end date');
        process.exit(1);
      }
    }
    
    const outputDir = options.output || './reports';
    
    console.log('🔍 Generating vendor workload data...');
    console.log('📊 Options:', {
      startDate: options.startDate || 'all dates',
      endDate: options.endDate || 'all dates', 
      vendors: options.vendors || 'all vendors',
      output: outputDir
    });
    
    // Generate the report data
    const data = await generateVendorWorkloadData(reportOptions);
    
    console.log(`✅ Found ${data.totalRfps} RFPs across ${data.totalVendors} vendors`);
    
    if (data.totalRfps === 0) {
      console.log('⚠️  No matching RFPs found.');
      console.log('   Please check your criteria and ensure RFPs have vendor information.');
      console.log('   (RFPs need either "architect" or "generalContractor" fields populated)');
      return;
    }
    
    console.log('📄 Generating PDF report...');
    
    // Generate PDF
    const pdfBuffer = await generateVendorWorkloadPdf(data);
    
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });
    
    // Generate filename and save
    const filename = generateVendorWorkloadFilename(reportOptions);
    const outputPath = join(outputDir, filename);
    
    await writeFile(outputPath, pdfBuffer);
    
    console.log('\n🎉 Vendor workload report generated successfully!');
    console.log(`📁 Output: ${outputPath}`);
    console.log('\n📈 Report Summary:');
    console.log(`   • Total RFPs: ${data.totalRfps}`);
    console.log(`   • Unique Vendors: ${data.totalVendors}`);
    console.log(`   • Average RFPs per Vendor: ${(data.totalRfps / data.totalVendors).toFixed(1)}`);
    
    if (data.dateFilter) {
      console.log(`   • Date Range: ${data.dateFilter.startDate || 'All'} to ${data.dateFilter.endDate || 'All'}`);
    }
    
    console.log('\n📋 Top Vendors by RFP Count:');
    const topVendors = data.vendors
      .sort((a, b) => b.totalProjects - a.totalProjects)
      .slice(0, 5);
      
    topVendors.forEach((vendor, index) => {
      console.log(`   ${index + 1}. ${vendor.vendor} (${vendor.totalProjects} RFPs)`);
    });
    
  } catch (error) {
    console.error('❌ Error generating vendor workload report:', error.message);
    if (error.stack && process.env.NODE_ENV === 'development') {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Report generation cancelled by user');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

// Check if this module is being executed directly
const isDirectCall = import.meta.url === `file://${process.argv[1]}`;
if (isDirectCall) {
  main();
}