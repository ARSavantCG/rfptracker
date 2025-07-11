import fs from 'fs';
import path from 'path';
import { storage } from './storage';

const uploadsDir = path.join(process.cwd(), 'uploads');

export interface FileCleanupResult {
  orphanedFiles: string[];
  deletedFiles: string[];
  errors: string[];
  totalSize: number;
}

/**
 * Get all files referenced in the database
 */
async function getReferencedFiles(): Promise<Set<string>> {
  const referencedFiles = new Set<string>();

  try {
    // 1. Get RFP request files
    const rfpFiles = await storage.getAllRfpFiles();
    rfpFiles.forEach(file => {
      if (file.filename) referencedFiles.add(file.filename);
    });

    // 2. Get bid collection files  
    const bidFiles = await storage.getAllBidFiles();
    bidFiles.forEach(file => {
      if (file.filename) referencedFiles.add(file.filename);
    });

    // 3. Get evaluation budget attachments
    const evalAttachments = await storage.getAllEvaluationBudgetAttachments();
    evalAttachments.forEach(file => {
      if (file.filename) referencedFiles.add(file.filename);
    });

    console.log(`Found ${referencedFiles.size} files referenced in database`);
    return referencedFiles;
  } catch (error) {
    console.error('Error getting referenced files:', error);
    return referencedFiles;
  }
}

/**
 * Get all files in the uploads directory
 */
function getUploadedFiles(): string[] {
  try {
    if (!fs.existsSync(uploadsDir)) {
      console.log('Uploads directory does not exist');
      return [];
    }

    const files = fs.readdirSync(uploadsDir);
    console.log(`Found ${files.length} files in uploads directory`);
    return files;
  } catch (error) {
    console.error('Error reading uploads directory:', error);
    return [];
  }
}

/**
 * Find orphaned files (files on disk but not in database)
 */
export async function findOrphanedFiles(): Promise<string[]> {
  const referencedFiles = await getReferencedFiles();
  const uploadedFiles = getUploadedFiles();

  const orphanedFiles = uploadedFiles.filter(file => !referencedFiles.has(file));
  console.log(`Found ${orphanedFiles.length} orphaned files`);
  
  return orphanedFiles;
}

/**
 * Delete a specific file from disk
 */
export function deleteFile(filename: string): boolean {
  try {
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted file: ${filename}`);
      return true;
    } else {
      console.log(`File not found: ${filename}`);
      return false;
    }
  } catch (error) {
    console.error(`Error deleting file ${filename}:`, error);
    return false;
  }
}

/**
 * Delete multiple files and return results
 */
export async function deleteFiles(filenames: string[]): Promise<FileCleanupResult> {
  const result: FileCleanupResult = {
    orphanedFiles: [],
    deletedFiles: [],
    errors: [],
    totalSize: 0
  };

  for (const filename of filenames) {
    try {
      const filePath = path.join(uploadsDir, filename);
      
      // Get file size before deletion
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        result.totalSize += stats.size;
        
        if (deleteFile(filename)) {
          result.deletedFiles.push(filename);
        } else {
          result.errors.push(`Failed to delete ${filename}`);
        }
      } else {
        result.errors.push(`File not found: ${filename}`);
      }
    } catch (error) {
      result.errors.push(`Error processing ${filename}: ${error.message}`);
    }
  }

  return result;
}

/**
 * Cleanup orphaned files
 */
export async function cleanupOrphanedFiles(): Promise<FileCleanupResult> {
  console.log('Starting orphaned files cleanup...');
  
  const orphanedFiles = await findOrphanedFiles();
  const result = await deleteFiles(orphanedFiles);
  
  result.orphanedFiles = orphanedFiles;
  
  console.log(`Cleanup completed: ${result.deletedFiles.length} files deleted, ${result.errors.length} errors`);
  return result;
}

/**
 * Delete files associated with a specific entity
 */
export async function deleteEntityFiles(entityType: 'rfp' | 'bid' | 'evaluation', entityId: number): Promise<string[]> {
  const deletedFiles: string[] = [];
  
  try {
    let filesToDelete: any[] = [];
    
    switch (entityType) {
      case 'rfp':
        filesToDelete = await storage.getRfpFiles(entityId);
        break;
      case 'bid':
        filesToDelete = await storage.getBidFiles(entityId);
        break;
      case 'evaluation':
        filesToDelete = await storage.getEvaluationBudgetAttachments(entityId);
        break;
    }

    for (const file of filesToDelete) {
      if (file.filename && deleteFile(file.filename)) {
        deletedFiles.push(file.filename);
      }
    }
    
    console.log(`Deleted ${deletedFiles.length} files for ${entityType} ${entityId}`);
  } catch (error) {
    console.error(`Error deleting files for ${entityType} ${entityId}:`, error);
  }
  
  return deletedFiles;
}

/**
 * Get cleanup statistics
 */
export async function getCleanupStats(): Promise<{
  totalFiles: number;
  referencedFiles: number;
  orphanedFiles: number;
  totalSizeBytes: number;
  orphanedSizeBytes: number;
}> {
  const uploadedFiles = getUploadedFiles();
  const referencedFiles = await getReferencedFiles();
  const orphanedFiles = await findOrphanedFiles();
  
  let totalSizeBytes = 0;
  let orphanedSizeBytes = 0;
  
  // Calculate sizes
  for (const filename of uploadedFiles) {
    try {
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        totalSizeBytes += stats.size;
        
        if (orphanedFiles.includes(filename)) {
          orphanedSizeBytes += stats.size;
        }
      }
    } catch (error) {
      console.error(`Error getting stats for ${filename}:`, error);
    }
  }
  
  return {
    totalFiles: uploadedFiles.length,
    referencedFiles: referencedFiles.size,
    orphanedFiles: orphanedFiles.length,
    totalSizeBytes,
    orphanedSizeBytes
  };
}