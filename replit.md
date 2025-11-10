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
    - **Bay Configuration Real-time Updates**: Enhanced data synchronization ensuring bay configuration totals and individual bay data update immediately across all components without requiring page refresh.
    - **Separate Door Count Display**: Independent display of standard and oversized dock doors ("X std", "Y ovr") instead of combined totals, with optimized space-efficient layout.
    - **Adaptive Bay Box Layout**: Bay configuration boxes grow vertically to accommodate content while maintaining consistent width, with optimized font sizing for clear visibility.
    - **Enhanced Bay Configuration UX**: Comprehensive layout shift prevention ensuring bay grid remains stable during selection, professional dynamic container expansion, and improved cursor tracking.
    - **Parking Allocation Management**: Advanced parking override system with independent save functionality, professional font sizing, reset capabilities, and proportional allocation calculations.
    - **Professional Interface Design**: Implemented dashed border containers, centered empty states with icons, and smooth downward expansion without affecting upper layout elements.
    - **Bay Directional Indicators**: Restored compass rose visual indicators in bay-selection-grid for RFP creation, showing building orientation with N/S/E/W labels and Bay 1 facing direction, available in both single and multi-building modes.
    - **Single Source of Truth for Bay Data**: Architectural shift from snapshot-based storage to reference-based live lookups. RFPs now store only property_id + bay_ids references and always fetch current bay data from Properties module at request time. Eliminates data divergence between RFPs and Properties. Backend GET endpoints fetch live data directly, frontend RFP creation sends only references (not snapshots), no-cache headers prevent stale 304 responses. Properties module is the definitive source for all bay configuration data.
    - **Multi-Building Cost Initialization**: Fixed validation error in multi-building RFP creation where costsPerBuilding values were undefined or strings instead of numbers. Bay selection grid now automatically initializes cost objects with numeric defaults {existing: 0, improvements: 0, rom: 0, notes: ''} when buildings are selected. Backend also converts all FormData numeric fields (propertyId, cost values) from strings to numbers before Zod validation, ensuring complete type safety throughout the submission flow.
    - **Cost Lifecycle Tracking**: Comprehensive system separating lender-draw actuals from pipeline costs. Tracks costs through lifecycle with bucket categorization (ACTUALS/PIPELINE), draw capture status, original commitment tracking, and lender draw references. Property improvements display split into two sections: "Committed / Projected Costs" showing costs not yet in draws (blue styling), and "Cost to Date (Actuals)" showing confirmed draw expenditures (green styling). All monetary values stored as integer cents to avoid floating-point drift, with dollar-to-cent conversion in backend and cent-to-dollar conversion via formatCurrency in frontend. Backfilled 19 existing records with ACTUALS bucket and captured status. Embedded directly into existing property cost management interface for seamless workflow integration. **Evaluation Reports Integration**: Reports now properly segregate costs by bucket, displaying separate sections for "Cost to Date (Actuals)" and "Committed / Projected Costs" with independent totals and per-RSF calculations. Mixed-bucket assemblies render individual component items with "(from mixed-bucket assembly)" notation to maintain full cost visibility and prevent double-counting. Excel-like formula support added to Original Commitment and Added Amounts fields using z.coerce.number() validation. **UI Improvements (Nov 2025)**: Property improvements modal streamlined with simplified terminology ("Improvement" vs "Existing Improvement"), logical form reordering (Cost Lifecycle Tracking section now appears before main data entry fields), and clarified "Current Total Cost ($)" field with contextual helper text explaining relationship to lifecycle tracking amounts. **Bucket-Sensitive Field Behavior (Nov 2025)**: Intelligent field behavior based on bucket selection - for PIPELINE bucket, users enter Original Commitment and Added Amounts with Current Total Cost auto-calculated and displayed as read-only (slate-100 background with "(Auto-calculated)" label); for ACTUALS bucket, commitment fields are hidden and Current Total Cost becomes an editable FormulaInput for direct entry of confirmed expenditures. Bucket switching logic preserves totalCost when moving from PIPELINE to ACTUALS (clearing commitment/draw fields), and resets totalCost to 0 when switching to PIPELINE to prompt re-entry. previousBucketRef tracking prevents unwanted bucket-switch side effects during record editing. Helper text provides bucket-specific guidance (formula support info for ACTUALS, auto-calculation explanation for PIPELINE).
    - **Thousands Separator Formatting**: Automatic comma formatting for monetary input fields to improve readability of large values. FormulaInput component enhanced with opt-in `formatThousands` prop that applies live thousands separators as users type (e.g., "50000" → "50,000"). Implemented robust cursor position tracking using `requestAnimationFrame` to prevent cursor jumping during editing. Special edge case handling for cursor at start (targetRawCount === 0), middle insertions, and end positions. Formula mode (values starting with "=") bypasses formatting to preserve Excel-like formula entry. Commas automatically stripped before Zod validation and backend submission. Applied to 13 monetary fields across 4 components: property-existing-improvements-modal.tsx (3 fields: Original Commitment, Added Amounts, Current Total Cost), evaluation-budget.tsx (3 fields: line item unitPrice, new item unitPrice, new item totalPrice), rom-scope-items-modal.tsx (4 fields: add form Unit Price/Minimum Cost, edit mode Unit Price/Minimum Cost), and bid-collection-modal.tsx (3 fields: line item unitPrice, line item totalPrice, alternate cost). Cursor calculation uses raw digit counting to maintain stable position across formatting changes.

## External Dependencies
- **Database**: PostgreSQL (Neon serverless).
- **UI Library**: Radix UI.
- **PDF Generation**: Puppeteer.
- **Email**: SendGrid.
- **File Upload**: Multer.
- **Charting**: Recharts.
- **Data Tables**: TanStack Table.
- **Drag and Drop**: `react-beautiful-dnd`.