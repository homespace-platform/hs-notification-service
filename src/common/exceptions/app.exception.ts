import { HttpException } from '@nestjs/common';
import type { ErrorDefinition } from '../constants/error-code.constant';

export class AppException extends HttpException {
  constructor(public readonly definition: ErrorDefinition) {
    super(definition.message, definition.statusCode);
  }
}
