# RFP Tracker - Request for Proposals Management System

## Overview
This is a full-stack web application designed for managing the complete lifecycle of Request for Proposals (RFPs) from leasing teams. It supports RFP entry, bid collection, evaluation, and award, featuring file uploads, status tracking, search, PDF generation, and workflow management. The system aims to streamline RFP processes for commercial real estate and similar industries, improving efficiency and transparency in procurement.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Framework**: React 18 with TypeScript.
- **Routing**: Wouter for client-side navigation.
- **State Management**: TanStack Query for server state.
- **UI Components**: Radix UI primitives and shadcn/ui.
- **Styling**: Tailwind CSS with CSS variables for theming.
- **Build Tool**: Vite.
- **Form Handling**: React Hook Form with Zod validation.
- **Color Scheme**: Consistent use of green for success/advance, blue for current phases, grey for future phases, cyan/teal for existing improvements.
- **Layout**: Compact card layouts, consistent row heights, clear visual hierarchy, emphasis on data readability (e.g., comma formatting for numbers).
- **Interactivity**: Drag-and-drop for reordering, click-to-deselect, collapsible sections, tooltips.
- **Compass System**: Visual compass indicators (N/S/E/W) and directional labels for bay configuration, with a professional SVG-based compass rose design.

### Technical Implementations
- **Workflow Management**: A 6-phase workflow: RFP Entry → RFP Validation → Invitation to Bid → Bid Collection → Evaluation → Publish.
- **RFP Management**: Status tracking (received, in-progress, completed, on-hold), file management (uploads, storage, metadata), phase-based validation.
- **Contact Management**: Categorization (contractor, architect, owner), company associations, communication tracking.
- **Property Management**: Bay configuration system (complex area calculations, mechanical room allocation), rentable area computations, parking information, executed lease management with bay assignments.
- **Document Generation**: PDF reports (executive summaries, financial reports, historical pricing, invitation to bid), custom HTML to PDF conversion via Puppeteer.
- **Bay Calculator**: Real-time square footage calculations based on property bay selections.
- **Bid Collection**: Structured bid data entry, line item reordering (drag-and-drop), Excel/CSV import, file attachments for bids.
- **Evaluation Budget**: Assembly system for grouping line items, tenant share percentage calculations, comprehensive change tracking between reports, Excel export for detailed analysis, "Refresh from Property" functionality to synchronize existing improvements from property data.
- **Authentication & Authorization**: PostgreSQL-backed session storage, token-based fallback, rolling sessions, role-based access control with granular permissions.
- **File Management**: Local filesystem storage for files with database metadata tracking, file type validation, size limits.
- **Database ORM**: Drizzle ORM with PostgreSQL.
- **Backend Framework**: Express.js with TypeScript.
- **Deployment**: Node.js 20, Web, PostgreSQL 16 on Replit; Autoscale target.
- **Numbering System**: Versioned RFP numbering for counter offers (e.g., RFP-2025-001.01) with hierarchical display.
- **Rentable Area Override**: Capability to override calculated rentable areas for specific RFPs.
- **Document Editor**: Admin panel interface for customizing standard document content (e.g., RFP templates) with real-time preview.
- **Comprehensive Legal Compliance System**: Automated system that ensures exact leasable area totals across ALL properties (existing and new) to prevent legal issues. Features startup enforcement, automatic middleware integration, manual enforcement endpoint, admin monitoring panel, and consistent application to any new properties. Distributes excess square footage by taking 1 SF from the smallest bays matching the exact difference (e.g., 5 SF excess = 1 SF from 5 smallest bays). When multiple bays have identical square footage, prioritizes by bay number order (Bay 1, Bay 2, etc.) for consistent, predictable adjustments. Overstating leasable area even by 1 SF can result in lawsuits.
  - Bridge Point Gratigny: 409,189 SF (exact legal requirement)
  - Bridge 595: 290,307 SF (exact legal requirement) 
  - Bridge Point Port Everglades: 171,983 SF (exact legal requirement)
  - MG Westside: 794,334 SF (exact legal requirement)
  - Startup enforcement on server initialization
  - Automatic property update middleware with legal compliance
  - Admin dashboard legal compliance monitoring panel
  - Manual enforcement API endpoint for admin controls
