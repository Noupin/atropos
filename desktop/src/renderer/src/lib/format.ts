const VIEW_UNITS = [
  { value: 1_000_000_000, suffix: 'B' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000, suffix: 'K' }
] as const;

export function formatViews(views: number): string {
  const absolute = Math.abs(views);

  for (const unit of VIEW_UNITS) {
    if (absolute >= unit.value) {
      const result = views / unit.value;
      const formatted = result.toFixed(result < 10 ? 1 : 0).replace(/\.0$/, '');
      return `${formatted}${unit.suffix}`;
    }
  }

  return Math.round(views).toLocaleString();
}

const RELATIVE_UNITS: Array<{
  limit: number;
  divisor: number;
  unit: Intl.RelativeTimeFormatUnit;
}> = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 60 * 60, divisor: 60, unit: 'minute' },
  { limit: 60 * 60 * 24, divisor: 60 * 60, unit: 'hour' },
  { limit: 60 * 60 * 24 * 7, divisor: 60 * 60 * 24, unit: 'day' },
  { limit: 60 * 60 * 24 * 30, divisor: 60 * 60 * 24 * 7, unit: 'week' },
  { limit: 60 * 60 * 24 * 365, divisor: 60 * 60 * 24 * 30, unit: 'month' },
  { limit: Number.POSITIVE_INFINITY, divisor: 60 * 60 * 24 * 365, unit: 'year' }
];

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(iso: string): string {
  const timestamp = new Date(iso);
  if (Number.isNaN(timestamp.getTime())) {
    return '';
  }

  const diffSeconds = (timestamp.getTime() - Date.now()) / 1000;
  const absDiff = Math.abs(diffSeconds);

  if (absDiff < 1) {
    return relativeFormatter.format(0, 'second');
  }

  for (const { limit, divisor, unit } of RELATIVE_UNITS) {
    if (absDiff < limit) {
      const value = Math.round(diffSeconds / divisor);
      return relativeFormatter.format(value, unit);
    }
  }

  return relativeFormatter.format(Math.round(diffSeconds / 31557600), 'year');
}

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (value: number): string => value.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${minutes}:${pad(seconds)}`;
}
