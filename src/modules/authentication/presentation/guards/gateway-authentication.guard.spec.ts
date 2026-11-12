import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../../common/constants/error-code.constant';
import { GatewayAuthenticationGuard } from './gateway-authentication.guard';

const SECRET = 'test-only-internal-gateway-secret-32';

function guard(secret: string | null = SECRET) {
  const config = {
    getOrThrow: (key: string) => {
      if (key !== 'GATEWAY_INTERNAL_SECRET' || secret === null) {
        throw new Error('missing');
      }
      return secret;
    },
  } as unknown as ConfigService;
  return new GatewayAuthenticationGuard(config);
}

function context(headers: Record<string, string | string[]>) {
  const request: { headers: typeof headers; user?: unknown } = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('GatewayAuthenticationGuard', () => {
  it('refuses to start without a configured secret', () => {
    expect(() => guard(null)).toThrow();
  });

  it('rejects a spoofed X-User-Id sent directly without the internal secret', () => {
    const { ctx, request } = context({ 'x-user-id': 'victim-user' });
    expect(() => guard().canActivate(ctx)).toThrow(
      expect.objectContaining({ definition: ErrorCode.UNAUTHENTICATED }),
    );
    expect(request.user).toBeUndefined();
  });

  it.each([
    ['wrong', 'x'.repeat(SECRET.length)],
    ['wrong length', 'short'],
    ['prefix of the secret', SECRET.slice(0, -1)],
    ['secret with suffix', `${SECRET}x`],
    ['empty', ''],
  ])('rejects %s X-Internal-Secret', (_label, secret) => {
    const { ctx, request } = context({
      'x-user-id': 'victim-user',
      'x-internal-secret': secret,
    });
    expect(() => guard().canActivate(ctx)).toThrow(
      expect.objectContaining({ definition: ErrorCode.UNAUTHENTICATED }),
    );
    expect(request.user).toBeUndefined();
  });

  it('rejects a repeated secret header', () => {
    const { ctx } = context({
      'x-user-id': 'u1',
      'x-internal-secret': [SECRET, SECRET],
    });
    expect(() => guard().canActivate(ctx)).toThrow(
      expect.objectContaining({ definition: ErrorCode.UNAUTHENTICATED }),
    );
  });

  it('rejects a valid secret without a user id', () => {
    const { ctx } = context({ 'x-internal-secret': SECRET });
    expect(() => guard().canActivate(ctx)).toThrow(
      expect.objectContaining({ definition: ErrorCode.UNAUTHENTICATED }),
    );
  });

  it('trusts identity headers only with the correct secret', () => {
    const { ctx, request } = context({
      'x-internal-secret': SECRET,
      'x-user-id': 'user-1',
      'x-user-role': 'USER',
      'x-user-authorities': 'A, B',
    });
    expect(guard().canActivate(ctx)).toBe(true);
    expect(request.user).toEqual({
      userId: 'user-1',
      email: undefined,
      name: undefined,
      role: 'USER',
      authorities: ['A', 'B'],
    });
  });
});