- **Comprehensive Timezone & Date Management System**: System-wide centralized date handling utilities to eliminate persistent date shifting issues that occurred due to timezone conversions. Features shared date utilities (`@shared/date-utils.ts`), timezone admin panel monitoring, consistent form input/display formatting, and database storage that preserves local dates without conversion. Prevents all date-related timezone bugs across the application.
- **Excel-like Formula System with Atomic State Management**: Advanced formula evaluation system supporting complex calculations in FormulaInput components with "=" prefix support for dynamic calculations across bid collection and evaluation budget interfaces. Fixed critical race condition issues by implementing atomic state updates that prevent data loss during rapid field changes. Unit prices, quantities, and totals now persist correctly through all operations including database saves and PDF generation. Fixed "$NaN" display issue in bid view modal by enhancing formatCurrency function to properly handle formula evaluation and invalid values (January 2025).
- **Optimized Property Card Stacking System**: Clean visual stacking algorithm for multi-building properties using translate transforms instead of complex positioning calculations. Features neat 4px offsets, subtle rotation (0.5deg), and proper z-index management for professional appearance. Eliminates card scattering issues and provides intuitive visual hierarchy (January 2025).
- **Reliable Stack Dropdown Implementation**: Replaced complex React Select component with native HTML select for property building stack management. Ensures consistent functionality across all browsers with clear option visibility ("Stack", "All (6)", "Bldg. 1", etc.) without rendering or z-index issues. Maintains professional styling with custom ChevronDown icon (January 2025).
- **Enhanced Property File Download System**: Comprehensive file download functionality with robust error handling, authentication validation, and data integrity checks. Features detailed error messages for authentication failures, file not found scenarios, and server errors. Includes server-side debugging logs and automatic data integrity validation to ensure database records match actual files on disk (January 2025).
- **Comprehensive Toast Notification Enhancement**: System-wide improvement of all popup notifications with z-index 9999 positioning for maximum visibility and duration settings (4-8 seconds based on message type). Enhanced 45+ component files containing 250+ individual toast notifications to ensure consistent styling, proper timing, and automatic dismissal throughout the application. Implemented optimal toast sizing with fit-content width, horizontal flex layout, and proper close button positioning at the end of content using relative positioning and CSS gap spacing. Close button now appears after text content instead of overlapping, with subtle background styling for visibility. User confirmed improved notification visibility and functionality (August 2025).
- **PDF Disclaimer Text Font Size Optimization**: Reduced all disclaimer and preliminary text in PDF documents by 25% (font-size: 0.75em for CSS classes, 9px for footer text) to improve document readability and professional appearance. Updated both architect and contractor RFPs including broker-specific versions. Changes applied to .requirements, .preliminary-notice, and .footer CSS classes plus inline styling for consistent text sizing across all PDF generation functions. User confirmed successful implementation (August 2025).
- **Universal Bridge Industrial Branding Implementation**: Implemented consistent Bridge Industrial logo and blue header styling across ALL report types system-wide. Added getBridgeLogo() function to all report generation files and applied Bridge blue color (rgb(0,50,130)) for headers with professional document title formatting. Updated historical pricing reports, executive summary reports, custom reports, property print reports, bay configurations, executed leases, existing improvements, and electrical capacity management reports. All reports now display the Bridge Industrial logo at 30px height and use consistent blue header styling to match RFP document branding for unified professional appearance (August 2025).
- **Fixed Electrical Capacity Management System**: Resolved critical transformer creation issues by adding missing property-specific POST endpoint (`/api/properties/:id/transformers`), correcting field mappings from legacy `name/capacity` to proper database schema `transformerName/totalCapacityKva/fplId`, updating interface definitions, and ensuring consistent "FPL Designation No." terminology throughout the system. Transformers now persist correctly with proper status display and full CRUD functionality (August 2025).
- **Comprehensive Dropdown Component Migration**: Completed system-wide replacement of problematic shadcn Select and DropdownMenu components with native HTML implementations to ensure consistent cross-browser functionality. Fixed all dropdown visibility issues including edit RFP modal, reports filters, admin role selections, properties building selectors, and admin navigation dropdown. Enhanced with professional styling using ChevronDown icons and proper click-outside-to-close functionality (August 2025).
- **RFP Search Functionality Fix**: Corrected backend search implementation by updating field mappings from legacy `client/project` to current database schema `tenantName/projectName`. Search now properly filters across tenant name, project name, RFP number, property, development contact, and sent by fields, restoring full text search capability across all RFP records (August 2025).
- **Enhanced Workflow Status Management**: Refined RFP workflow progression to maintain "Received" (purple) status during validation phase for improved team visibility. RFPs now automatically advance from Step 1 (RFP Entry) to Step 2 (RFP Validation) upon creation while keeping purple status until validation completion. Status changes to "In Progress" only when advancing beyond validation phase, providing clear visual indicators for the validation team to identify RFPs requiring attention (August 2025).
- **Building Specifications Management System**: Comprehensive building specifications capture system integrated with properties management. Features organized sections for structural specifications (slab thickness/PSI, clear height, floor flatness/level, truck apron details), operational specifications (ramp capacity, roof R-value), and fire & safety systems (fire pump/sprinkler information). Positioned alongside electrical management for easy access, with all specifications stored in database ready for inclusion in RFP documents and lease documentation. Text input system allows flexible entry of building-specific technical details for professional documentation. Complete with edit protection (fields locked until Edit button clicked), edit/save/cancel workflow, and professional PDF report generation with Bridge Industrial branding for lease attachments. Reports open in new browser window allowing users to save as PDF via browser's print function (August 2025).

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless).
- **UI Library**: Radix UI components.
- **PDF Generation**: Puppeteer (for headless browser operations).
- **Email**: SendGrid (for transactional emails).
- **File Upload**: Multer (for multipart form processing).
- **Charting**: Recharts.
- **Data Tables**: TanStack Table.
- **Drag and Drop**: `react-beautiful-dnd`.