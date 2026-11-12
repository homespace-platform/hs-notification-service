import type { NotificationMetadata } from './notification.model';

const ACTION_PATH_MAX = 500;
// Same-origin relative path only: one leading "/", no scheme, no backslash,
// no whitespace/control characters (blocks "//host", "/\host", "javascript:").
const ACTION_PATH_PATTERN = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;
const TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const METADATA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const METADATA_MAX_KEYS = 20;
const METADATA_MAX_STRING = 200;

export const TITLE_MAX = 200;
export const BODY_MAX = 2000;
export const SOURCE_EVENT_ID_MAX = 200;

export function isSafeActionPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= ACTION_PATH_MAX &&
    ACTION_PATH_PATTERN.test(value) &&
    !value.includes('://') &&
    !/(^|\/)\.\.(\/|$|\?|#)/.test(value)
  );
}

export function isValidType(value: unknown): value is string {
  return typeof value === 'string' && TYPE_PATTERN.test(value);
}

export function isSafeMetadata(value: unknown): value is NotificationMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length > METADATA_MAX_KEYS) return false;
  return entries.every(([key, item]) => {
    if (!METADATA_KEY_PATTERN.test(key)) return false;
    if (typeof item === 'string') return item.length <= METADATA_MAX_STRING;
    if (typeof item === 'number') return Number.isFinite(item);
    return typeof item === 'boolean';
  });
}
