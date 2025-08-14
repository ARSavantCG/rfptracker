# RFP Tracker - Version Management & Deployment Guide

## Version Tracking System

The RFP Tracker now includes a comprehensive version tracking system that helps you monitor which version your team is using in real-time.

### Quick Version Check

**For Users:**
- Look for the version badge in the top-right corner of the navigation bar
- Click the version badge to see detailed version information including:
  - Current version number
  - Build date and environment
  - Server uptime
  - Git commit hash
  - Feature list

**For Administrators:**
- Version information automatically refreshes every 30 seconds
- Environment badge shows current deployment status (development/staging/production)
- Runtime information includes Node.js version and server uptime

## Version Management Workflow

### 1. Before Making Changes
```bash
# Check current version
curl -s http://localhost:5000/api/version | jq '.version'
```

### 2. Update Version Number
Use the provided script to increment versions:

```bash
# Patch version (bug fixes): 1.0.0 → 1.0.1
node update-version.js patch

# Minor version (new features): 1.0.0 → 1.1.0
node update-version.js minor

# Major version (breaking changes): 1.0.0 → 2.0.0
node update-version.js major

# Specific version
node update-version.js 1.2.3
```

### 3. Update Features List
Edit `version.json` to add new features to the features array:

```json
{
  "version": "1.0.1",
  "buildDate": "2025-08-14T20:00:00Z",
  "gitCommit": "abc123",
  "environment": "development",
  "features": [
    "RFP Management System",
    "Bid Collection & Evaluation",
    "PDF Report Generation",
    "Property Management",
    "Building Specifications",
    "Vendor Workload Reports",
    "Step-specific File Downloads",
    "Drag-and-Drop Evaluation",
    "Legal Compliance Monitoring",
    "NEW: Version Tracking System"
  ]
}
```

## Deployment Process

### Development Testing
1. Make changes in development mode
2. Test thoroughly with your team
3. Verify all features work as expected
4. Update version number: `node update-version.js patch`

### Staging Deployment
1. Update version for staging: `node update-version.js minor`
2. Deploy to staging environment
3. Team testing and feedback
4. Version will automatically show "staging" environment badge

### Production Deployment
1. Final version bump: `node update-version.js major` (for major releases)
2. Deploy to production
3. Version automatically shows "production" environment badge
4. Team can see exact version they're using

## Team Communication

### Version Sync Checks
- **Before meetings:** Have team members click version badge to confirm they're on the same version
- **During support:** Ask team members for their version number from the badge
- **After deployments:** Confirm all users see the new version number

### Environment Indicators
- **🔵 Development** - Blue badge, local development
- **🟡 Staging** - Yellow badge, testing environment  
- **🟢 Production** - Green badge, live system

## Troubleshooting

### Version Not Updating
1. Check if server restarted after version change
2. Hard refresh browser (Ctrl+F5 / Cmd+Shift+R)
3. Check browser console for any errors
4. Verify version.json file was updated correctly

### Team Seeing Different Versions
1. Confirm all team members refreshed their browsers
2. Check if anyone is using cached/offline version
3. Ask team to report their exact version number from the badge
4. Consider using forced cache refresh

### Production Deployment Checklist
- [ ] All tests pass in development
- [ ] Version number updated appropriately
- [ ] Features list updated in version.json
- [ ] Team notified of upcoming deployment
- [ ] Backup of current production version available
- [ ] Post-deployment: Confirm all users see new version

## Advanced Features

### Automatic Environment Detection
The system automatically detects:
- Development (NODE_ENV=development)
- Staging (NODE_ENV=staging) 
- Production (NODE_ENV=production)

### Runtime Monitoring
- Server uptime tracking
- Node.js version compatibility
- Automatic timestamp updates
- Git commit hash (when available)

### API Access
Direct version API access:
```bash
# Get full version info
curl http://localhost:5000/api/version

# Get just version number
curl -s http://localhost:5000/api/version | jq -r '.version'
```

## Best Practices

1. **Always update version before deployment**
2. **Use semantic versioning (major.minor.patch)**
3. **Document major changes in features list**
4. **Communicate version updates to team**
5. **Monitor team usage through version badges**
6. **Keep development and production versions clearly distinct**

---

*This guide ensures your team always knows which version they're using and helps prevent the confusion between development and production environments.*