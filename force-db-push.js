#!/usr/bin/env node

// Temporary script to force database push without interactive prompts
const { exec } = require('child_process');

console.log('Force pushing database schema changes...');

const child = exec('npm run db:push', (error, stdout, stderr) => {
  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log('Database push completed successfully');
});

// Auto-respond "Yes" to the truncation prompt
child.stdin.write('\n'); // Select "Yes, I want to truncate 1 table"
child.stdin.write('\n'); // Confirm
child.stdin.end();