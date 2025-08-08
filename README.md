# RFP Tracker

A comprehensive Request for Proposals (RFP) management system designed for commercial real estate leasing teams.

## 🌐 Live Application
**Production URL:** [RFPTracker.app](https://rfptracker.app)

## 🏗️ System Overview

RFP Tracker streamlines the complete commercial real estate RFP lifecycle from initial request entry through bid collection, evaluation, and final award. Built with enterprise-grade security and role-based permissions for team collaboration.

### Key Features

- **Complete RFP Workflow Management** - Guided progression through 6 distinct phases
- **Role-Based Authentication** - Secure user management with granular permissions
- **Property & Contact Management** - Comprehensive database with advanced search
- **ROM Calculator** - Rough Order of Magnitude cost estimation tools
- **PDF Generation** - Automated reports and invitation documents
- **Real-time Dashboard** - Analytics and progress tracking
- **Multi-tenant Support** - Designed for enterprise teams

## 🚀 Technology Stack

### Frontend
- **React 18** with TypeScript
- **Wouter** for client-side routing
- **TanStack Query** for server state management
- **Radix UI** with shadcn/ui components
- **Tailwind CSS** for styling
- **Vite** build system

### Backend
- **Express.js** with TypeScript
- **PostgreSQL** with Drizzle ORM
- **JWT Authentication** with bcrypt
- **Puppeteer** for PDF generation
- **Multer** for file uploads
- **SendGrid** for email notifications

### Infrastructure
- **Replit Deployments** (Production hosting)
- **Neon Database** (PostgreSQL serverless)
- **Custom Domain** (RFPTracker.app)
- **Automatic SSL/TLS** encryption

## 🛠️ Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL database
- Environment variables configured

### Installation
```bash
# Clone repository
git clone <repository-url>
cd rfp-tracker

# Install dependencies
npm install

# Setup database
npm run db:push

# Start development server
npm run dev
```

## 📊 Vendor Workload Report

The RFP Tracker includes a comprehensive Vendor Workload reporting system that analyzes all Architect and General Contractor RFPs to provide workload summaries grouped by vendor/firm.

### What it does

- Analyzes all RFPs in the database to identify architect and contractor workloads
- Groups RFPs by vendor (architect or general contractor)
- Provides detailed project information including dates, status, and selections
- Generates professional PDF reports with Bridge Industrial branding
- Shows summary statistics (total RFPs, unique vendors, average workload per vendor)

### How to generate reports

#### Web Interface (Recommended)
1. Navigate to the Reports page in the RFP Tracker
2. Click "Generate Report" on the "Vendor Workload" card
3. The PDF report will open in a new browser window for download

#### Command Line
```bash
# Generate a basic vendor workload report
python tools/vendor_workload_report.py

# Generate report with date filtering  
python tools/vendor_workload_report.py --start-date 2025-01-01 --end-date 2025-03-31

# Generate report for specific vendors
python tools/vendor_workload_report.py --vendors "Gensler,ABC Construction"

# Specify custom output directory
python tools/vendor_workload_report.py --output ./custom-reports/

# TypeScript alternative
tsx tools/vendor-workload-cli.ts --start-date 2025-01-01 --vendors "Gensler"
```

### Configuration

The system works with your existing RFP database automatically. No additional configuration is required.

**Environment Variables (optional):**
- `DATABASE_URL` - Database connection (auto-configured in Replit)
- `RFP_TABLE` - Table name for RFPs (default: rfp_requests)
- `COLMAP` - JSON mapping for flexible column names (optional)

**Example COLMAP for custom databases:**
```json
{
  "type": "request_type",
  "vendor": "company_name", 
  "project": "project_title",
  "status": "rfp_status",
  "sent": "date_sent"
}
```

### Output

Reports are generated as PDFs in the `./reports/` directory with filenames like:
- `vendor-workload-report-2025-08-08-1946.pdf`
- `vendor-workload-report-2025-08-08-1946-2025-01-01-to-2025-03-31.pdf`
- `vendor-workload-report-2025-08-08-1946-gensler.pdf`

### Report Content

Each vendor workload report includes:
- **Header** with Bridge Industrial logo and generation timestamp
- **Summary statistics** showing total RFPs, unique vendors, and averages
- **Vendor sections** grouped alphabetically, each containing:
  - Vendor name and project count
  - Project details: name, RFP number, sent date, status
  - Selected architect/contractor information (when available)
- **Professional formatting** consistent with other system reports

### Troubleshooting

**No RFPs found:**
- Ensure RFPs have either `architect` or `generalContractor` fields populated
- Check date filters are not too restrictive
- Verify vendor names are correctly entered in the system

**Command not found:**
- Ensure you're in the project root directory
- For Python: Check Python is installed and script is executable
- For TypeScript: Ensure `tsx` is available globally or use `npx tsx`

### Environment Variables
```env
DATABASE_URL=postgresql://...
SESSION_SECRET=your-session-secret
SENDGRID_API_KEY=your-sendgrid-key (optional)
OPENAI_API_KEY=your-openai-key (optional)
```

## 📁 Project Structure

```
rfp-tracker/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Utilities and configurations
├── server/                 # Express backend
│   ├── routes.ts           # API endpoints
│   ├── storage.ts          # Database layer
│   ├── auth.ts             # Authentication logic
│   └── pdf-generator.ts    # PDF creation
├── shared/                 # Shared types and schemas
│   └── schema.ts           # Database schema and types
└── uploads/                # File storage directory
```

## 🔐 Authentication & Permissions

### User Roles
- **Admin** - Full system access and user management
- **Manager** - RFP management and team oversight
- **User** - Basic RFP operations and reporting
- **Custom** - Granular permission assignment

### Contact-Based Access
Only "Owner" type contacts can be granted system access through the Admin Panel. Administrators can set passwords and configure permissions for team members.

## 🔄 RFP Workflow Phases

1. **RFP Entry** - Initial data collection and validation
2. **Invitation to Bid** - Generate and send contractor invitations
3. **Bid Collection** - Structured bid data entry and management
4. **Evaluation** - Budget comparison and financial analysis
5. **Award** - Final contractor selection and notification
6. **Publish** - Generate comprehensive project reports

## 📊 Database Schema

### Core Tables
- `rfp_requests` - Main RFP data and workflow state
- `properties` - Property information with bay configurations
- `contacts` - Contractor, architect, and owner information
- `bid_collections` - Submitted bids and line items
- `users` - System user authentication and permissions
- `sessions` - Secure session management

## 🧪 Testing & Quality Assurance

### GitHub Actions CI/CD
- **Automated Testing** - Unit and integration tests
- **Security Scanning** - Vulnerability assessment
- **Code Quality** - Linting and type checking
- **Build Validation** - Production build verification

### Manual Testing Checklist
- [ ] User authentication and authorization
- [ ] RFP workflow progression
- [ ] PDF generation functionality
- [ ] Database operations and migrations
- [ ] Permission-based access control

## 🚀 Deployment

### Production Environment
- **Hosting**: Replit Deployments with autoscaling
- **Domain**: RFPTracker.app with automatic SSL
- **Database**: Neon PostgreSQL with connection pooling
- **Monitoring**: Built-in analytics and logging

### Deployment Process
1. Code changes pushed to main branch
2. GitHub Actions runs CI/CD pipeline
3. Replit automatically deploys to production
4. DNS propagation and SSL certificate renewal

## 👥 Team Access

### Current Authorized Users
- **Adolfo Reutlinger** - Full admin access (active)
- **Eduardo Diaz** - Create/edit permissions (setup pending)
- **John Mejia** - View permissions + user management (setup pending)
- **Brenda Gonzalez** - View permissions only (setup pending)
- **Francis Roura** - Create/edit permissions (setup pending)

### Onboarding New Users
1. Add contact with "Owner" type in Contacts section
2. Grant system access through Admin Panel
3. Set password using "Set Password" or "Generate Password"
4. Configure role-based permissions
5. Share login credentials securely

## 📈 Analytics & Reporting

### Dashboard Metrics
- RFP status distribution (Received, In Progress, Completed)
- Project timeline tracking
- Budget analysis and trends
- Team performance indicators

### Generated Reports
- **Executive Summary** - High-level project overview
- **Financial Summary** - Detailed budget breakdown
- **Historical Pricing** - Market analysis and trends
- **Custom Reports** - Tailored data exports

## 🔧 Maintenance & Updates

### Regular Tasks
- Monitor system performance and usage
- Review and update user permissions
- Backup database and file uploads
- Update dependencies and security patches

### Feature Development
- Follow pull request template for code reviews
- Update documentation for new features
- Test across different user permission levels
- Update replit.md with architectural changes

## 📞 Support & Documentation

### Technical Support
- Review application logs in Replit console
- Check database status and connectivity
- Verify user permissions and access levels
- Monitor SSL certificate and domain status

### Business Support
- User training and onboarding assistance
- Workflow optimization recommendations
- Feature requests and enhancement planning
- Data migration and system integration

---

**RFP Tracker** - Streamlining commercial real estate leasing operations with enterprise-grade project management.

Built with ❤️ for Bridge Industrial and the commercial real estate industry.