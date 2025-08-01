import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Import centralized date utilities
import { formatDateForDisplay } from "@shared/date-utils";

// Re-export the centralized formatDate function
export function formatDate(date: string | Date): string {
  return formatDateForDisplay(date);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Specialized function for Eastern Time formatting (NYC timezone)
export function formatDateEastern(date: string | Date): string {
  if (!date) return 'N/A';
  
  if (typeof date === 'string') {
    // Handle YYYY-MM-DDTHH:MM:SS.sssZ format (ISO with zero time from database)
    if (date.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)) {
      // Extract just the date part to avoid timezone conversion issues
      const datePart = date.split('T')[0];
      const [year, month, day] = datePart.split('-').map(Number);
      
      // Direct formatting without Date object to avoid timezone issues
      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      
      return `${monthNames[month - 1]} ${day}, ${year}`;
    }
    
    // Handle YYYY-MM-DD format
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = date.split('-').map(Number);
      
      // Direct formatting without Date object to avoid timezone issues
      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      
      return `${monthNames[month - 1]} ${day}, ${year}`;
    }
    
    // For other string formats, use Date object with Eastern timezone
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      console.warn('Invalid date passed to formatDateEastern:', date);
      return 'Invalid Date';
    }
    
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
  } else {
    // Handle Date objects with Eastern timezone
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      console.warn('Invalid Date object passed to formatDateEastern:', date);
      return 'Invalid Date';
    }
    
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
  }
}

// Function for Eastern Time with full timestamp formatting
export function formatDateTimeEastern(date: string | Date): string {
  if (!date) return 'N/A';
  
  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    console.warn('Invalid date passed to formatDateTimeEastern:', date);
    return 'Invalid Date';
  }
  
  // Format with date and time in Eastern Time
  return dateObj.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  });
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'received':
      return 'bg-blue-100 text-blue-800';
    case 'in-progress':
      return 'bg-yellow-100 text-yellow-800';
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'on-hold':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function getStatusIcon(status: string): string {
  switch (status) {
    case 'received':
      return 'fas fa-inbox';
    case 'in-progress':
      return 'fas fa-clock';
    case 'completed':
      return 'fas fa-check-circle';
    case 'on-hold':
      return 'fas fa-pause-circle';
    default:
      return 'fas fa-circle';
  }
}

export function getFileIcon(type: string): string {
  if (type.includes('pdf')) return 'fas fa-file-pdf text-red-500';
  if (type.includes('word') || type.includes('document')) return 'fas fa-file-word text-blue-500';
  if (type.includes('excel') || type.includes('sheet')) return 'fas fa-file-excel text-green-500';
  if (type.includes('image')) return 'fas fa-file-image text-purple-500';
  return 'fas fa-file text-gray-500';
}
