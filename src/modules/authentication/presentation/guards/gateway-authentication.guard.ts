import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UserContext } from '../../domain/user-context';

type AuthenticatedRequest = Request & { user?: UserContext };

@Injectable()
export class GatewayAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = this.header(request, 'x-user-id');

    if (!userId) throw new UnauthorizedException('Unauthenticated');

    const authorities = this.header(request, 'x-user-authorities');
    request.user = {
      userId,
      email: this.header(request, 'x-user-email'),
      name:
        this.decodeDisplayName(this.header(request, 'x-user-name-b64')) ??
        this.header(request, 'x-user-name'),
      role: this.header(request, 'x-user-role'),
      authorities: authorities
        ? authorities
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
    };
    return true;
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    const normalized = Array.isArray(value) ? value[0] : value;
    return normalized?.trim() || undefined;
  }

  private decodeDisplayName(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      return Buffer.from(value, 'base64').toString('utf8') || undefined;
    } catch {
      return undefined;
    }
  }
}
