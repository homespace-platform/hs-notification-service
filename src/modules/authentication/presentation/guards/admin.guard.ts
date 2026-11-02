import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../../../common/constants/error-code.constant';
import { AppException } from '../../../../common/exceptions/app.exception';
import type { UserContext } from '../../domain/user-context';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: UserContext }>();
    if (request.user?.role !== 'ADMIN') {
      throw new AppException(ErrorCode.UNAUTHORIZED);
    }
    return true;
  }
}
