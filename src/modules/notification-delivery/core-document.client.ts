import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EurekaDiscoveryService } from '../../infrastructure/discovery/eureka-discovery.service';
import type { AttachmentKind } from './email/email-spec';
import { CORE_APP_NAME } from './user-email.directory';

const TIMEOUT_MS = 30_000;

export interface DocumentFile {
  fileName: string;
  contentBase64: string;
}

/**
 * ok: files to attach. not-ready: Core has not produced the PDF yet (retry later).
 * unavailable: will not become available (404/403/413/422 or an unusable answer): send without it.
 */
export type DocumentResult =
  | { outcome: 'ok'; files: DocumentFile[] }
  | { outcome: 'not-ready' }
  | { outcome: 'unavailable'; status: number };

/** Thrown for network errors, timeouts, 429 and 5xx: the caller may retry. */
export class DocumentFetchError extends Error {
  constructor(readonly status?: number) {
    super('Document fetch failed');
    this.name = 'DocumentFetchError';
  }
}

const SEGMENT: Record<AttachmentKind, { path: string; idKey: string }> = {
  RENTAL_RECEIPT: { path: 'rental-receipts', idKey: 'receiptId' },
  MEMBERSHIP_RECEIPT: { path: 'membership-receipts', idKey: 'orderId' },
  OVERPAYMENT_RECEIPT: { path: 'overpayment-receipts', idKey: 'overpaymentId' },
  LEASE_BUNDLE: { path: 'lease-bundles', idKey: 'contractId' },
};

/** What to ask Core for: `skip` = nothing is expected for this event, `missing` = expected but the event carries no id. */
export function documentTarget(
  kind: AttachmentKind,
  data: Readonly<Record<string, unknown>>,
): { path: string; id: string } | 'skip' | 'missing' {
  // Core event data names it `agreementKind`; `agreementType` is accepted too.
  if (kind === 'LEASE_BUNDLE' && (data.agreementType ?? data.agreementKind) !== 'LEASE') return 'skip';
  const { path, idKey } = SEGMENT[kind];
  const id = data[idKey];
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id) ? { path, id } : 'missing';
}

/** Port so the dispatcher is testable without Core. */
export abstract class DocumentClient {
  abstract fetch(path: string, id: string, recipientId: string): Promise<DocumentResult>;
}

/** Core's service-to-service document API (found through Eureka, guarded by GATEWAY_INTERNAL_SECRET). File contents are never logged. */
@Injectable()
export class CoreDocumentClient extends DocumentClient {
  private readonly logger = new Logger(CoreDocumentClient.name);
  constructor(
    private readonly config: ConfigService,
    private readonly discovery: EurekaDiscoveryService,
  ) {
    super();
  }

  async fetch(path: string, id: string, recipientId: string): Promise<DocumentResult> {
    let res: Response;
    try {
      const base = await this.discovery.resolve(CORE_APP_NAME);
      res = await fetch(
        `${base}/internal/documents/${path}/${encodeURIComponent(id)}?recipientId=${encodeURIComponent(recipientId)}`,
        {
          headers: { 'X-Internal-Secret': this.config.getOrThrow<string>('GATEWAY_INTERNAL_SECRET') },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch {
      this.discovery.forget(CORE_APP_NAME);
      throw new DocumentFetchError();
    }
    if (res.status === 409) return { outcome: 'not-ready' };
    if (res.status === 429 || res.status >= 500) {
      this.discovery.forget(CORE_APP_NAME);
      throw new DocumentFetchError(res.status);
    }
    if (!res.ok) {
      this.logger.warn(`Document ${path} unavailable: HTTP ${res.status}`);
      return { outcome: 'unavailable', status: res.status };
    }
    const files = await res
      .json()
      .then((body: { files?: unknown }) => body.files)
      .catch(() => undefined);
    const valid =
      Array.isArray(files) &&
      files.length > 0 &&
      files.every((f) => typeof f?.fileName === 'string' && f.fileName.trim() && typeof f?.contentBase64 === 'string' && f.contentBase64);
    if (!valid) {
      this.logger.warn(`Document ${path} unavailable: unusable response`);
      return { outcome: 'unavailable', status: 200 };
    }
    return {
      outcome: 'ok',
      files: (files as DocumentFile[]).map((f) => ({ fileName: f.fileName, contentBase64: f.contentBase64 })),
    };
  }
}
