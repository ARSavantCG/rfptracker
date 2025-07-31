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
- **Evaluation Budget**: Assembly system for grouping line items, tenant share percentage calculations, comprehensive change tracking between reports, Excel export for detailed analysis.
- **Authentication & Authorization**: PostgreSQL-backed session storage, token-based fallback, rolling sessions, role-based access control with granular permissions.
- **File Management**: Local filesystem storage for files with database metadata tracking, file type validation, size limits.
- **Database ORM**: Drizzle ORM with PostgreSQL.
- **Backend Framework**: Express.js with TypeScript.
- **Deployment**: Node.js 20, Web, PostgreSQL 16 on Replit; Autoscale target.
- **Numbering System**: Versioned RFP numbering for counter offers (e.g., RFP-2025-001.01) with hierarchical display.
- **Rentable Area Override**: Capability to override calculated rentable areas for specific RFPs.
- **Document Editor**: Admin panel interface for customizing standard document content (e.g., RFP templates) with real-time preview.
- **Legal Compliance Rounding System**: Critical requirement system that ensures exact leasable area totals to prevent legal issues. Distributes excess square footage across smallest bays (1 SF per bay) with consistent rule application across all properties. Overstating leasable area even by 1 SF can result in lawsuits.

## External Dependencies
- **Database**: PostgreSQL (via Neon serverless).
- **UI Library**: Radix UI components.
- **PDF Generation**: Puppeteer (for headless browser operations).
- **Email**: SendGrid (for transactional emails).
- **File Upload**: Multer (for multipart form processing).
- **Charting**: Recharts.
- **Data Tables**: TanStack Table.
- **Drag and Drop**: `react-beautiful-dnd`.