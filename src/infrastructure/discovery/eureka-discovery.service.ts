import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type EurekaPort = { $?: number | string; '@enabled'?: string | boolean } | number | string;
type EurekaInstance = { status?: string; ipAddr?: string; hostName?: string; port?: EurekaPort };

const CACHE_MS = 30_000;

/** Finds another service's base URL through the Eureka server the service already registers with. */
@Injectable()
export class EurekaDiscoveryService {
  private readonly eurekaBaseUrl: string;
  private readonly cache = new Map<string, { urls: string[]; expiresAt: number }>();

  constructor(config: ConfigService) {
    this.eurekaBaseUrl = config.getOrThrow<string>('EUREKA_CLIENT_SERVICE_URL').replace(/\/$/, '');
  }

  /** A base URL (http://ip:port) of one UP instance; throws when the app has no UP instance. */
  async resolve(appName: string): Promise<string> {
    const key = appName.toUpperCase();
    const cached = this.cache.get(key);
    let urls = cached && cached.expiresAt > Date.now() ? cached.urls : undefined;
    if (!urls) {
      urls = await this.fetchUrls(key);
      this.cache.set(key, { urls, expiresAt: Date.now() + CACHE_MS });
    }
    if (urls.length === 0) throw new Error(`No UP instance of ${key} in Eureka`);
    return urls[Math.floor(Math.random() * urls.length)];
  }

  /** Drops the cached instances, e.g. after a call to one of them failed. */
  forget(appName: string): void {
    this.cache.delete(appName.toUpperCase());
  }

  private async fetchUrls(app: string): Promise<string[]> {
    const res = await fetch(`${this.eurekaBaseUrl}/apps/${encodeURIComponent(app)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Eureka HTTP ${res.status}`);
    const body = (await res.json()) as { application?: { instance?: EurekaInstance | EurekaInstance[] } };
    const raw = body.application?.instance;
    const instances = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return instances
      .filter((i) => i.status === 'UP')
      .map((i) => {
        const host = i.ipAddr || i.hostName;
        const port = typeof i.port === 'object' ? i.port?.$ : i.port;
        return host && port ? `http://${host}:${port}` : '';
      })
      .filter(Boolean);
  }
}
