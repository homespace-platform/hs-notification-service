import type { PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../../common/constants/error-code.constant';
import { AppException } from '../../../common/exceptions/app.exception';
import { isObjectIdString } from '../domain/feed-cursor';

/** Malformed ids are reported exactly like unknown ids (no oracle, no CastError). */
@Injectable()
export class NotificationIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isObjectIdString(value)) {
      throw new AppException(ErrorCode.NOTIFICATION_NOT_FOUND);
    }
    return value;
  }
}
