import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveAdvertisedHost } from '../network/network-address.resolver';

@Injectable()
export class EurekaService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EurekaService.name);
  private readonly serviceName: string;
  private readonly instanceId: string;
  private readonly instanceUrl: string;
  private readonly registrationUrl: string;
  private heartbeatTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(config: ConfigService) {
    this.serviceName = config.getOrThrow<string>('SERVICE_NAME').toUpperCase();
    const hostname = resolveAdvertisedHost(
      config.getOrThrow<string>('EUREKA_INSTANCE_HOSTNAME'),
    );
    const port = config.getOrThrow<number>('PORT');
    const eurekaBaseUrl = config
      .getOrThrow<string>('EUREKA_CLIENT_SERVICE_URL')
      .replace(/\/$/, '');

    this.instanceId = `${hostname}:${config.getOrThrow<string>('SERVICE_NAME')}:${port}`;
    this.instanceUrl = `http://${hostname}:${port}`;
    this.registrationUrl = `${eurekaBaseUrl}/apps/${this.serviceName}`;
  }

  onModuleInit(): void {
    void this.register();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 30_000);
    this.heartbeatTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    try {
      await fetch(
        `${this.registrationUrl}/${encodeURIComponent(this.instanceId)}`,
        { method: 'DELETE' },
      );
    } catch (error) {
      this.logger.warn(
        `Cannot deregister from Eureka: ${this.errorMessage(error)}`,
      );
    }
  }

  private async register(): Promise<void> {
    if (this.stopped) return;

    const url = new URL(this.instanceUrl);
    const response = await this.safeFetch(this.registrationUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instance: {
          instanceId: this.instanceId,
          app: this.serviceName,
          vipAddress: this.serviceName.toLowerCase(),
          secureVipAddress: this.serviceName.toLowerCase(),
          hostName: url.hostname,
          ipAddr: url.hostname,
          status: 'UP',
          port: { $: Number(url.port), '@enabled': true },
          securePort: { $: 443, '@enabled': false },
          homePageUrl: `${this.instanceUrl}/`,
          statusPageUrl: `${this.instanceUrl}/ping`,
          healthCheckUrl: `${this.instanceUrl}/ping`,
          dataCenterInfo: {
            '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
            name: 'MyOwn',
          },
          metadata: {},
        },
      }),
    });

    if (response?.ok) {
      this.logger.log(`Registered ${this.instanceId} with Eureka`);
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.stopped) return;
    const response = await this.safeFetch(
      `${this.registrationUrl}/${encodeURIComponent(this.instanceId)}`,
      { method: 'PUT' },
    );
    if (response?.status === 404) await this.register();
  }

  private async safeFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response | undefined> {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok && response.status !== 404) {
        this.logger.warn(`Eureka returned HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      this.logger.warn(`Eureka is unavailable: ${this.errorMessage(error)}`);
      return undefined;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
