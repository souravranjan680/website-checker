import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines CSS class names and resolves Tailwind conflicts.
 * cn('px-2', isActive && 'bg-muted', 'px-4') → 'bg-muted px-4'
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
