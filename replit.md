### Overview
This full-stack web application is designed to manage the entire lifecycle of Request for Proposals (RFPs) for leasing teams. It streamlines processes from RFP entry, bid collection, evaluation, and award, incorporating features such as file uploads, status tracking, search functionality, PDF generation, and comprehensive workflow management. The system aims to enhance efficiency, transparency, and legal compliance in procurement, particularly within commercial real estate, by ensuring accurate leasable area totals and providing a competitive edge.

### User Preferences
Preferred communication style: Simple, everyday language.

### System Architecture

#### UI/UX Decisions
The application utilizes React 18 with TypeScript, Wouter for routing, TanStack Query for state management, and Radix UI with shadcn/ui for components, all styled with Tailwind CSS. Vite is used as the build tool, and React Hook Form with Zod handles form management and validation. Design principles emphasize a consistent color scheme (green, blue, grey, cyan/teal), compact card layouts, clear visual hierarchy, data readability, and interactive elements, including professional SVG-based compass roses for bay configurations.

#### Technical Implementations
The system implements a 6-phase workflow: RFP Entry → RFP Validation → Invitation to Bid → Bid Collection → Evaluation → Publish. Core functionalities include RFP lifecycle management, contact and property management (including bay configuration, rentable area, parking, and executed leases), and custom HTML to PDF document generation for various reports. Bid and evaluation processes feature structured data entry, Excel/CSV import/export, bid attachments, assembly systems, tenant share calculations, and change tracking. Authentication uses PostgreSQL-backed sessions with token-based fallback and role-based access control. Files are stored locally with database metadata. The backend is built with Express.js and TypeScript, utilizing Drizzle ORM with PostgreSQL, deployed on Node.js 20.

Key advanced systems and features include:
- Versioned RFP numbering for counter offers.
- Manual override for calculated rentable areas.
- An admin interface for customizing document content with real-time preview.
- Automated legal compliance for leasable area totals.
- Centralized timezone management utilities.
- An Excel-like formula system for dynamic calculations.
- Optimized visual stacking for multi-building properties.
- Enhanced file download capabilities with error handling and step-specific options.
- System-wide toast notifications.
- Comprehensive backend search across multiple RFP fields.
- Integrated systems for building specifications and vendor workload reports.
- A robust version tracking system with detailed displays.
- Management of electrical capacity (transformers) with voltage-aware panel capacity management. Panels support two 3-phase voltage configurations (480V, 208/120V) with automatic amperage calculations based on the selected voltage using 3-phase formulas. The property summary report displays transformer and panel details including voltage, AMPS, and kVA values.
- **Multi-Voltage Tenant Electrical Allocation System**: Supports flexible tenant electrical allocations with multiple voltage services. Properties define transformer capacity (kVA), and the evaluation budget allows adding multiple electrical allocations at different voltages (e.g., 100 kVA @ 480V + 50 kVA @ 208V). Each allocation entry shows:
  - kVA amount (editable)
  - Voltage selection (480V, 208/120V - 3-phase services only)
  - Calculated AMPS equivalent based on voltage (using 3-phase formula: AMPS = kVA × 1000 / (Voltage × √3))
  - Service summary (e.g., "100 kVA @ 480V (3-Phase)")
  The UI displays property total transformer capacity, available capacity, and usage percentage with capacity warnings when tenant allocations exceed property limits. Allocations are stored as an array in budget metadata for persistence. Legacy single-allocation fields are maintained for backward compatibility.
