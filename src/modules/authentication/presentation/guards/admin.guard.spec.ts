import type { ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '../../../../common/constants/error-code.constant';
import { AdminGuard } from './admin.guard';

function context(role: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: 'user-1', role, authorities: [] } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  it('rejects an authenticated non-admin user', () => {
    expect(() => new AdminGuard().canActivate(context('USER'))).toThrow(
      expect.objectContaining({ definition: ErrorCode.UNAUTHORIZED }),
    );
  });

  it('allows an admin user', () => {
    expect(new AdminGuard().canActivate(context('ADMIN'))).toBe(true);
  });
});
