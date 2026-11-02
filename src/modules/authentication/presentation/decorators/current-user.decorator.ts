import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UserContext } from '../../domain/user-context';

type AuthenticatedRequest = Request & { user: UserContext };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserContext =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
