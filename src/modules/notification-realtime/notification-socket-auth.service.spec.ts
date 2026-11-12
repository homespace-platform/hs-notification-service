import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { NotificationSocketAuthService } from './notification-socket-auth.service';

describe('NotificationSocketAuthService', () => {
  let server: Server;
  let issuer: string;
  let auth: NotificationSocketAuthService;
  let key: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: 'test',
      alg: 'RS256',
      use: 'sig',
    };
    server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test port');
    issuer = `http://127.0.0.1:${address.port}/realms/test`;
    auth = new NotificationSocketAuthService(
      new ConfigService({
        NOTIFICATION_REALTIME_ENABLED: true,
        KEYCLOAK_ISSUER_URL: issuer,
        KEYCLOAK_AUDIENCE: 'notifications',
        NOTIFICATION_REALTIME_ORIGINS: 'https://app.example',
      }),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const token = (
    claims: {
      iss?: string;
      aud?: string;
      sub?: string;
      exp?: number;
      typ?: string;
    } = {},
  ) =>
    new SignJWT({ typ: claims.typ ?? 'Bearer' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(claims.sub ?? 'alice')
      .setIssuer(claims.iss ?? issuer)
      .setAudience(claims.aud ?? 'notifications')
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? Math.floor(Date.now() / 1000) + 60)
      .sign(key);

  it('derives the room identity from a verified access token', async () => {
    await expect(
      auth.authenticate('https://app.example', await token()),
    ).resolves.toMatchObject({ userId: 'alice' });
  });

  it('rejects missing/unlisted origins and spoofed or expired credentials', async () => {
    const valid = await token();
    for (const origin of [
      undefined,
      'https://evil.example',
      'https://app.example.evil',
    ]) {
      await expect(auth.authenticate(origin, valid)).rejects.toThrow();
    }
    for (const bad of [
      undefined,
      'alice',
      `${valid.slice(0, -8)}invalid!`,
      await token({ exp: 1 }),
      await token({ aud: 'other' }),
      await token({ iss: 'https://other.example' }),
      await token({ typ: 'ID' }),
    ]) {
      await expect(
        auth.authenticate('https://app.example', bad),
      ).rejects.toThrow();
    }
  });

  it('fails closed when disabled and rejects wildcard origin config', async () => {
    const disabled = new NotificationSocketAuthService(new ConfigService({}));
    await expect(
      disabled.authenticate('https://app.example', await token()),
    ).rejects.toThrow();
    expect(
      () =>
        new NotificationSocketAuthService(
          new ConfigService({
            NOTIFICATION_REALTIME_ENABLED: true,
            KEYCLOAK_ISSUER_URL: issuer,
            KEYCLOAK_AUDIENCE: 'notifications',
            NOTIFICATION_REALTIME_ORIGINS: '*',
          }),
        ),
    ).toThrow();
  });
});
