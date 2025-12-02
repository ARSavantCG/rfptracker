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
- Management of electrical capacity (transformers).
- Advanced bay configuration with real-time updates, separate door count displays, adaptive layouts, and directional indicators.
- An architectural shift to a single source of truth for bay data, referencing live property data instead of snapshots.
- Multi-building cost initialization ensures accurate numeric data for costs.
- A comprehensive cost lifecycle tracking system separating lender-draw actuals from pipeline costs, with bucket categorization and integer-based monetary storage. This includes enhanced evaluation report integration and UI improvements for cost entry. The Property Existing Improvements modal now displays a unified table with per-improvement cost breakdown showing Budget (Forecast), Committed, Paid (Actuals), and Total Cost columns, replacing the previous 3-section grouped layout. Each improvement tracks costs across all three stages simultaneously (forecastCost, committedCost, actualsCost fields), with totalCost computed as their sum. Inline editing is supported: clicking directly on Budget/Committed/Paid cells in the table opens an inline input field for quick updates without opening the full edit form. The Add/Edit Improvement form also includes three separate input fields for per-stage costs with auto-calculated total display.
- Automatic thousands separator formatting for monetary input fields, enhancing readability while maintaining formula support.
- A comprehensive RFP Templates System for managing pre-configured cost item sets, stored in JSON, with secure API routes for CRUD operations, admin UI, and seamless integration into the evaluation import process. Templates now source items from a ROM Pilot catalog.
- Building depth tracking per property for automatic demising wall quantity calculations. When importing templates or creating RFPs, demising wall line items automatically populate with the building's depth value for accurate pricing.
- Auto-calculation system for Design (from rentable area), Builder's Risk Insurance (from TI total), Permit Fees (from TI total), Construction Management (from TI + all DSC including Design), and Contingency (5% of TI + all DSC including CM) with real-time updates.

### External Dependencies
- **Database**: PostgreSQL (Neon serverless)
- **UI Library**: Radix UI
- **PDF Generation**: Puppeteer
- **Email**: SendGrid
- **File Upload**: Multer
- **Charting**: Recharts
- **Data Tables**: TanStack Table
- **Drag and Drop**: `react-beautiful-dnd`