import http from 'node:http';
import tls from 'node:tls';

/** What the scanner learned about a site's HTTPS certificate. */
export interface TlsFacts {
  host: string;
  port: number;
  /** false when the tunnel or handshake could not be made (blocked, refused, timeout). */
  checked: boolean;
  /** Certificate trusted by Node's CA list and valid for this host name. */
  valid: boolean;
  /** OpenSSL/Node reason when not valid, e.g. CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT. */
  error: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  issuer: string | null;
  subject: string | null;
  protocol: string | null;
}

/** Turns a Node certificate error code into a sentence a user can act on. */
export function describeCertificateError(code: string | null): string {
  switch (code) {
    case 'CERT_HAS_EXPIRED':
      return 'The certificate has expired.';
    case 'CERT_NOT_YET_VALID':
      return 'The certificate is not valid yet (check the server clock or the certificate dates).';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'The certificate is self-signed, so browsers do not trust it.';
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return 'The certificate chain is incomplete or issued by an unknown authority (often a missing intermediate certificate).';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'The certificate is for a different host name.';
    default:
      return code ? `The certificate is not trusted (${code}).` : 'The certificate is not trusted.';
  }
}

/** Certificate fields can repeat (then Node returns an array); show them joined. */
const name = (part: tls.Certificate | undefined): string | null => {
  const value = part ? (part.CN ?? part.O) : undefined;
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(', ') : value;
};

/**
 * Opens "CONNECT host:port" through the egress proxy (which re-checks the address,
 * exactly like for page loads), then performs a TLS handshake and reads the
 * certificate. Nothing is sent after the handshake.
 */
export function inspectCertificate(
  proxyUrl: string,
  host: string,
  port: number,
  options: { timeoutMs?: number; now?: Date } = {},
): Promise<TlsFacts> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const empty: TlsFacts = {
    host,
    port,
    checked: false,
    valid: false,
    error: null,
    validFrom: null,
    validTo: null,
    daysRemaining: null,
    issuer: null,
    subject: null,
    protocol: null,
  };
  const proxy = new URL(proxyUrl);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (facts: TlsFacts, cleanup?: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup?.();
      resolve(facts);
    };
    const timer = setTimeout(
      () => finish({ ...empty, error: 'TIMEOUT' }, () => req.destroy()),
      timeoutMs,
    );

    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}` },
    });
    req.on('error', (err) =>
      finish({ ...empty, error: (err as NodeJS.ErrnoException).code ?? 'PROXY_ERROR' }),
    );
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        // 403 = the proxy refused (private address / blocked port), 502 = unreachable.
        finish({ ...empty, error: `PROXY_${res.statusCode}` }, () => socket.destroy());
        return;
      }
      const secure = tls.connect({
        socket,
        servername: host,
        // We want to READ the certificate even when it is invalid, then judge it ourselves.
        rejectUnauthorized: false,
      });
      secure.on('error', (err) =>
        finish({ ...empty, error: (err as NodeJS.ErrnoException).code ?? 'TLS_ERROR' }, () =>
          secure.destroy(),
        ),
      );
      secure.on('secureConnect', () => {
        const cert = secure.getPeerCertificate();
        const now = options.now ?? new Date();
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        // authorizationError covers trust + expiry; the host name is checked separately.
        let error: string | null = secure.authorized
          ? null
          : String(secure.authorizationError ?? 'UNTRUSTED');
        if (!error && cert && Object.keys(cert).length > 0) {
          const hostError = tls.checkServerIdentity(host, cert);
          if (hostError)
            error = (hostError as NodeJS.ErrnoException).code ?? 'ERR_TLS_CERT_ALTNAME_INVALID';
        }
        finish(
          {
            host,
            port,
            checked: true,
            valid: error === null,
            error,
            validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
            validTo: validTo ? validTo.toISOString() : null,
            daysRemaining: validTo
              ? Math.floor((validTo.getTime() - now.getTime()) / 86_400_000)
              : null,
            issuer: name(cert.issuer),
            subject: name(cert.subject),
            protocol: secure.getProtocol(),
          },
          () => secure.end(),
        );
      });
    });
    req.end();
  });
}
