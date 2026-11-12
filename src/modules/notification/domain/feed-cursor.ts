import { ErrorCode } from '../../../common/constants/error-code.constant';
import { AppException } from '../../../common/exceptions/app.exception';
import type { FeedCursor } from './notification.model';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/;
const MAX_CURSOR_LENGTH = 128;

export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

/** Opaque keyset cursor: createdAt (epoch ms) + _id. Never contains user data. */
export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.getTime(), i: cursor.id }),
  ).toString('base64url');
}

export function decodeCursor(raw: string): FeedCursor {
  if (raw.length > MAX_CURSOR_LENGTH) {
    throw new AppException(ErrorCode.INVALID_CURSOR);
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    const { c, i } = parsed as { c?: unknown; i?: unknown };
    if (
      typeof c === 'number' &&
      Number.isSafeInteger(c) &&
      !Number.isNaN(new Date(c).getTime()) &&
      isObjectIdString(i)
    ) {
      return { createdAt: new Date(c), id: i };
    }
  } catch {
    // fall through to the generic invalid-cursor error
  }
  throw new AppException(ErrorCode.INVALID_CURSOR);
}
