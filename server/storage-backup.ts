import type { Response } from 'express';
import { objectStorageClient } from './replit_integrations/object_storage';

function parseOSPath(fullPath: string): { bucketName: string; objectName: string } {
  const p = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
  const parts = p.split('/');
  return { bucketName: parts[1], objectName: parts.slice(2).join('/') };
}

function getOSKey(filename: string): { bucketName: string; objectName: string } | null {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) return null;
  return parseOSPath(`${privateDir}/uploads/${filename}`);
}

/**
 * Back up an uploaded file to Object Storage.
 *
 * WHY THIS MATTERS: Replit deployments get a fresh container on every publish, so
 * the local uploads directory is WIPED. Object Storage is the only durable copy.
 * A file whose backup failed is not "degraded" - it is permanently lost the next
 * time the app is published, silently, and nobody finds out until someone clicks
 * download months later.
 *
 * Two hardenings over the original single-shot upload:
 *   1. Retries with backoff. The observed failure mode on this platform is a
 *      dropped connection mid-transfer, which is exactly what a retry fixes.
 *   2. Verifies the object EXISTS after writing. bucket.upload() resolving is not
 *      proof the object landed; without the read-back a partial or rejected write
 *      logs as success.
 *
 * Throws if it cannot confirm the object after all attempts, so callers can
 * record the failure rather than assume it worked.
 */
export async function backupToObjectStorage(localFilePath: string, filename: string): Promise<void> {
  const key = getOSKey(filename);
  if (!key) {
    throw new Error(`[OS Backup] PRIVATE_OBJECT_DIR not set — cannot back up ${filename}`);
  }
  const { bucketName, objectName } = key;
  const bucket = objectStorageClient.bucket(bucketName);

  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await bucket.upload(localFilePath, { destination: objectName });

      // Read back. Upload resolving is not proof the object is retrievable.
      const [exists] = await bucket.file(objectName).exists();
      if (!exists) {
        throw new Error('upload reported success but object does not exist');
      }

      console.log(`[OS Backup] ✅ Verified ${filename} → bucket: ${bucketName}, key: ${objectName}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return;
    } catch (err) {
      lastError = err as Error;
      console.error(`[OS Backup] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${filename}: ${lastError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  // Loud and unambiguous: this file exists ONLY on ephemeral disk right now.
  console.error(
    `[OS Backup] ❌ PERMANENT FAILURE for ${filename} after ${MAX_ATTEMPTS} attempts. ` +
    `This file exists only on ephemeral disk and WILL BE LOST on the next publish.`
  );
  throw lastError ?? new Error(`[OS Backup] failed to back up ${filename}`);
}

export async function listObjectStorageFiles(): Promise<{ name: string; key: string }[]> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) return [];
  const { bucketName, objectName: prefix } = parseOSPath(`${privateDir}/uploads/`);
  try {
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });
    return files.map(f => ({
      key: f.name,
      name: f.name.replace(prefix, ''),
    }));
  } catch (err) {
    console.error('[OS Backup] Failed to list object storage files:', err);
    throw err;
  }
}

export async function streamFromObjectStorage(filename: string, res: Response, urlPath?: string): Promise<boolean> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) return false;

  const { bucketName, objectName: dirPrefix } = parseOSPath(privateDir);
  // dirPrefix is the path within the bucket, e.g. ".private"

  // Build ordered list of candidate object keys to try
  const candidates: string[] = [
    `${dirPrefix}/uploads/${filename}`,  // 1. .private/uploads/<filename>
  ];

  if (urlPath) {
    const cleanPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
    // 2. .private/<full URL path>  e.g. .private/uploads/Y4GE82CM...pdf
    const candidate2 = `${dirPrefix}/${cleanPath}`;
    if (candidate2 !== candidates[0]) candidates.push(candidate2);
    // 3. full URL path as-is  e.g. uploads/Y4GE82CM...pdf
    if (cleanPath !== candidates[0] && cleanPath !== candidate2) candidates.push(cleanPath);
  }

  const bucket = objectStorageClient.bucket(bucketName);
  for (const objectName of candidates) {
    try {
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        res.set('Content-Type', (metadata.contentType as string) || 'application/octet-stream');
        file.createReadStream().pipe(res);
        console.log(`[OS Backup] Serving ${filename} from key: ${objectName}`);
        return true;
      }
      console.log(`[OS Backup] Key not found: ${objectName}`);
    } catch (err) {
      console.error(`[OS Backup] Error checking key ${objectName}:`, err);
    }
  }
  return false;
}

/**
 * Download a file from Object Storage as a Buffer (for server-side reading,
 * not streaming to a response). Tries the same candidate keys as streamFromObjectStorage.
 * Returns null if not found or object storage isn't configured.
 */
