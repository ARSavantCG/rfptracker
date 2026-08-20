import fs from "fs";
import path from "path";

/**
 * Folder per workflow step, numbered TO MATCH THE WORKFLOW.
 *
 *   1 RFP Entry · 2 RFP Validation · 3 Invitation to Bid
 *   4 Bid Collection · 5 Evaluation · 6 Publish
 *
 * This previously folded invitation-to-bid AND bid-collection into a single
 * "Step_3_Bidding" folder, which shifted everything after it down by one:
 * evaluation filed as Step_4 and publish as Step_5. So a file's step number did
 * not match the step the user was on, and bid responses were stored alongside
 * the invitation that requested them.
 *
 * Steps 3 and 4 are now separate, and the numbers agree with the UI.
 */
export const WORKFLOW_STEP_MAPPING: Record<string, string> = {
  "rfp-entry": "Step_1_Entry",
  "rfp-validation": "Step_2_Validation",
  "invitation-to-bid": "Step_3_Invitation",
  "bid-collection": "Step_4_Bid_Collection",
  "evaluation": "Step_5_Evaluation",
  "publish": "Step_6_Publish",
};

/**
 * Folder names used before the renumbering, kept so existing files still
 * resolve. Nothing writes these any more; they exist so a file uploaded under
 * the old scheme is not orphaned.
 */
export const LEGACY_STEP_FOLDERS: Record<string, string> = {
  "Step_3_Bidding": "Step_3_Invitation",
  "Step_4_Evaluation": "Step_5_Evaluation",
  "Step_5_Publishing": "Step_6_Publish",
};

export const WORKFLOW_STEP_FOLDERS = [
  "Step_1_Entry",
  "Step_2_Validation",
  "Step_3_Invitation",
  "Step_4_Bid_Collection",
  "Step_5_Evaluation",
  "Step_5_Evaluation/Architect_Docs",
  "Step_5_Evaluation/GC_Docs",
  "Step_6_Publish",
];

export function sanitizeProjectName(projectName: string, rfpNumber?: string): string {
  if (!projectName || projectName.trim() === "") {
    return rfpNumber ? `RFP_${rfpNumber.replace(/[^a-zA-Z0-9-]/g, "_")}` : `Project_${Date.now()}`;
  }

  let sanitized = projectName
    .trim()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/[^\w\-]/g, "_")
    .substring(0, 100);

  if (sanitized.length === 0) {
    return rfpNumber ? `RFP_${rfpNumber.replace(/[^a-zA-Z0-9-]/g, "_")}` : `Project_${Date.now()}`;
  }

  if (rfpNumber) {
    const sanitizedRfpNumber = rfpNumber.replace(/[^a-zA-Z0-9-]/g, "_");
    sanitized = `${sanitized}_${sanitizedRfpNumber}`;
  }

  return sanitized;
}

export function getProjectFolderPath(projectFolder: string): string {
  return path.join(process.cwd(), "uploads", "projects", projectFolder);
}

export function getStepFolderPath(projectFolder: string, workflowStep: string): string {
  const stepFolder = WORKFLOW_STEP_MAPPING[workflowStep] || workflowStep;
  return path.join(getProjectFolderPath(projectFolder), stepFolder);
}

export async function createProjectFolderStructure(projectFolder: string): Promise<void> {
  const projectPath = getProjectFolderPath(projectFolder);

  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  for (const stepFolder of WORKFLOW_STEP_FOLDERS) {
    const stepPath = path.join(projectPath, stepFolder);
    if (!fs.existsSync(stepPath)) {
      fs.mkdirSync(stepPath, { recursive: true });
    }
  }

  console.log(`📁 Created project folder structure: ${projectPath}`);
}

export function getWorkflowStepFolder(workflowPhase: string): string {
  return WORKFLOW_STEP_MAPPING[workflowPhase] || "Step_1_Entry";
}

export async function moveFileToProjectFolder(
  sourcePath: string,
  projectFolder: string,
  workflowStep: string,
  newFilename?: string
): Promise<string> {
  const stepFolderPath = getStepFolderPath(projectFolder, workflowStep);

  if (!fs.existsSync(stepFolderPath)) {
    fs.mkdirSync(stepFolderPath, { recursive: true });
  }

  const filename = newFilename || path.basename(sourcePath);
  const destinationPath = path.join(stepFolderPath, filename);

  if (fs.existsSync(sourcePath)) {
    fs.renameSync(sourcePath, destinationPath);
    console.log(`📄 Moved file: ${sourcePath} -> ${destinationPath}`);
  }

  return destinationPath;
}

export function getRelativeFilePath(projectFolder: string, workflowStep: string, filename: string): string {
  const stepFolder = WORKFLOW_STEP_MAPPING[workflowStep] || workflowStep;
  return path.join("uploads", "projects", projectFolder, stepFolder, filename);
}

export function ensureUploadsDirectory(): void {
  const uploadsPath = path.join(process.cwd(), "uploads", "projects");
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
  }
}

export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return `file_${Date.now()}`;
  }
  
  return filename
    .replace(/\.\./g, '_')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/\.+$/, '_')
    .substring(0, 255);
}

export function resolveSecureFilePath(filePath: string, baseDir: string): string | null {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }
  
  const normalizedPath = path.normalize(filePath);
  const absolutePath = path.isAbsolute(normalizedPath) 
    ? normalizedPath 
    : path.join(baseDir, normalizedPath);
  
  const resolvedPath = path.resolve(absolutePath);
  const resolvedBase = path.resolve(baseDir);
  
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    console.warn(`Path traversal attempt detected: ${filePath}`);
    return null;
  }
  
  return resolvedPath;
}

export function getSecureDownloadPath(filePath: string): string | null {
  const cwd = process.cwd();
  const uploadsDir = path.join(cwd, "uploads");
  
  if (filePath.startsWith('uploads/projects/') || filePath.startsWith('uploads\\projects\\')) {
    return resolveSecureFilePath(filePath, cwd);
  }
  
  return resolveSecureFilePath(filePath, uploadsDir);
}
