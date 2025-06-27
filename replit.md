# RFP Tracker - Request for Proposals Management System

## Overview

This is a full-stack web application for tracking and managing Request for Proposals (RFPs) from leasing teams. The system handles the complete RFP lifecycle from initial request entry through bid collection, evaluation, and final award. It features file upload capabilities, status tracking, comprehensive search, PDF generation, and workflow management.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack Query for server state management
- **UI Components**: Radix UI primitives with shadcn/ui component library
- **Styling**: Tailwind CSS with CSS variables for theming
- **Build Tool**: Vite with React plugin
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **File Upload**: Multer middleware for multipart form handling
- **PDF Generation**: Puppeteer for headless browser PDF creation
- **Email Service**: SendGrid integration for notifications
- **Session Management**: Express sessions with PostgreSQL store

### Database Design
- **Primary Database**: PostgreSQL (configured for Neon serverless)
- **Schema Management**: Drizzle Kit for migrations
- **Connection Pooling**: Neon serverless pool with WebSocket support

## Key Components

### RFP Management System
- **Workflow Phases**: rfp-entry → invitation-to-bid → bid-collection → evaluation → award → publish
- **Status Tracking**: received, in-progress, completed, on-hold
- **File Management**: Upload and storage system for RFP documents
- **Validation System**: Phase progression validation with error tracking

### Contact Management
- **Contact Types**: contractor, architect, owner, other
- **Company Associations**: Linked contact and company data
- **Communication Tracking**: Email and phone contact information

### Property Management
- **Bay Configuration System**: Complex bay-to-bay area calculations
- **Mechanical Room Allocation**: Proportional distribution across bays
- **Rentable Area Calculations**: Automated square footage computations

### Document Generation
- **PDF Reports**: Executive summaries, financial reports, historical pricing
- **Invitation to Bid**: Automated contractor/architect invitation generation
- **Custom Templates**: Puppeteer-based HTML to PDF conversion

### Bay Calculator
- **Property Selection**: Choose from available properties with bay configurations
- **Multi-Bay Selection**: Grid-based bay selection interface
- **Area Calculations**: Real-time square footage calculations

## Data Flow

### RFP Lifecycle
1. **Initial Entry**: Basic RFP information capture with file uploads
2. **Validation**: Required field validation before workflow progression
3. **Invitation Generation**: PDF creation for contractors/architects
4. **Bid Collection**: Structured bid data entry with line items
5. **Evaluation**: Budget comparison and financial analysis
6. **Award Process**: Final contractor selection and notification

### File Management
- **Upload Path**: `/uploads` directory with unique filename generation
- **Storage**: Local filesystem with database metadata tracking
- **Security**: File type validation and size limits via Multer

### Report Generation
- **Data Aggregation**: Query-based data collection from multiple tables
- **Template Rendering**: HTML template generation with dynamic data
- **PDF Creation**: Puppeteer browser automation for PDF output

## External Dependencies

