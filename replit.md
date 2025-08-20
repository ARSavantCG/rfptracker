# RFP Tracker - Request for Proposals Management System

## Overview
This full-stack web application manages the complete lifecycle of Request for Proposals (RFPs) for leasing teams. It streamlines processes from RFP entry and bid collection to evaluation and award, incorporating features like file uploads, status tracking, search, PDF generation, and workflow management. The system enhances efficiency and transparency in procurement, particularly for commercial real estate, and ensures legal compliance regarding leasable area totals. The project aims to improve business operations and provide a competitive edge in procurement.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Framework & Libraries**: React 18 with TypeScript, Wouter for routing, TanStack Query for state, Radix UI and shadcn/ui for components, Tailwind CSS for styling.
- **Build Tool**: Vite.
- **Form Management**: React Hook Form with Zod validation.
- **Design Principles**: Consistent color scheme (green, blue, grey, cyan/teal), compact card layouts, clear visual hierarchy, emphasis on data readability, and interactive elements.
- **Visuals**: Professional SVG-based compass rose for bay configurations.

### Technical Implementations
- **Workflow**: A 6-phase system: RFP Entry → RFP Validation → Invitation to Bid → Bid Collection → Evaluation → Publish.
- **Core Management**: RFP lifecycle management (status, files, validation), contact categorization, property management (bay configuration, rentable area, parking, executed leases).
- **Document Generation**: Custom HTML to PDF conversion for various reports (executive summaries, financial, historical pricing, invitation to bid).
- **Bid & Evaluation**: Structured bid data entry, line item reordering, Excel/CSV import/export, bid attachments, assembly system, tenant share calculations, change tracking.
- **Authentication & Authorization**: PostgreSQL-backed sessions, token-based fallback, role-based access control.
- **File Management**: Local filesystem storage with database metadata.
- **Backend & Database**: Express.js with TypeScript, Drizzle ORM with PostgreSQL.
- **Deployment**: Node.js 20.
- **Advanced Systems**:
    - **RFP Numbering**: Versioned numbering for counter offers (e.g., RFP-2025-001.01).
    - **Rentable Area Override**: Manual override capability for calculated rentable areas.
    - **Document Editor**: Admin interface for customizing standard document content with real-time preview.
    - **Legal Compliance**: Automated system ensuring exact leasable area totals with startup enforcement and monitoring.
    - **Timezone Management**: System-wide centralized date handling utilities.
    - **Formula System**: Excel-like formula evaluation for dynamic calculations with atomic state management.
    - **Property Card Stacking**: Optimized visual stacking algorithm for multi-building properties.
    - **Dropdowns**: Migration to native HTML select elements.
    - **File Download**: Robust functionality with error handling.
    - **Notifications**: Enhanced system-wide toast notifications.
    - **PDF Optimization**: Reduced font size for disclaimers.
    - **Branding**: Universal Bridge Industrial logo and blue header styling for reports.
    - **Electrical Capacity**: Management system for transformers with CRUD functionality.
    - **RFP Search**: Comprehensive backend search across multiple fields.
    - **Workflow Status**: Refined progression for clear visual indicators.
    - **Building Specifications**: Integrated system for capturing and reporting structural, operational, and safety specifications, with PDF report generation.
    - **Vendor Workload Report**: Advanced system for generating PDF reports summarizing architect and general contractor workloads.
    - **Scope of Work Consistency**: Ensures detailed scope of work tables are displayed consistently.
    - **Published Files Download**: Streamlined zip download system in Publish phase.
    - **Missing Files Diagnostics**: Enhanced download system to provide reports for missing files.
    - **Step-Specific Downloads**: Implemented workflow step-specific file downloads.
    - **Version Tracking System**: Comprehensive version management with footer display, detailed modal, and runtime monitoring.
    - **Footer Copyright**: Clean footer implementation with copyright and version display.
    - **Historical Report Enhancements**: Revised historical pricing reports for cleaner data presentation.
    - **Excel Formula Evaluation**: Evaluation for unit prices stored as formulas.
    - **Property Summary Report**: Comprehensive report accessible through admin interface, displaying all property data with branding.
    - **Bay Configuration Direction Fix**: Enhanced bay configuration management with improved UI and dynamic directional guide.
    - **RFP Alternate Creation**: Redesigned workflow with modal-first creation, UX enhancements, auto-advance functionality, enhanced display in RFP table, and cascading delete.
    - **Executed Leases System**: Universal lease recognition system ensuring all properties display executed leases in bay configurators.
    - **Workflow Panel Enhancement**: Comprehensive hide/show functionality with sliding animation, floating restore button, auto-minimization, and UI cleanup.
    - **Property Improvements Modal Fix**: Fixes for Select component errors and dropdown indicators.
    - **Excel-like Tab Navigation**: Ongoing issue with tab navigation in Invitation to Bid modal due to conflicts between React Hook Form and desired Excel-like flow.

## External Dependencies
- **Database**: PostgreSQL (Neon serverless).
- **UI Library**: Radix UI.
- **PDF Generation**: Puppeteer.
- **Email**: SendGrid.
- **File Upload**: Multer.
- **Charting**: Recharts.
- **Data Tables**: TanStack Table.
- **Drag and Drop**: `react-beautiful-dnd`.