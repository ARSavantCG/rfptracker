/**
 * Centralized Date Utilities for RFP Tracker
 * 
 * CRITICAL: All date handling must go through these utilities to prevent timezone issues
 * 
 * TIMEZONE POLICY:
 * - All dates in the system are treated as local dates (no timezone conversion)
 * - When user enters "July 30, 2025", it stays "July 30, 2025" everywhere
 * - No automatic timezone conversion on display or storage
 */

/**
 * Parses a date string (YYYY-MM-DD) into a local Date object without timezone conversion
 */
export function parseLocalDate(dateString: string): Date {
  if (!dateString) throw new Error('Date string is required');
  
  // Handle YYYY-MM-DD format
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day); // month is 0-indexed
  }
  
  throw new Error(`Unsupported date format: ${dateString}. Use YYYY-MM-DD format.`);
}

/**
 * Converts a Date object to YYYY-MM-DD format for form inputs
 */
export function formatDateForInput(date: Date | string | null): string {
  if (!date) return '';
  
  let dateObj: Date;
  
  if (typeof date === 'string') {
    // Handle ISO string from database - avoid timezone conversion
    if (date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      // Extract date part to avoid timezone conversion
      const datePart = date.split('T')[0];
      const [year, month, day] = datePart.split('-').map(Number);
      dateObj = new Date(year, month - 1, day);
    } 
    // Handle YYYY-MM-DD format
    else if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = date.split('-').map(Number);
      dateObj = new Date(year, month - 1, day);
    } 
    else {
      dateObj = new Date(date);
    }
  } else {
    dateObj = new Date(date);
  }
  
  if (isNaN(dateObj.getTime())) {
    console.warn('Invalid date passed to formatDateForInput:', date);
    return '';
  }
  
  // Use local date components to avoid timezone issues
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Formats a date for display (e.g., "Jul 30, 2025")
 */
export function formatDateForDisplay(date: Date | string | null): string {
  if (!date) return 'N/A';
  
  // For string dates, work directly with the date components to avoid any timezone issues
  if (typeof date === 'string') {
    // Handle ISO string from database (e.g., "2025-08-08T00:00:00.000Z")
    if (date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      // Extract date part and parse directly without Date object conversion
      const datePart = date.split('T')[0];
      const [year, month, day] = datePart.split('-').map(Number);
      
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      return `${monthNames[month - 1]} ${day}, ${year}`;
    } 
    // Handle YYYY-MM-DD format
    else if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = date.split('-').map(Number);
      
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      return `${monthNames[month - 1]} ${day}, ${year}`;
    } 
  }
  
  // Fallback to Date object for non-string dates
  let dateObj: Date;
  if (typeof date === 'string') {
    dateObj = new Date(date);
  } else {
    dateObj = new Date(date);
  }
  
  if (isNaN(dateObj.getTime())) {
    console.warn('Invalid date passed to formatDateForDisplay:', date);
    return 'Invalid Date';
  }
  
  // Use local date components to avoid timezone shifts
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  
  return `${monthNames[month]} ${day}, ${year}`;
}

/**
 * Converts form data dates to Date objects for database storage
 */
export function convertFormDateToDbDate(dateString: string): Date {
  if (!dateString) throw new Error('Date string is required');
  return parseLocalDate(dateString);
}

/**
 * Gets current date in YYYY-MM-DD format for default form values
 */
export function getCurrentDateString(): string {
  const now = new Date();
  return formatDateForInput(now);
}

/**
 * Validates if a date string is in correct format
 */
export function isValidDateString(dateString: string): boolean {
  if (!dateString) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
}

/**
 * Admin helper to check timezone configuration
 */
export function getTimezoneInfo(): {
  userTimezone: string;
  currentTime: string;
  sampleDate: string;
  recommendations: string[];
} {
  const now = new Date();
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  return {
    userTimezone,
    currentTime: now.toLocaleString(),
    sampleDate: formatDateForDisplay(now),
    recommendations: [
      'All dates are stored and displayed as local dates',
      'No timezone conversion is applied to user-entered dates',
      'Date format: YYYY-MM-DD for input, MMM DD, YYYY for display',
      `Your browser timezone: ${userTimezone}`
    ]
  };
}
/**
 * The business timezone for everything this app displays.
 *
 * The server runs in UTC. Any `toLocaleString()` without an explicit zone
 * therefore renders UTC, so an RFP published at 10pm Eastern was reported as
 * 2am the next day - a four hour error that also moved it to the wrong DATE,
 * which matters on a due-date report.
 *
 * Fixed to Eastern rather than read from the server: the portfolio is in South
 * Florida, and a timestamp on a document should mean the same thing to everyone
 * reading it regardless of where the process happens to run. Handles DST
 * automatically via the IANA zone.
 */
export const BUSINESS_TIMEZONE = 'America/New_York';

/** Date and time, e.g. "Aug 19, 2026, 10:04 PM". */
export function formatBusinessDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** Date only, e.g. "August 19, 2026". */
export function formatBusinessDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
