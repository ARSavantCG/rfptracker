#!/usr/bin/env node

/**
 * Version Update Script for RFP Tracker
 * 
 * Usage:
 *   node update-version.js patch    # 1.0.0 -> 1.0.1
 *   node update-version.js minor    # 1.0.0 -> 1.1.0
 *   node update-version.js major    # 1.0.0 -> 2.0.0
 *   node update-version.js 1.2.3    # Set specific version
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const versionFilePath = path.join(__dirname, 'version.json');

function incrementVersion(currentVersion, type) {
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      // Check if it's a valid version format
      if (/^\d+\.\d+\.\d+$/.test(type)) {
        return type;
      }
      throw new Error(`Invalid version type: ${type}. Use 'major', 'minor', 'patch', or a specific version like '1.2.3'`);
  }
}

function updateVersion(newVersionType) {
  try {
    // Read current version
    const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    const currentVersion = versionData.version;
    
    // Calculate new version
    const newVersion = incrementVersion(currentVersion, newVersionType);
    
    // Update version data
    const updatedData = {
      ...versionData,
      version: newVersion,
      buildDate: new Date().toISOString(),
      gitCommit: process.env.REPLIT_DEPLOYMENT_GIT_SHA || 'local-build',
      environment: process.env.NODE_ENV || 'development'
    };
    
    // Write updated version
    fs.writeFileSync(versionFilePath, JSON.stringify(updatedData, null, 2));
    
    console.log(`✅ Version updated: ${currentVersion} → ${newVersion}`);
    console.log(`📅 Build date: ${updatedData.buildDate}`);
    console.log(`🌍 Environment: ${updatedData.environment}`);
    
    return updatedData;
  } catch (error) {
    console.error('❌ Error updating version:', error.message);
    process.exit(1);
  }
}

// Main execution
const versionType = process.argv[2];

if (!versionType) {
  console.log('Usage: node update-version.js <patch|minor|major|x.x.x>');
  console.log('Examples:');
  console.log('  node update-version.js patch    # Increment patch version');
  console.log('  node update-version.js minor    # Increment minor version');
  console.log('  node update-version.js major    # Increment major version');
  console.log('  node update-version.js 2.1.0    # Set specific version');
  process.exit(1);
}

updateVersion(versionType);