- Advanced bay configuration with real-time updates, separate door count displays, adaptive layouts, and directional indicators.
- An architectural shift to a single source of truth for bay data, referencing live property data instead of snapshots.
- Multi-building cost initialization ensures accurate numeric data for costs.
- A comprehensive cost lifecycle tracking system separating lender-draw actuals from pipeline costs, with bucket categorization and integer-based monetary storage. This includes enhanced evaluation report integration and UI improvements for cost entry. The Property Existing Improvements modal now displays a unified table with per-improvement cost breakdown showing Budget (Forecast), Committed, Paid (Actuals), and Total Cost columns, replacing the previous 3-section grouped layout. Each improvement tracks costs across all three stages simultaneously (forecastCost, committedCost, actualsCost fields), with totalCost computed as their sum. Inline editing is supported: clicking directly on Budget/Committed/Paid cells in the table opens an inline input field for quick updates without opening the full edit form. The Add/Edit Improvement form also includes three separate input fields for per-stage costs with auto-calculated total display.
- Automatic thousands separator formatting for monetary input fields, enhancing readability while maintaining formula support.
- A comprehensive RFP Templates System for managing pre-configured cost item sets, stored in JSON, with secure API routes for CRUD operations, admin UI, and seamless integration into the evaluation import process. Templates now source items from a ROM Pilot catalog.
- Building depth tracking per property for automatic demising wall quantity calculations. When importing templates or creating RFPs, demising wall line items automatically populate with the building's depth value for accurate pricing.
- Auto-calculation system for Design (from rentable area), Builder's Risk Insurance (from TI total), Permit Fees (from TI total), Construction Management (from TI + all DSC including Design), and Contingency (5% of TI + all DSC including CM) with real-time updates.
- **Step 2 Tenant Electrical Allocation Tracking**: The RFP Validation modal (Step 2) includes an Electrical Allocation section that displays:
  - Property Electrical Summary: Building transformer capacity (kVA), standard tenant allocation (AMPS), and allocation increment
  - Service Voltage selection (480V or 208V 3-phase)
  - Base Allocation input (AMPS) for the tenant's standard electrical service
  - Additional Request input (AMPS) for any extra electrical capacity the tenant requires beyond the base allocation
  - Real-time Total Electrical calculation
  - Electrical Notes for special requirements
  This enables tracking when a tenant is allocated a standard amount (e.g., 200 AMPS) but requests additional capacity (e.g., +400 AMPS for server rooms).
- **Multiple Contractors/Architects Support**: The Invitation to Bid modal (Step 3) now supports assigning multiple contractors and/or architects to a single RFP. Users can click "Add Contractor" or "Add Architect" buttons to add additional recipients. Each recipient gets their own separate PDF invitation when generating documents. Additional entries can be removed with the trash icon button. Data is stored in `additionalContractors` and `additionalArchitects` JSON arrays in the database.
- **Automated Email Notification System**: Integrated with SendGrid via Replit connector for transactional emails.
  - **Scheduled Status Reports**: Mon/Wed/Fri at 8 AM automatically sends a status report showing all incomplete RFPs (any status other than "Published") to all contacts tagged as "Owner". Reports are grouped by workflow phase.
  - **Step 1 Completion Email**: When a new RFP is created (RFP Entry complete), an automatic email is sent to all Owner contacts with project details and all attached files.
  - **Step 6 Completion Email**: When a project reaches the Publish phase, an automatic email is sent to all Owner contacts with project details and all associated attachments including evaluation budget documents.
  - **Admin Controls**: Manual status report trigger available via API endpoint `/api/admin/email/send-status-report` (admin access required).
  - Email service files: `server/email-service.ts` (templates and sending), `server/email-scheduler.ts` (scheduled job system).
  - The scheduler runs every minute to check if it's time to send (8 AM on Mon/Wed/Fri) and prevents duplicate sends per day.
- **Data Scrubbing System**: A dedicated page (`/data-scrubbing`) for marking individual bid line items as "clean" data suitable for analytical reports and benchmarking. Features include:
  - `isCleanData` boolean field on bid_line_items table for granular control
  - Summary cards showing total, clean, and unclean item counts
  - Search and filter functionality (all items, clean only, unclean only)
  - Bulk update with pending changes tracking and save confirmation
  - Displays project name, contractor, category, description, and pricing for each line item
- **Data Scrubbing & Mapping System**: A dedicated page (`/data-mapping`) for assigning standardized master categories to bid line items. Features include:
  - `master_categories` table with 20 pre-seeded construction categories (Concrete, Electrical, HVAC, etc.)
  - `masterCategoryId` foreign key on bid_line_items for standardized categorization
  - Table shows only unmapped items (masterCategoryId IS NULL) to track progress
  - Master Category dropdown per row for category assignment
  - Clean Data checkbox per row to mark reliable pricing
  - Auto-save functionality: when both category and clean checkbox are set, the item saves and disappears from view
  - Bulk update: select multiple rows, choose a category, and apply to all at once
  - Notes popover icon shows item notes to help determine if pricing is clean (e.g., if electrical includes lighting)
  - Progress card showing remaining items to map
