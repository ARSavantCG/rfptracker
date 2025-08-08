#!/usr/bin/env python3
"""
Vendor Workload Report Generator

This script generates a comprehensive PDF report analyzing vendor workloads
for Architect and General Contractor RFPs in the RFP tracker system.

Usage:
    python tools/vendor_workload_report.py [options]

Options:
    --start-date YYYY-MM-DD     Filter RFPs from this date onwards
    --end-date YYYY-MM-DD       Filter RFPs up to this date
    --vendors "Vendor1,Vendor2" Filter to specific vendors (comma-separated)
    --output PATH               Output directory (default: ./reports/)

Environment Variables:
    DATABASE_URL     Database connection string (auto-detected from Replit)
    RFP_TABLE       Table name for RFPs (default: rfp_requests)
    COLMAP          JSON mapping for flexible column names (optional)

Examples:
    python tools/vendor_workload_report.py
    python tools/vendor_workload_report.py --start-date 2025-01-01 --end-date 2025-03-31
    python tools/vendor_workload_report.py --vendors "Gensler,ABC Construction"
"""

import os
import sys
import json
import argparse
import subprocess
from datetime import datetime
from pathlib import Path

def run_node_script(args_dict):
    """
    Runs the Node.js vendor workload report generator with the provided arguments.
    This leverages the existing TypeScript infrastructure for database access and PDF generation.
    """
    
    # Build the Node.js command
    node_script = """
const { generateVendorWorkloadData, generateVendorWorkloadPdf, generateVendorWorkloadFilename } = require('./server/vendor-workload-report.ts');
const fs = require('fs').promises;
const path = require('path');

async function main() {
    try {
        const args = JSON.parse(process.argv[2]);
        
        // Parse date arguments
        const options = {};
        if (args.startDate) options.startDate = new Date(args.startDate);
        if (args.endDate) options.endDate = new Date(args.endDate);
        if (args.vendors) options.vendors = args.vendors.split(',').map(v => v.trim());
        
        console.log('Generating vendor workload data...');
        const data = await generateVendorWorkloadData(options);
        
        console.log(`Found ${data.totalRfps} RFPs across ${data.totalVendors} vendors`);
        
        if (data.totalRfps === 0) {
            console.log('No matching RFPs found. Please check your criteria and ensure RFPs have vendor information.');
            return;
        }
        
        console.log('Generating PDF report...');
        const pdfBuffer = await generateVendorWorkloadPdf(data);
        
        // Ensure output directory exists
        const outputDir = args.output || './reports';
        await fs.mkdir(outputDir, { recursive: true });
        
        // Generate filename
        const filename = generateVendorWorkloadFilename(options);
        const outputPath = path.join(outputDir, filename);
        
        // Write PDF file
        await fs.writeFile(outputPath, pdfBuffer);
        
        console.log(`\\nVendor workload report generated successfully!`);
        console.log(`Output: ${outputPath}`);
        console.log(`\\nReport Summary:`);
        console.log(`- Total RFPs: ${data.totalRfps}`);
        console.log(`- Unique Vendors: ${data.totalVendors}`);
        console.log(`- Average RFPs per Vendor: ${(data.totalRfps / data.totalVendors).toFixed(1)}`);
        
        if (data.dateFilter) {
            console.log(`- Date Range: ${data.dateFilter.startDate || 'All'} to ${data.dateFilter.endDate || 'All'}`);
        }
        
    } catch (error) {
        console.error('Error generating vendor workload report:', error.message);
        process.exit(1);
    }
}

main();
"""
    
    # Prepare arguments for Node.js script
    args_json = json.dumps(args_dict)
    
    try:
        # Change to the project root directory
        project_root = Path(__file__).parent.parent
        os.chdir(project_root)
        
        print("Generating vendor workload report...")
        print(f"Arguments: {args_dict}")
        
        # Run the Node.js script
        result = subprocess.run([
            'node', '-e', node_script, args_json
        ], capture_output=True, text=True, check=True)
        
        print(result.stdout)
        
        if result.stderr:
            print("Warnings:", result.stderr, file=sys.stderr)
            
    except subprocess.CalledProcessError as e:
        print(f"Error running report generator: {e}", file=sys.stderr)
        print(f"stdout: {e.stdout}", file=sys.stderr)
        print(f"stderr: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)

def validate_date(date_string):
    """Validate and parse date string in YYYY-MM-DD format."""
    try:
        return datetime.strptime(date_string, '%Y-%m-%d').strftime('%Y-%m-%d')
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid date format: {date_string}. Use YYYY-MM-DD")

def main():
    parser = argparse.ArgumentParser(
        description='Generate vendor workload report for RFP tracker',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    parser.add_argument(
        '--start-date',
        type=validate_date,
        help='Filter RFPs from this date onwards (YYYY-MM-DD)'
    )
    
    parser.add_argument(
        '--end-date',
        type=validate_date,
        help='Filter RFPs up to this date (YYYY-MM-DD)'
    )
    
    parser.add_argument(
        '--vendors',
        type=str,
        help='Filter to specific vendors (comma-separated list)'
    )
    
    parser.add_argument(
        '--output',
        type=str,
        default='./reports',
        help='Output directory for PDF report (default: ./reports/)'
    )
    
    args = parser.parse_args()
    
    # Validate date range
    if args.start_date and args.end_date:
        start = datetime.strptime(args.start_date, '%Y-%m-%d')
        end = datetime.strptime(args.end_date, '%Y-%m-%d')
        if start > end:
            print("Error: Start date cannot be after end date", file=sys.stderr)
            sys.exit(1)
    
    # Convert arguments to dictionary for Node.js script
    args_dict = {
        'startDate': args.start_date,
        'endDate': args.end_date,
        'vendors': args.vendors,
        'output': args.output
    }
    
    # Remove None values
    args_dict = {k: v for k, v in args_dict.items() if v is not None}
    
    # Check environment
    if not os.getenv('DATABASE_URL'):
        print("Warning: DATABASE_URL environment variable not set. Using default database connection.", file=sys.stderr)
    
    # Run the report generator
    run_node_script(args_dict)

if __name__ == '__main__':
    main()