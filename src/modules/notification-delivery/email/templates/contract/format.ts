const TZ = 'Asia/Ho_Chi_Minh';
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const fmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** First allow-listed key holding a non-empty string or finite number (never walks other keys). */
export function pick(data: Readonly<Record<string, unknown>>, keys: string[]): string | number | undefined {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** ISO instant / epoch ms / yyyy-MM-dd -> "dd/MM/yyyy" or "HH:mm dd/MM/yyyy" in ICT; undefined when unparsable. */
export function formatVnDate(value: string | number | undefined, withTime: boolean): string | undefined {
  if (value === undefined) return undefined;
  const dateOnly = typeof value === 'string' ? DATE_ONLY.exec(value) : null;
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const day = `${p.day}/${p.month}/${p.year}`;
  return withTime ? `${p.hour}:${p.minute} ${day}` : day;
}

/** Non-negative number or numeric string -> "1.500.000 ₫"; undefined otherwise. */
export function formatVnd(value: string | number | undefined): string | undefined {
  const n = typeof value === 'string' ? (/^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN) : value;
  if (n === undefined || !Number.isFinite(n) || n < 0) return undefined;
  return `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
}
