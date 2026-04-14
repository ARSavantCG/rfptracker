import fs from 'fs';
import path from 'path';
import { backupToObjectStorage } from '../storage-backup';

const uploadsDir = path.join(process.cwd(), 'uploads');

function collectFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function runUploadsMigration(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  failures: { file: string; error: string }[];
}> {
  if (!fs.existsSync(uploadsDir)) {
    console.log('[Migration] uploads/ directory does not exist — nothing to migrate.');
    return { total: 0, succeeded: 0, failed: 0, failures: [] };
  }

  const allFiles = collectFiles(uploadsDir);
  console.log(`[Migration] Found ${allFiles.length} file(s) in uploads/ to back up.`);

  let succeeded = 0;
  let failed = 0;
  const failures: { file: string; error: string }[] = [];

  for (const filePath of allFiles) {
    const filename = path.basename(filePath);
    try {
      await backupToObjectStorage(filePath, filename);
      console.log(`[Migration] ✅ ${filename}`);
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Migration] ❌ ${filename} — ${message}`);
      failures.push({ file: filename, error: message });
      failed++;
    }
  }

  console.log(`[Migration] Done. Total: ${allFiles.length} | Succeeded: ${succeeded} | Failed: ${failed}`);
  return { total: allFiles.length, succeeded, failed, failures };
}
