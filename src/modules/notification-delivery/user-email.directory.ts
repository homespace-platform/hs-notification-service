import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EurekaDiscoveryService } from '../../infrastructure/discovery/eureka-discovery.service';

/** Core's Eureka application name (spring.application.name of hs-core-api). */
export const CORE_APP_NAME = 'HS-CORE-API';

/** Resolves recipient addresses on demand; addresses never travel through Kafka or Mongo. */
export abstract class UserEmailDirectory {
  /** Active users only; unknown or inactive ids are simply absent. Throws if the directory is unreachable. */
  abstract resolve(userIds: string[]): Promise<Map<string, string>>;
}

/** Core's service-to-service /internal API (found through Eureka), guarded by the shared GATEWAY_INTERNAL_SECRET (not routable via the Gateway). */
@Injectable()
export class CoreUserEmailDirectory extends UserEmailDirectory {
  constructor(
    private readonly config: ConfigService,
    private readonly discovery: EurekaDiscoveryService,
  ) {
    super();
  }

  async resolve(userIds: string[]): Promise<Map<string, string>> {
    const base = await this.discovery.resolve(CORE_APP_NAME);
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
    if (!res.ok) {
      if (res.status >= 500) this.discovery.forget(CORE_APP_NAME);
      throw new Error(`User directory HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      result?: { userId: string; email: string }[];
    };
    return new Map((body.result ?? []).map((u) => [u.userId, u.email]));
  }
}
