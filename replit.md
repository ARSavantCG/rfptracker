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

## User Preferences

Preferred communication style: Simple, everyday language.