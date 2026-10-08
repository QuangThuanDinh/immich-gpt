const EXPLICIT_TIMEZONE = /(Z|[+-]\d{2}:\d{2})$/i;

export function parseApiDateTime(value: string | Date): Date {
  if (value instanceof Date) return value;
  const normalized = EXPLICIT_TIMEZONE.test(value) ? value : `${value}Z`;
  return new Date(normalized);
}

export function formatDateTime(value: string | Date, timezone: string): string {
  const date = parseApiDateTime(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleString(undefined, { timeZone: timezone });
}
