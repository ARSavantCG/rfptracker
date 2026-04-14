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
  console.log(`[OS Backup] Uploaded ${filename} to object storage`);
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

export async function streamFromObjectStorage(filename: string, res: Response): Promise<boolean> {
  const key = getOSKey(filename);
  if (!key) return false;
  const { bucketName, objectName } = key;
  try {
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) return false;
    const [metadata] = await file.getMetadata();
    res.set('Content-Type', (metadata.contentType as string) || 'application/octet-stream');
    file.createReadStream().pipe(res);
    return true;
  } catch (err) {
    console.error('[OS Backup] Failed to stream from object storage:', err);
    return false;
  }
}
