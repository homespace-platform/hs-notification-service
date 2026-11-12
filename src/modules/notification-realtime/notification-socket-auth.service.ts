import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

@Injectable()
export class NotificationSocketAuthService {
  private readonly issuer?: string;
  private readonly audience?: string;
  private readonly origins = new Set<string>();
  private readonly keys?: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: ConfigService) {
    if (config.get('NOTIFICATION_REALTIME_ENABLED') !== true) return;
    this.issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER_URL');
    this.audience = config.getOrThrow<string>('KEYCLOAK_AUDIENCE');
    for (const origin of config
      .getOrThrow<string>('NOTIFICATION_REALTIME_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean))
      this.origins.add(origin);
    if (!this.origins.size || this.origins.has('*')) {
      throw new Error('Realtime requires explicit allowed origins');
    }
    for (const origin of this.origins) {
      if (new URL(origin).origin !== origin)
        throw new Error('Invalid realtime origin');
    }
    this.keys = createRemoteJWKSet(
      new URL(
        `${this.issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`,
      ),
    );
  }

  async authenticate(
    origin: unknown,
    token: unknown,
  ): Promise<{ userId: string; expiresAt: number }> {
    if (
      !this.keys ||
      typeof origin !== 'string' ||
      !this.origins.has(origin) ||
      typeof token !== 'string' ||
      token.length > 16384
    ) {
      throw new Error('Unauthenticated');
    }
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    if (!payload.sub?.trim() || payload.typ !== 'Bearer')
      throw new Error('Unauthenticated');
    return { userId: payload.sub, expiresAt: payload.exp! * 1000 };
  }
}
