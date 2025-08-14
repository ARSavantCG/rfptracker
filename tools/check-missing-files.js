/**
 * Check Missing Files Utility
 * This script checks which RFP files exist in database but are missing from disk
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Client } = pg;

async function checkMissingFiles() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/rfp_tracker'
  });

  try {
    await client.connect();
    console.log('🔍 Checking for missing files...\n');

    // Get all RFPs with files
    const result = await client.query(`
      SELECT id, rfp_number, project_name, files, status, workflow_phase
      FROM rfp_requests 
      WHERE files::text != '[]' AND files IS NOT NULL
      ORDER BY id
    `);

    const uploadsDir = path.join(process.cwd(), 'uploads');
    let totalMissing = 0;
    let totalFiles = 0;

    for (const rfp of result.rows) {
      const files = JSON.parse(rfp.files);
      if (files.length === 0) continue;

      console.log(`\n📋 RFP ${rfp.rfp_number}: ${rfp.project_name}`);
      console.log(`   Status: ${rfp.status} | Phase: ${rfp.workflow_phase}`);
      console.log(`   Files in DB: ${files.length}`);

      let missingCount = 0;
      for (const file of files) {
        totalFiles++;
        const filePath = path.join(uploadsDir, file.path || file.name);
        const exists = fs.existsSync(filePath);
        
        if (!exists) {
          console.log(`   ❌ MISSING: ${file.name}`);
          console.log(`      Path: ${file.path}`);
          console.log(`      Size: ${file.size} bytes`);
          console.log(`      Uploaded: ${file.uploadedAt}`);
          missingCount++;
          totalMissing++;
        } else {
          console.log(`   ✅ Found: ${file.name}`);
        }
      }
      
      if (missingCount === 0) {
        console.log(`   🎉 All files present!`);
      } else {
        console.log(`   ⚠️  ${missingCount} files missing from disk`);
      }
    }

    console.log(`\n📊 SUMMARY:`);
    console.log(`   Total files in database: ${totalFiles}`);
    console.log(`   Missing from disk: ${totalMissing}`);
    console.log(`   Files present: ${totalFiles - totalMissing}`);
    console.log(`   Missing percentage: ${((totalMissing / totalFiles) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

checkMissingFiles();