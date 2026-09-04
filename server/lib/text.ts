import crypto from 'node:crypto';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cleanText(value: unknown, maxLength = 240): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'website';
}

export function createScanSlug(domain: string): string {
  const base = slugify(domain.replace(/^www\./, '').split('.')[0] || domain);
  const suffix = crypto.randomBytes(3).toString('base64url').toLowerCase();
  return `${base}-${suffix}`;
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