### Core Dependencies
- **Database**: PostgreSQL via Neon serverless (@neondatabase/serverless)
- **UI Library**: Radix UI components (@radix-ui/*)
- **PDF Generation**: Puppeteer for headless Chrome
- **Email**: SendGrid for transactional emails
- **File Upload**: Multer for multipart form processing

### Development Tools
- **TypeScript**: Type safety across frontend and backend
- **Vite**: Fast development server with HMR
- **Drizzle Kit**: Database schema management and migrations
- **ESBuild**: Production bundling for server code

## Deployment Strategy

### Build Process
- **Frontend**: Vite builds to `dist/public` directory
- **Backend**: ESBuild bundles server code to `dist/index.js`
- **Static Assets**: Served via Express static middleware in production

### Environment Configuration
- **Development**: Vite dev server with Express API proxy
- **Production**: Single Express server serving built assets
- **Database**: Environment variable configuration for connection string

### Replit Integration
- **Modules**: Node.js 20, Web, PostgreSQL 16
- **Deployment**: Autoscale target with npm build/start scripts
- **Port Configuration**: Development on 5000, production on 80

## Changelog
- June 23, 2025. Initial setup
- June 23, 2025. ROM report generation enhanced with proper font size hierarchy for per-square-foot calculations (8px for category headers, 10px for Grand Total)
- June 24, 2025. Added comprehensive copyright notices throughout codebase with Savant Consulting Group LLC ownership
- June 24, 2025. Added property deletion functionality with confirmation dialog
- June 24, 2025. Significantly reduced ROM card sizes for compact 4-column layout with smaller buttons per user preference
- June 24, 2025. Further optimized ROM cards for ultra-compact layout supporting 5-6 cards per row with minimal spacing
- June 24, 2025. Compressed Reports page cards to fit Executive Summary, Historical Pricing, and Custom Report in single row with smaller buttons
- June 24, 2025. Added editable Property ID field to property edit form with validation to support application launch preparation
- June 24, 2025. Implemented auto-incrementing property IDs that suggest next available ID (highest + 1) for new properties
- June 24, 2025. Fixed "Single building property" checkbox state persistence by adding isSingleBuilding database field and proper form data management
- June 24, 2025. Implemented comprehensive user management system with role-based permissions (admin, manager, user) and admin control panel for user administration
- June 24, 2025. Configured automatic admin role assignment during development for immediate access to admin controls
- June 24, 2025. Successfully activated admin privileges - user can now access Admin Panel for user management and system configuration
- June 24, 2025. Implemented persistent admin role storage - admin privileges now survive app restarts and are stored in database
- June 24, 2025. Added granular access control system - only "Owner" type contacts can have system access, with admin-controlled checkbox to grant/revoke access permissions
- June 24, 2025. Successfully completed contact-based access control implementation - system access checkbox saves properly, authorized contacts display in Admin Panel, and permissions persist across sessions
- June 24, 2025. Enhanced contact permissions dialog to match admin user interface with role dropdown (Admin, Manager, User, Custom) and granular permission controls
- June 24, 2025. Implemented proper state management for permission changes - changes only persist when "Save Permissions" is clicked, Cancel/X reverts to original state
- June 24, 2025. Improved contact card visual consistency by moving "System Access: Granted" badge below action buttons for better symmetry across all contact types
- June 24, 2025. Fixed contact permissions save functionality by correcting API request format in mutation functions
- June 24, 2025. Enhanced user profile display with clean circular avatar containing initials and professional styling, replacing basic "Admin Access Active" button with modern user indicator
- June 24, 2025. Added admin user profile editing functionality with "Edit Profile" button in Admin Panel for updating names and email addresses
- June 24, 2025. Removed duplicate admin user indicators from dashboard header, keeping only the navigation bar profile display for clean UI
- June 24, 2025. Moved "Delete" button inside "Edit Profile" dialog as small, subtle button at bottom to prevent accidental deletion while maintaining functionality
- June 24, 2025. Fixed horizontal alignment of Admin Panel to match other pages by changing container class from "container mx-auto" to "max-w-7xl mx-auto"
- June 24, 2025. Implemented comprehensive username/password authentication system replacing development auth, with secure password hashing, session management, admin user creation, login/logout functionality, and role-based access control for production deployment
- June 24, 2025. Successfully resolved authentication persistence issues by implementing token-based authentication with localStorage storage, replacing problematic session-based auth that had cookie transmission issues in Replit environment
- June 24, 2025. Removed first-time admin setup flow from login page as admin user is now properly established and authentication system is production-ready
- June 24, 2025. Added helpful tooltip to logout button in navigation header showing "Sign Out" on hover for better user experience and clarity
- June 24, 2025. Implemented comprehensive user creation system with secure password generation, role-based permissions assignment, and credential sharing interface for onboarding new team members
- June 24, 2025. Fixed tag dropdown positioning in contact forms to display above modal instead of below, preventing "Operations" and "Finance" tags from being cut off at bottom of dialog
- June 24, 2025. Fixed Admin Panel cache invalidation to immediately update authorized contacts list when new contacts are created or existing contacts are modified with system access
- June 24, 2025. Implemented granular ROM permissions system with "rom.scope.manage" permission to control who can modify master scope items and pricing while allowing broader access to ROM creation using pre-configured scope items
- June 24, 2025. Restructured permission system to align with main navigation tabs (Contacts, Properties, ROM Pilot, Reports, Admin Panel) with Create/Delete/Edit/View sub-permissions and added RFP workflow step restrictions (rfp.step.1 through rfp.step.6) to limit user progression through specific workflow phases
- June 24, 2025. Updated dashboard statistics to always show all three main statuses (Received, In Progress, Completed) in Distribution chart even when counts are 0, and removed "On Hold" status from Overview section per user preference
- June 24, 2025. Fixed Overview chart text clipping by increasing chart height and adjusting margins to properly display "In Progress" and "Completed" labels
- June 24, 2025. Increased height and improved spacing of all dashboard stats cards to better accommodate higher numbers and improve visual readability for scaling data
- June 24, 2025. Successfully implemented contact password setting functionality for authorized ownership contacts - admin can now set passwords for team members with system access, enabling email-based login authentication for production deployment
- June 24, 2025. Implemented case-insensitive email authentication for improved user experience - users can now log in with any case combination of their email address
- June 24, 2025. Completed production-ready authentication system with Adolfo Reutlinger credentials established (AReutlinger@bridgeindustrial.com) and 4 additional team members ready for password setup via Admin Panel
- June 25, 2025. Successfully deployed RFP Tracker with custom domain RFPTracker.app - professional branded URL configured with DNS records and SSL certificate verification in progress for production team access
- June 26, 2025. Fixed RFP creation authentication error by adding requireAuth middleware to file upload endpoint and implementing proper token-based authentication in frontend form submission
- June 26, 2025. Implemented comprehensive GitHub Actions CI/CD pipeline with automated testing, security scanning, build validation, and professional development workflow documentation
- June 26, 2025. Fixed RFP deletion JSON parsing error by correcting authentication token consistency and improving API response format for successful delete operations
- June 27, 2025. Resolved file upload validation error blocking RFP creation by expanding allowed file types to include Microsoft Outlook .msg files and other business document formats
- June 27, 2025. Fixed "Remaining Warehouse Area" calculation to properly subtract office areas (existing and new) from total rentable area in RFP validation modal
- June 27, 2025. Fixed RFP validation error caused by double JSON parsing in frontend mutation - validation now processes successfully and advances workflow phases correctly
- June 27, 2025. Resolved authentication token persistence regression by implementing database-backed token storage - tokens now survive server restarts, eliminating constant re-authentication issues
- June 27, 2025. Fixed invitation-to-bid save error "response.json is not a function" by removing duplicate JSON parsing in frontend API calls
- June 27, 2025. Removed "Facility Details" section from both Architect and Contractor RFP PDF generation per user request - documents now cleaner without bay configuration tables
- June 27, 2025. Fixed PDF date display to use Eastern Time (America/New_York) instead of UTC - dates now correctly show user's local timezone
- June 27, 2025. Fixed PDF generation corruption issue by reverting to HTML output for browser-based PDF conversion - eliminates character encoding problems with Puppeteer binary PDF generation
- June 27, 2025. Resolved HTML character encoding corruption by properly converting Buffer to UTF-8 string with correct Content-Type headers - PDFs now display clean, readable content
- June 27, 2025. Completely fixed PDF generation corruption by removing Puppeteer dependency and ensuring clean HTML string output - documents now generate as proper HTML with Eastern Time dates and no facility details
- June 27, 2025. Fixed MulterError file upload issue in bid collection by changing multer configuration from array("attachments") to any() and updating file processing to handle attachment_0, attachment_1 field names - file uploads now work correctly for bid submissions
- June 27, 2025. Enhanced file upload component to support proper multiple file selection and fixed file state isolation between different bid forms - each bid now maintains separate file attachments without cross-contamination
- June 27, 2025. Fixed file attachment display in bid edit forms - existing attachments now properly load and display in edit modal, while preserving existing files when adding new attachments during updates
- June 27, 2025. Implemented proper file deletion functionality in bid attachments - removed files are now permanently deleted from database, and attachment counts synchronize correctly between table view and edit forms
- June 27, 2025. Fixed project name typo from "Bridge Point Grangry" to "Bridge Point Gratigny" in RFP database and resolved timezone conversion issues causing submission dates to display incorrectly - dates now parse directly from database strings to prevent timezone shifts from affecting date display
- June 27, 2025. Completed comprehensive timezone fix by implementing centralized formatDate function in utils.ts and systematically updating all date display components (bid-collection-table, bid-view-modal, bid-collection-modal, properties page, evaluation-budget, financial-summary) to prevent UTC conversion issues - dates now consistently display correctly across entire application
- June 27, 2025. Enhanced bid collection form UI with professional input formatting - removed spinner arrows from quantity inputs, added currency formatting ($, commas) to unit price and total price fields, implemented comma formatting for quantity fields to handle large numbers like square footage in thousands, and applied global CSS to ensure consistent number input styling across application
- June 27, 2025. Added line item reordering functionality to pricing breakdown table with up/down arrow buttons - users can now reorganize bid line items by clicking ChevronUp/ChevronDown buttons in new Order column, with disabled states for first/last items and real-time visual updates
- June 27, 2025. Implemented comprehensive system-wide drag and drop functionality using react-beautiful-dnd library - all list components across bid collection modal, invitation-to-bid modal, and ROM pilot scope modal now support intuitive drag and drop reordering positioned between up/down chevron arrows for maximum user experience flexibility
- June 27, 2025. Fixed modal layout width constraints and column sizing in bid collection modal - expanded to 95% viewport width with optimized column widths to prevent Notes column cutoff and ensure "+ Add" button and total amount display properly
- June 27, 2025. Removed "Category" column and "Bidder Name" field from bid collection interface per user request - streamlined display now shows only Company and Submission Date for cleaner professional appearance
- June 27, 2025. Added "Unit" column next to "Quantity" in all bid views and PDF generation with proper comma formatting for large numbers to improve readability of square footage values
- June 27, 2025. Fixed PDF generation authentication issues for both individual bid PDFs and "Print All Bids" functionality - replaced simple window.open() with proper Bearer token authentication using fetch API to resolve "Invalid or expired token" errors
- June 27, 2025. Resolved authentication token mismatch causing PDF generation failures - corrected token key from 'authToken' to 'auth-token' to match login system storage, enabling successful PDF generation for individual bids and modal Print/PDF buttons
- June 27, 2025. Cleaned up bid collection PDF reports per user requirements - permanently removed "Property: 1" and "Status: RECEIVED" fields from all reports, fixed timezone conversion issues by using proper date string parsing to ensure Eastern Time display without UTC conversion problems
- June 27, 2025. Implemented comprehensive line item editing cancel/save functionality in bid collection modal - users can now cancel changes while editing any line item field (description, quantity, unit, unit price, total price, notes) with red X button to revert to original values or green checkmark to save changes, eliminating the previous issue of being unable to cancel edits
- June 27, 2025. Fixed quantity display formatting in evaluation budget component to show comma separators for large numbers - quantities now display as "10,000 sf." instead of "10000 sf." for improved readability in the Quantity (Unit) column
- June 27, 2025. Fixed hardcoded project name bug in evaluation budget header - now correctly displays actual RFP project name (e.g., "Bridge Point Gratigny") instead of showing "Oakley & Sons 3 @ MG Westside - A" for all projects
- June 27, 2025. Fixed scroll jumping issue when toggling line item rollup checkboxes and dropdown selections in evaluation budget - page now maintains exact scroll position during state changes for improved user experience
- June 27, 2025. Implemented comprehensive custom assembly system for grouping related line items - users can select multiple items via checkboxes and create custom assemblies like "Dock Package" or "Demising Wall Package" using "+Add Assembly" button positioned next to "+Add Item", creating new line items with calculated totals while marking component items with strikethrough styling similar to rollup functionality
- June 27, 2025. Enhanced assembly system with proper cost redistribution and item grouping - assemblies now redistribute costs without adding new costs to project totals, assembled items are visually grouped near their assembly line item, and all cost calculation functions exclude assembled items to prevent double-counting while maintaining accurate project totals
- June 27, 2025. Added "Assembly" column header next to "Rollup" in evaluation budget tables and fixed checkbox alignment issues - both assembly and rollup checkboxes now properly center-aligned for consistent visual appearance
- June 27, 2025. Implemented "Assembly Group" column in evaluation budget tables to clearly identify which assembly each strikethrough line item belongs to - provides user visibility into cost groupings when drag-and-drop assembly movement proved technically challenging, ensuring users can track where costs are included (e.g., "Paint Demising Wall (1 Side)" shows "Demising Wall Assembly")
- June 27, 2025. Enhanced evaluation budget container width management - uses full width when evaluation view is active to accommodate all table columns without cutoff, reverts to standard max-w-7xl layout for other views
- June 27, 2025. Implemented visual distinction between cost grouping types - assembled items display with strikethrough only, while rolled-up items show strikethrough + italics, providing clear differentiation between assembly redistributed costs and rollup consolidated costs
- June 27, 2025. Fixed unit price calculation display in evaluation budget - unit prices now show distributed amounts that reflect actual cost per unit after rollups and assemblies, replacing static original unit prices with dynamically calculated values using calculateDistributedUnitPrice function
- June 27, 2025. Completed comprehensive evaluation budget report fixes - resolved invalid date generation by implementing Eastern Time formatting without UTC conversion, added comma formatting to quantity displays for improved readability, corrected rentable area calculation to properly subtract office areas from total project area, and enhanced grand total styling to include per-square-foot cost in parentheses for professional financial presentation
- June 27, 2025. Fixed critical rentable area calculation error in evaluation budget reports - corrected improper use of projectArea field (causing 200,000+ sf discrepancy) by replacing with warehouseArea field throughout PDF generation and per-square-foot calculations to display accurate rentable area values
- June 27, 2025. Added comprehensive Assembly Summary section to evaluation budget reports - appears below Line Item Rollup Summary with consistent styling, showing which individual line items are grouped into each assembly (e.g., "Paint Demising Wall → Grouped in Demising Wall Assembly") for complete cost transparency and audit trail
- June 27, 2025. Fixed comprehensive evaluation budget display issues - corrected rollup item filtering to completely exclude rolled-up items from main tables (preventing duplicate display), fixed Assembly Summary section data source reference, and corrected Grand Total per-square-foot calculation to use warehouseArea instead of projectArea for accurate $/SF values (e.g., $3,388,915.40 ÷ 213,633 sf = $15.86/sf instead of incorrect $15,910.4/sf)
- June 27, 2025. Successfully completed Assembly Summary implementation with proper assembly name display - fixed assembly name detection logic to show "Demising Wall Assembly" and "Dock Positions" instead of generic "Assembly 2868/6570", implemented comprehensive assembly name lookup system with fallback handling, and ensured both web interface and PDF generation display correct custom assembly names for complete cost grouping transparency
- June 27, 2025. Implemented comprehensive file attachment system for Budget Evaluation stage - added EvaluationAttachments component with drag-and-drop upload interface, created backend API routes for file upload/download/delete operations, added database storage methods for evaluation budget attachments, and fixed missing "size" column in evaluation_budget_attachments table to enable teams to share schedules and internal documents alongside budget reports
- June 27, 2025. Fixed evaluation budget attachment upload issue by resolving database column name conflict - removed duplicate "file_size" column and properly configured "size" column with NOT NULL constraint to match schema definition, enabling successful file upload functionality for team schedules and internal documents

## User Preferences

Preferred communication style: Simple, everyday language.