import { readFileSync } from 'node:fs';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';

let initialized = false;

export function initHttp(): void {
  if (initialized) return;
  initialized = true;

  const caCerts = process.env.NODE_EXTRA_CA_CERTS;
  let ca: Buffer | undefined;
  if (caCerts) {
    try {
      ca = readFileSync(caCerts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`warning: NODE_EXTRA_CA_CERTS=${caCerts} could not be read: ${msg}\n`);
    }
  }

  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      factory: (origin, opts) => new Agent({ ...opts, connect: { ...(opts as any)?.connect, ca } }),
    }),
  );
}

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

export async function request<T = unknown>(url: string, opts: RequestOpts = {}): Promise<T> {
  initHttp();
  const u = new URL(url);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  const method = opts.method ?? 'GET';

  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(u.toString(), {
      method,
      headers: opts.headers,
      body: opts.body,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    throw wrapFetchError(method, u, err);
  }

  try {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(res.status, `${method} ${u.pathname} → ${res.status}: ${text.slice(0, 500)}`);
    }

    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  } finally {
    clearTimeout(timeout);
  }
}

function wrapFetchError(method: string, u: URL, err: unknown): Error {
  const e = err as { message?: string; cause?: unknown; name?: string };
  const cause = e?.cause as { code?: string; message?: string; name?: string } | undefined;

  const reason = cause?.code ?? cause?.name ?? cause?.message ?? e?.message ?? String(err);
  const detail = cause?.message && cause.message !== reason ? ` — ${cause.message}` : '';
  const hint = hintForCode(reason);

  return new Error(
    `${method} ${u.host}${u.pathname} failed: ${reason}${detail}${hint ? `\n  hint: ${hint}` : ''}`,
  );
}

function hintForCode(reason: string): string | null {
  const r = reason.toLowerCase();
  if (r.includes('enotfound') || r.includes('eai_again')) {
    return 'DNS-Lookup gescheitert — Hostname falsch, oder Corp-Proxy nötig (HTTPS_PROXY).';
  }
  if (r.includes('econnrefused')) return 'Verbindung abgelehnt — Service down oder falscher Port.';
  if (r.includes('etimedout') || r.includes('connect_timeout')) {
    return 'Timeout — Firewall, Proxy oder Service unerreichbar.';
  }
  if (r.includes('cert') || r.includes('self_signed') || r.includes('unable_to_verify')) {
    return 'TLS-Cert-Validation fehlgeschlagen — setze NODE_EXTRA_CA_CERTS auf euer Corp-CA-Bundle.';
  }
  if (r.includes('aborted')) return 'Abgebrochen — Timeout zu kurz oder Endpoint hängt.';
  return null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function basic(username: string, password: string): Record<string, string> {
  const enc = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return { authorization: `Basic ${enc}` };
}
