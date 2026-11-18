/**
 * @fileoverview Class-name helper used by every UI component.
 *
 * Layer: client library (browser only).
 */
import {clsx, type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';

/**
 * Joins class names and resolves conflicting Tailwind classes, so the last
 * one wins (for example `cn('p-2', isLarge && 'p-4')` gives `p-4` when large).
 *
 * @param inputs Class names, arrays, or objects mapping class names to
 *     booleans. Falsy values are skipped.
 * @returns One class string.
 * @example
 * <div className={cn('rounded-md', isActive && 'bg-primary', className)} />
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
