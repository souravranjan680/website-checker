/**
 * How the egress proxy answers when it does not deliver a response from the site.
 * The scanner uses these to tell "the site is broken" apart from "our security
 * policy refused it" and "the network had a problem". For HTTPS (CONNECT tunnels)
 * a client only sees the status code, so each reason has its own status.
 */
export const EGRESS_BLOCKED_HEADER = 'x-whc-egress-blocked';
export const EGRESS_REASON_HEADER = 'x-whc-egress-reason';

export const EGRESS_REASONS = {
  /** Private/internal address, disallowed port, invalid host: SSRF protection. */
  policy: 403,
  /** The domain does not exist (DNS: no such name / no addresses). */
  'dns-not-found': 502,
  /** DNS failed temporarily (timeout, server failure): try again later. */
  'dns-error': 503,
  /** Could not connect to the site, or it did not answer in time. */
  unreachable: 504,
} as const;

export type EgressReason = keyof typeof EGRESS_REASONS;

/** Status code → reason, for clients that only see the status (CONNECT). */
export function egressReasonFromStatus(status: number): EgressReason | null {
  const entry = Object.entries(EGRESS_REASONS).find(([, code]) => code === status);
  return entry ? (entry[0] as EgressReason) : null;
}
