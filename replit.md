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

## User Preferences

Preferred communication style: Simple, everyday language.