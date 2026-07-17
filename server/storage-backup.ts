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

export async function backupToObjectStorage(localFilePath: string, filename: string): Promise<void> {
  const key = getOSKey(filename);
  if (!key) return;
  const { bucketName, objectName } = key;
  const bucket = objectStorageClient.bucket(bucketName);
  await bucket.upload(localFilePath, { destination: objectName });
  console.log(`[OS Backup] Uploaded ${filename} → bucket: ${bucketName}, key: ${objectName}`);
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
    } catch {
      // try next candidate
    }
  }
  return null;
}
