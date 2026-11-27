import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Resolves recipient addresses on demand; addresses never travel through Kafka or Mongo. */
export abstract class UserEmailDirectory {
  /** Active users only; unknown or inactive ids are simply absent. Throws if the directory is unreachable. */
  abstract resolve(userIds: string[]): Promise<Map<string, string>>;
}

/** Core's service-to-service /internal API, guarded by the shared GATEWAY_INTERNAL_SECRET (not routable via the Gateway). */
@Injectable()
export class CoreUserEmailDirectory extends UserEmailDirectory {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async resolve(userIds: string[]): Promise<Map<string, string>> {
    const base = this.config.getOrThrow<string>('CORE_INTERNAL_BASE_URL');
    const res = await fetch(`${base}/internal/users/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': this.config.getOrThrow<string>(
          'GATEWAY_INTERNAL_SECRET',
        ),
      },
      body: JSON.stringify({ userIds }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`User directory HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: { userId: string; email: string }[];
    };
    return new Map((body.result ?? []).map((u) => [u.userId, u.email]));
  }
}
