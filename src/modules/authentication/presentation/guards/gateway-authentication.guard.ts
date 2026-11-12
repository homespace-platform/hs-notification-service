import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ErrorCode } from '../../../../common/constants/error-code.constant';
import { AppException } from '../../../../common/exceptions/app.exception';
import type { UserContext } from '../../domain/user-context';

type AuthenticatedRequest = Request & { user?: UserContext };

const INTERNAL_SECRET_HEADER = 'x-internal-secret';
const USER_ID_MAX_LENGTH = 128;

/**
 * Trusts X-User-* identity headers only when the request carries the shared
 * gateway secret (X-Internal-Secret). Direct callers on the service port
 * cannot forge identity without the secret.
 */
@Injectable()
export class GatewayAuthenticationGuard implements CanActivate {
  private readonly secretDigest: Buffer;

  constructor(config: ConfigService) {
    // getOrThrow: never run without a configured secret (no default).
    this.secretDigest = this.digest(
      config.getOrThrow<string>('GATEWAY_INTERNAL_SECRET'),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!this.hasValidInternalSecret(request)) {
      throw new AppException(ErrorCode.UNAUTHENTICATED);
    }

    const userId = this.header(request, 'x-user-id');
    if (!userId || userId.length > USER_ID_MAX_LENGTH) {
      throw new AppException(ErrorCode.UNAUTHENTICATED);
    }

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

  private hasValidInternalSecret(request: Request): boolean {
    const provided = request.headers[INTERNAL_SECRET_HEADER];
    if (typeof provided !== 'string' || provided.length === 0) return false;
    // Equal-length digests keep the comparison constant-time for any input.
    return timingSafeEqual(this.digest(provided), this.secretDigest);
  }

  private digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
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
