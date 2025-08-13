# RFP Tracker - Request for Proposals Management System

## Overview
This is a full-stack web application for managing the complete lifecycle of Request for Proposals (RFPs) from leasing teams. It supports RFP entry, bid collection, evaluation, and award, with features like file uploads, status tracking, search, PDF generation, and workflow management. The system aims to streamline RFP processes for commercial real estate and similar industries, improving efficiency and transparency in procurement and ensuring legal compliance regarding leasable area totals.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Framework & Libraries**: React 18 with TypeScript, Wouter for routing, TanStack Query for state, Radix UI and shadcn/ui for components, Tailwind CSS for styling.
- **Build Tool**: Vite.
- **Form Management**: React Hook Form with Zod validation.
- **Design Principles**: Consistent color scheme (green for success, blue for current, grey for future, cyan/teal for improvements), compact card layouts, clear visual hierarchy, emphasis on data readability, and interactive elements like drag-and-drop.
- **Visuals**: Professional SVG-based compass rose design for bay configurations.

### Technical Implementations
- **Workflow**: A 6-phase system: RFP Entry → RFP Validation → Invitation to Bid → Bid Collection → Evaluation → Publish.
- **Core Management**: RFP lifecycle (status, files, validation), contact categorization, property management (bay configuration, rentable area, parking, executed leases).
- **Document Generation**: PDF reports (executive summaries, financial, historical pricing, invitation to bid) via custom HTML to PDF conversion.
- **Bid & Evaluation**: Structured bid data entry, line item reordering, Excel/CSV import, bid attachments, assembly system for line items, tenant share calculations, change tracking, and Excel export.
- **Authentication & Authorization**: PostgreSQL-backed sessions, token-based fallback, role-based access control.
- **File Management**: Local filesystem storage with database metadata.
- **Backend & Database**: Express.js with TypeScript, Drizzle ORM with PostgreSQL.
- **Deployment**: Node.js 20 on Replit.
- **Advanced Systems**:
    - **RFP Numbering**: Versioned RFP numbering for counter offers (e.g., RFP-2025-001.01).
    - **Rentable Area Override**: Manual override capability for calculated rentable areas.
    - **Document Editor**: Admin interface for customizing standard document content with real-time preview.
    - **Legal Compliance**: Automated system ensuring exact leasable area totals across all properties with startup enforcement, middleware integration, and admin monitoring.
    - **Timezone Management**: System-wide centralized date handling utilities to eliminate timezone conversion issues. Critical fix applied 8/13/2025: Eliminated local formatDate function in publish-summary.tsx that was causing timezone conversion bugs, ensuring all date displays use centralized formatDateForDisplay.
    - **Formula System**: Excel-like formula evaluation for dynamic calculations in bid and evaluation interfaces, with atomic state management.
    - **Property Card Stacking**: Optimized visual stacking algorithm for multi-building properties.
    - **Dropdowns**: Migration to native HTML select for improved consistency and reliability.
    - **File Download**: Robust file download functionality with error handling and data integrity checks.
    - **Notifications**: Enhanced system-wide toast notifications for consistent styling and visibility.
    - **PDF Optimization**: Reduced font size for disclaimers and preliminary text in PDFs.
    - **Branding**: Universal Bridge Industrial logo and blue header styling across all reports.
    - **Electrical Capacity**: Management system for transformers with full CRUD functionality.
    - **RFP Search**: Comprehensive backend search across tenant name, project name, RFP number, property, and contacts.
    - **Workflow Status**: Refined RFP workflow progression for clear visual indicators during validation.
    - **Building Specifications**: Integrated system for capturing and reporting structural, operational, and safety specifications, with PDF report generation.
    - **Vendor Workload Report**: Advanced system for generating PDF reports summarizing architect and general contractor workloads with filtering and branding.
    - **Scope of Work Consistency**: Ensures detailed scope of work tables are displayed consistently in both architect and contractor RFPs.
    - **Published Files Download**: Streamlined zip download system in Publish phase replacing refresh button with "Download All Files" functionality for organized file distribution.

## External Dependencies
- **Database**: PostgreSQL (Neon serverless).
- **UI Library**: Radix UI.
- **PDF Generation**: Puppeteer.
- **Email**: SendGrid.
- **File Upload**: Multer.
- **Charting**: Recharts.
- **Data Tables**: TanStack Table.
- **Drag and Drop**: `react-beautiful-dnd`.