export async function downloadFromObjectStorage(filename: string, urlPath?: string): Promise<Buffer | null> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) return null;
  const { bucketName, objectName: dirPrefix } = parseOSPath(privateDir);

  const candidates: string[] = [`${dirPrefix}/uploads/${filename}`];
  if (urlPath) {
    const cleanPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
    const c2 = `${dirPrefix}/${cleanPath}`;
    if (c2 !== candidates[0]) candidates.push(c2);
    if (cleanPath !== candidates[0] && cleanPath !== c2) candidates.push(cleanPath);
  }

  const bucket = objectStorageClient.bucket(bucketName);
  for (const objectName of candidates) {
    try {
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        const [buf] = await file.download();
        return buf as Buffer;
      }
      console.log(`[OS Backup] downloadFromObjectStorage key not found: ${objectName}`);
    } catch (err) {
      console.error(`[OS Backup] downloadFromObjectStorage error on key ${objectName}:`, (err as Error).message);
    }
  }
  return null;
}

/**
 * Shared file-buffer helper used by the AI intake parser.
 *
 * Resolution order:
 *   Local disk (3 candidates: cwd/filePath, cwd/uploads/<bare>, cwd/uploads/projects/<bare>)
 *   → Object Storage direct-key candidates (full path, raw path, bare key)
 *   → Object Storage suffix-scan by originalName (last resort — handles the case where files
 *     were uploaded via DiskWithBackupStorage with a nanoid prefix, so the OS key is
 *     `.private/uploads/<nanoid>-<originalName>` rather than anything derivable from filePath)
 *
 * Pass originalName (from project_files.originalName) whenever available so the suffix-scan
 * fallback can find the correct Object Storage object.
 *
 * Full logging — no silent catches — so production logs show exactly what fails.
 */
export async function getFileBuffer(filePath: string, originalName?: string): Promise<Buffer | null> {
  const { existsSync, readFileSync } = await import('fs');
  const { default: path } = await import('path');

  const bare = filePath.split('/').pop() || filePath;
  const localCandidates = [
    path.join(process.cwd(), filePath),
    path.join(process.cwd(), 'uploads', bare),
    path.join(process.cwd(), 'uploads', 'projects', bare),
  ];

  for (const candidate of localCandidates) {
    let exists = false;
    try { exists = existsSync(candidate); } catch { /* ignore stat errors */ }
    console.log(`[getFileBuffer] local candidate: ${candidate} exists=${exists}`);
    if (exists) {
      try {
        return readFileSync(candidate);
      } catch (err) {
        console.error(`[getFileBuffer] readFileSync failed for ${candidate}:`, (err as Error).message);
      }
    }
  }

  // ── Object Storage fallback ──────────────────────────────────────────────
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    console.log(`[getFileBuffer] PRIVATE_OBJECT_DIR not set — no object storage fallback`);
    return null;
  }

  const { bucketName, objectName: dirPrefix } = parseOSPath(privateDir);
  const bucket = objectStorageClient.bucket(bucketName);

  // Step A: Try direct-key candidates (fast — no listing needed)
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const directKeys = [
    `${dirPrefix}/${cleanPath}`,      // .private/uploads/projects/<folder>/Step/file
    cleanPath,                         // uploads/projects/<folder>/Step/file
    `${dirPrefix}/uploads/${bare}`,    // .private/uploads/<bare>  (legacy)
  ].filter((k, i, a) => a.indexOf(k) === i); // deduplicate

  for (const osKey of directKeys) {
    console.log(`[getFileBuffer] trying Object Storage key: bucket=${bucketName} key=${osKey}`);
    try {
      const file = bucket.file(osKey);
      const [exists] = await file.exists();
      if (exists) {
        const [buf] = await file.download();
        console.log(`[getFileBuffer] found in Object Storage: ${osKey} (${(buf as Buffer).length} bytes)`);
        return buf as Buffer;
      }
      console.log(`[getFileBuffer] Object Storage key not found: ${osKey}`);
    } catch (err) {
      console.error(`[getFileBuffer] Object Storage error for key ${osKey}:`, (err as Error).message);
    }
  }

  // Step B: Suffix-scan by originalName.
  // Files uploaded via DiskWithBackupStorage are keyed as .private/uploads/<nanoid>-<originalName>.
  // The nanoid is not stored in project_files, so we can't derive the exact key — but we can
  // list the bucket prefix and find keys ending with -<originalName> or _<originalName>.
  const nameToMatch = originalName || bare;
  console.log(`[getFileBuffer] direct keys missed — scanning bucket prefix ${dirPrefix}/uploads/ for suffix match on: "${nameToMatch}"`);
  try {
    const [files] = await bucket.getFiles({ prefix: `${dirPrefix}/uploads/` });
    // Look for keys that end with a separator + the target name (avoids false partial matches)
    const matches = (files as any[]).filter(
      (f) => f.name.endsWith(`-${nameToMatch}`) || f.name.endsWith(`_${nameToMatch}`)
    );
    console.log(`[getFileBuffer] suffix-scan found ${matches.length} candidate(s) for "${nameToMatch}"`);
    if (matches.length > 0) {
      // Pick the last entry (most recently uploaded)
      const target = matches[matches.length - 1];
      console.log(`[getFileBuffer] using suffix-matched key: ${target.name}`);
      const [buf] = await target.download();
      console.log(`[getFileBuffer] suffix-scan success: ${target.name} (${(buf as Buffer).length} bytes)`);
      return buf as Buffer;
    }
  } catch (err) {
    console.error(`[getFileBuffer] suffix-scan error:`, (err as Error).message);
  }

  console.log(`[getFileBuffer] all candidates exhausted for: ${filePath}`);
  return null;
}