- **Project Report Generator**: A dynamic reporting page (`/project-report-generator`) that generates cost reports for selected projects. Features include:
  - Project dropdown to select any RFP from the database
  - Toggle switch between "Show All Data" and "Show Analytical Data Only" (filters by isCleanData)
  - Cost table with consistent headers: Category, Contractor, Description, Unit Price, Total Cost
  - Summary totals: Total Line Items, Total Project Cost, Cost per Sq Ft (based on project area)
  - Print-friendly layout with proper styling
- **Report Styling Templates**: CSS templates stored in `/templates/report_style.css` for consistent styling across generated reports.
- **Automated Project File Organization System**: Dynamic folder structure for organizing project files by workflow phase:
  - When a new RFP is created, a project folder is automatically generated in `/uploads/projects/` using a sanitized project name (e.g., `Miami_Warehouse_Exp_RFP-2025-001`)
  - Each project folder contains 6 subfolders: `Step_1_Entry`, `Step_2_Validation`, `Step_3_Bidding`, `Step_4_Evaluation`, `Step_5_Publishing`, `Step_6_Final`
  - File uploads are automatically routed to the folder matching the RFP's current workflow phase
  - The `project_files` database table tracks all files with: `projectId`, `filePath`, `fileName`, `originalName`, `workflowStep`, `mimeType`, `fileSize`, `uploadedBy`, `uploadedAt`
  - The `projectFolder` column on `rfp_requests` stores the sanitized folder name for each project
  - Migration endpoint available at `/api/admin/migrate-project-folders` to create folder structures for existing RFPs
  - API endpoints: `GET /api/rfp-requests/:id/project-files` (all files), `GET /api/rfp-requests/:id/project-files/:step` (by step), `DELETE /api/project-files/:fileId`
  - File organization utilities in `server/file-organization.ts`: sanitizeProjectName, createProjectFolderStructure, getWorkflowStepFolder, getStepFolderPath, getRelativeFilePath
- **Replit Object Storage Integration**: Professional file handling using Replit App Storage with presigned URL upload flow for future document management capabilities.
- **Phase 2 — Project Actuals & Historical Intelligence**: Full pipeline for recording, importing, and benchmarking historical project costs.
  - `project_actuals` and `project_actual_line_items` database tables with full CRUD API (`server/actuals-routes.ts`)
  - **Historical Import Page** (`/historical-import`): Manual entry form (one project at a time with dynamic cost breakdown rows by category/area type) and CSV import tab with preview, confirmation, and downloadable template
  - **Benchmarks Dashboard** (`cost-benchmarks.tsx`): Category × area type table showing Low / Avg / High $/SF, spread % (color-coded), vs. ROM price comparison with trend arrows, and "Update ROM Price" button per row that calls the pricing-mode PATCH route
  - **ROM Pilot Benchmarks Tab**: Added to the ROM Pilot page alongside the existing estimates list
  - **Record Project Actuals Section** (`record-project-actuals.tsx`): Appears at the bottom of every Evaluation Budget view, pre-populated from the RFP (name, tenant, property) and budget data (grand total, line items by category). Has Save / Skip for now options. Shows success state with link to Benchmarks after saving.
  - **Admin Panel Link**: Historical Import accessible from Admin → Data Quality tab
  - GET `/api/project-actuals/benchmarks` intelligence endpoint aggregates $/SF by category and area type across all historical projects

### External Dependencies
- **Database**: PostgreSQL (Neon serverless)
- **UI Library**: Radix UI
- **PDF Generation**: Puppeteer
- **Email**: SendGrid
- **File Upload**: Multer
- **Charting**: Recharts
- **Data Tables**: TanStack Table
- **Drag and Drop**: `react-beautiful-dnd`