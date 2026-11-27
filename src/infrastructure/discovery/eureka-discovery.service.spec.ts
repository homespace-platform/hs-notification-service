import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { EurekaDiscoveryService } from './eureka-discovery.service';

const app = (instance: unknown) => new Response(JSON.stringify({ application: { name: 'HS-CORE-API', instance } }));

describe('EurekaDiscoveryService', () => {
  const discovery = () =>
    new EurekaDiscoveryService(new ConfigService({ EUREKA_CLIENT_SERVICE_URL: 'http://eureka:8761/eureka/' }));

  it('returns an UP instance and asks Eureka for JSON', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      app([
        { status: 'DOWN', ipAddr: '10.0.0.1', port: { $: 8081 } },
        { status: 'UP', ipAddr: '10.0.0.2', port: { $: 8081, '@enabled': 'true' } },
      ]),
    );
    globalThis.fetch = fetchMock;
    await expect(discovery().resolve('hs-core-api')).resolves.toBe('http://10.0.0.2:8081');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://eureka:8761/eureka/apps/HS-CORE-API');
    expect(init.headers).toMatchObject({ Accept: 'application/json' });
  });

  it('accepts a single instance object and caches it until forgotten', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockImplementation(async () => app({ status: 'UP', ipAddr: 'core', port: 8081 }));
    globalThis.fetch = fetchMock;
    const d = discovery();
    await d.resolve('HS-CORE-API');
    await d.resolve('HS-CORE-API');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    d.forget('hs-core-api');
    await d.resolve('HS-CORE-API');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when no instance is UP or the app is unknown', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(app([{ status: 'STARTING', ipAddr: 'x', port: 1 }]));
    await expect(discovery().resolve('HS-CORE-API')).rejects.toThrow('No UP instance');
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(discovery().resolve('HS-CORE-API')).rejects.toThrow('No UP instance');
  });
});
