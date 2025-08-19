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
    - **Download Naming Fix**: Comprehensive fix applied 8/13/2025 to all download functions across the system to use project names instead of RFP numbers for better file organization. Applied to rfp-detail-modal.tsx, financial-summary.tsx, and PDF generators.
    - **Missing Files Diagnostics**: Enhanced download system to provide detailed reports when files exist in database but are missing from disk, helping identify data integrity issues.
    - **Step-Specific Downloads**: Implemented workflow step-specific file downloads (8/14/2025). "Download Step Files" button now downloads only files from current workflow step, while "Download All Files" downloads files from all steps. Publish phase now properly filters to only files uploaded during that specific step.
    - **Version Tracking System**: Comprehensive version management system (8/14/2025) with footer-based version display, detailed modal with build info, runtime monitoring, and automatic environment detection. Includes update script and deployment guide for team coordination and version synchronization. Features subtle blue text styling, proper modal spacing, and minimal Recent Changes section with tiny bullet points for clean tracking.
    - **Footer Copyright**: Clean footer implementation (8/14/2025) displaying "© 2025 All Rights Reserved" centered at bottom with version display aligned on same line. Professional, minimal design without company branding as requested.
    - **Historical Report Enhancements**: Revised historical pricing reports (8/14/2025) to remove summary metrics, display company names only, add Unit column with comma-formatted quantities, and eliminate Category column for cleaner data presentation.
    - **Excel Formula Evaluation**: Fixed "$NaN" issue in historical pricing reports (8/14/2025) by implementing Excel formula evaluation for unit prices stored as formulas like "=49910/124". System now properly calculates unit prices from Excel expressions, displaying correct values instead of NaN errors.
    - **Property Summary Report**: Successfully integrated comprehensive property summary report (8/14/2025) accessible through admin interface Reports tab. Opens in new tab like other reports, displays all property data with Bridge Industrial branding, includes bay configurations, building specs, electrical capacity, executed leases, and cost estimates. Fixed authentication and database import issues for seamless functionality. Enhanced (8/15/2025) to pull real cost data from property_existing_improvements table with proper allocation methods: Fire Alarm (per SF), Ventilation (per bay), Restrooms (per bay), LED Warehouse Lighting (per SF), Speculative Office (per bay). Building numbers now only display for multi-building properties. Removed redundant specifications status section.
    - **Bay Configuration Direction Fix**: Enhanced bay configuration management (8/18/2025) with improved UI showing dynamic directional guide. Fixed Bridge Point Doral Building 5 bay progression direction issue - Bay 1 faces East (correct) but bay progression should be South (North→South numbering) instead of North. Added clear visual indicators with red/green dots and example flow display. Implemented dynamic directional labels in bay selection grid that adapt to actual building orientation (North End/South End vs West End/East End). Removed confusing hardcoded directional bars above bay buttons for cleaner interface.
    - **Excel-like Tab Navigation**: CRITICAL ONGOING ISSUE (8/18/2025) - Tab navigation in Invitation to Bid modal remains broken despite multiple comprehensive fixes attempted. Current status:
      • **Problem**: Tab from Description cell jumps to top-of-page controls instead of Quantity cell in same row
      • **Root Cause**: React Hook Form's natural tab order conflicts with desired Excel-like flow; DOM order doesn't match visual table layout
      • **Failed Approaches**: Custom Tab handlers, tabIndex manipulation, DOM reordering, preventDefault/stopPropagation patterns
      • **Architectural Challenge**: CSS Grid visual layout vs DOM tab sequence creates fundamental mismatch
      • **User Impact**: Data entry impossible, breaks workflow efficiency expectations
      • **Next Steps**: Need deeper architectural solution - potentially table restructure or complete navigation system redesign
      Current implementation provides basic form navigation but falls short of Excel-like table navigation requirements.
    - **RFP Alternate Creation Fix**: Fixed authentication issue (8/19/2025) in CreateAlternateModal where API requests were failing with "No token provided" error. Added proper Bearer token authentication to create-option endpoint requests, ensuring alternates can be successfully created from the purple branch icon in RFP table.
    - **Modal-First Alternate Creation**: Completely redesigned alternate creation workflow (8/19/2025) to open EditRfpModal first for data entry before database creation. Fixed modal closing issue by preventing auto-refresh effect from interfering with template RFPs (id: 0). Users now click purple branch icon → modal opens → enter all data → click Save → alternate created. No automatic database creation or timing delays.
    - **Alternate Creation UX Enhancements**: Streamlined alternate creation interface (8/19/2025) with removal of Development Contact field (filled by development team later), addition of dedicated Alternate Description field between Tenant Name and Project Name, automatic project name formatting as "Tenant Name @ Property Name (Alternate Description)", cleared file inheritance for independent alternates, unchecked Request Types by default, removal of Status/Workflow Phase fields (system-managed), and green "Create RFP & Advance" button for intuitive workflow progression.
    - **Alternate Auto-Advance Workflow**: Implemented complete create-and-advance functionality (8/19/2025) where "Create RFP & Advance" button creates alternate and automatically advances to RFP Validation phase in single action. Fixed authentication token key mismatch (auth_token vs auth-token) enabling seamless API communication. Team can now pick up alternates directly in Step 2 validation phase, maintaining workflow efficiency and consistency.
    - **Alternate Display Enhancement**: Enhanced RFP table display (8/19/2025) to clearly show alternate titles in the tenant column. Alternates now display the tenant name plus alternate title in purple italic text, making it easy to distinguish alternates from parent RFPs at a glance. Property column kept clean without redundant alternate labeling.
    - **Cascading Delete Fix**: Implemented cascading deletes (8/19/2025) to prevent orphaned alternates and counter offers. When a parent RFP is deleted, all associated alternates and counter offers are automatically deleted recursively. Fixed issue where orphaned alternates were appearing in reports after parent RFP deletion.
    - **Executed Leases System**: Universal lease recognition system (8/18/2025) ensuring all properties display executed leases in bay configurators. Added comprehensive sample leases across all properties (Bridge 595, Bridge Point Doral Buildings 1-6, Bridge Point Gratigny, Bridge Point Miami Station Buildings 1-2, MG Westside Building 1) with realistic tenant names, bay assignments, and parking allocations for consistent bay configurator functionality.
    - **Workflow Panel Enhancement**: Completed comprehensive hide/show functionality (8/19/2025) with right-side sliding animation and floating restore button. Panel slides horizontally off-screen when collapsed, with dynamic page layout adjustment for maximum content space. Fixed dashboard layout consistency to maintain exact Status/Distribution/Overview card widths across all workflow modes. Floating "Workflow" button positioned at top-16 to avoid covering user avatar. **Auto-minimization feature**: Workflow panel automatically collapses when clicking any workflow step (Validation, Invitation, Bid Collection, Evaluation, Publish), providing immediate focus on work area with full-width content expansion. System now provides seamless workflow navigation while preserving professional layout proportions.

## External Dependencies
- **Database**: PostgreSQL (Neon serverless).
- **UI Library**: Radix UI.
- **PDF Generation**: Puppeteer.
- **Email**: SendGrid.
- **File Upload**: Multer.
- **Charting**: Recharts.
- **Data Tables**: TanStack Table.
- **Drag and Drop**: `react-beautiful-dnd`.