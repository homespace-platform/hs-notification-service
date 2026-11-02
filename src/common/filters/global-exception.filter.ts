import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode } from '../constants/error-code.constant';
import { ApiResponseDto } from '../dto/api-response.dto';
import { AppException } from '../exceptions/app.exception';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      const error = exception.definition;
      response
        .status(error.statusCode)
        .json(new ApiResponseDto({ code: error.code, message: error.message }));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const error =
        status === 401
          ? ErrorCode.UNAUTHENTICATED
          : status === 404
            ? ErrorCode.ROUTE_NOT_FOUND
            : { code: 1001, message: exception.message, statusCode: status };

      response
        .status(error.statusCode)
        .json(new ApiResponseDto({ code: error.code, message: error.message }));
      return;
    }

    this.logger.error(exception);
    response.status(500).json(
      new ApiResponseDto({
        code: ErrorCode.UNCATEGORIZED_EXCEPTION.code,
        message: ErrorCode.UNCATEGORIZED_EXCEPTION.message,
      }),
    );
  }
}
