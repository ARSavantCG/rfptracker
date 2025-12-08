import { sendStatusReportEmail } from './email-service';

let schedulerInterval: NodeJS.Timeout | null = null;
let lastSentDate: string | null = null;

function isScheduledDay(): boolean {
  const now = new Date();
  const day = now.getDay();
  return day === 1 || day === 3 || day === 5;
}

function isScheduledTime(): boolean {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  return hours === 8 && minutes >= 0 && minutes < 5;
}

function getTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

async function checkAndSendScheduledEmail() {
  try {
    if (!isScheduledDay()) {
      return;
    }

    if (!isScheduledTime()) {
      return;
    }

    const todayKey = getTodayKey();
    if (lastSentDate === todayKey) {
      return;
    }

    console.log(`[Email Scheduler] Sending scheduled status report at ${new Date().toISOString()}`);
    
    const result = await sendStatusReportEmail();
    
    if (result.success) {
      lastSentDate = todayKey;
      console.log('[Email Scheduler] Status report sent successfully');
    } else {
      console.error('[Email Scheduler] Failed to send status report:', result.error);
    }
  } catch (error) {
    console.error('[Email Scheduler] Error in scheduled email check:', error);
  }
}

export function startEmailScheduler() {
  if (schedulerInterval) {
    console.log('[Email Scheduler] Scheduler already running');
    return;
  }

  console.log('[Email Scheduler] Starting email scheduler (Mon/Wed/Fri at 8 AM)');
  
  schedulerInterval = setInterval(checkAndSendScheduledEmail, 60000);
  
  checkAndSendScheduledEmail();
}

export function stopEmailScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Email Scheduler] Scheduler stopped');
  }
}

export async function sendStatusReportNow(): Promise<{ success: boolean; error?: string }> {
  console.log('[Email Scheduler] Manual trigger: Sending status report now');
  return await sendStatusReportEmail();
}
