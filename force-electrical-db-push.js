// Force push electrical capacity schema
import { spawn } from 'child_process';

console.log('Pushing electrical capacity schema...');

const pushProcess = spawn('npx', ['drizzle-kit', 'push', '--force'], {
  stdio: 'inherit'
});

pushProcess.on('close', (code) => {
  console.log(`Schema push completed with code ${code}`);
  process.exit(code);
});