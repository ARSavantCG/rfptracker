import fs from "fs";
import path from "path";

export const WORKFLOW_STEP_MAPPING: Record<string, string> = {
  "rfp-entry": "Step_1_Entry",
  "rfp-validation": "Step_2_Validation",
  "invitation-to-bid": "Step_3_Bidding",
  "bid-collection": "Step_3_Bidding",
  "evaluation": "Step_4_Evaluation",
  "publish": "Step_5_Publishing",
};

export const WORKFLOW_STEP_FOLDERS = [
  "Step_1_Entry",
  "Step_2_Validation",
  "Step_3_Bidding",
  "Step_4_Evaluation",
  "Step_5_Publishing",
  "Step_6_Final",
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
