import { db } from "./db";
import { appSettings, SETTING_REPORT_DAYS, SETTING_REPORT_HOUR } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { sendStatusReportEmail } from './email-service';

let schedulerInterval: NodeJS.Timeout | null = null;
let lastSentDate: string | null = null;

/**
 * Cadence is read from app_settings on every check, so a change takes effect
 * without a republish - same reasoning as the mute switch.
 *
 * Defaults to the previous hardcoded behaviour (Mon/Wed/Fri at 08:00) when
 * unset, so nothing changes until someone deliberately changes it. An empty
 * days string means OFF.
 */
const DEFAULT_DAYS = '1,3,5';
const DEFAULT_HOUR = 8;

async function readCadence(): Promise<{ days: number[]; hour: number; off: boolean }> {
  try {
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, [SETTING_REPORT_DAYS, SETTING_REPORT_HOUR]));

    const map = new Map(rows.map((r) => [r.key, r.value]));
    const rawDays = map.get(SETTING_REPORT_DAYS);
    const rawHour = map.get(SETTING_REPORT_HOUR);

    // undefined means never configured -> default. Empty string means OFF, and
    // those are deliberately different.
    const daysStr = rawDays === undefined ? DEFAULT_DAYS : rawDays;
    if (daysStr.trim() === '') return { days: [], hour: DEFAULT_HOUR, off: true };

    const days = daysStr.split(',').map((d) => parseInt(d.trim(), 10)).filter((n) => n >= 0 && n <= 6);
    const hour = rawHour !== undefined && !isNaN(parseInt(rawHour, 10))
      ? Math.min(23, Math.max(0, parseInt(rawHour, 10)))
      : DEFAULT_HOUR;

    return { days: days.length ? days : [], hour, off: days.length === 0 };
  } catch (error) {
    // Fail to the previous behaviour rather than silently stopping the report.
    console.warn('[Email Scheduler] could not read cadence, using default:', (error as Error).message);
    return { days: [1, 3, 5], hour: DEFAULT_HOUR, off: false };
  }
}

function getTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

async function checkAndSendScheduledEmail() {
  try {
    const cadence = await readCadence();
    if (cadence.off) return;

    const now = new Date();
    if (!cadence.days.includes(now.getDay())) return;
    // Five-minute window because the check runs every 60s; anything narrower
    // could be missed if a tick is delayed.
    if (now.getHours() !== cadence.hour || now.getMinutes() >= 5) return;

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

  console.log('[Email Scheduler] Starting email scheduler (cadence read from settings on each check)');
  
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
