# 05 · Security Architecture

A website scanner is, by design, **a server that visits URLs that users type
in**. That makes it a target for **SSRF** (Server-Side Request Forgery):
tricking our server into visiting *internal* addresses (`localhost:5432`,
`169.254.169.254` cloud metadata, `10.x` office network). It also renders
**attacker-controlled HTML** (the scanned sites), which brings stored-XSS and
prompt-injection risks. These two threats drive most of this design.

## 1. Threat model (summary)

| # | Threat | Main controls |
|---|---|---|
| T1 | SSRF via the scan URL, redirects, sub-resources, DNS rebinding | Layered URL validation + **egress guard proxy** + Docker network isolation |
| T2 | Stored XSS from scanned HTML snippets, titles, console messages | Rendered as text only; strict CSP on our web app |
| T3 | Prompt injection via scanned content sent to Claude | Delimited untrusted data, structured output, no tools, output shown as text |
| T4 | Account takeover (credential stuffing, token theft) | argon2id, rate limits, HttpOnly cookies, refresh rotation + reuse detection |
| T5 | Broken access control (seeing another team's scans/screenshots) | Every query scoped by project membership; 404 for no access |
| T6 | Abuse: using us to hammer someone else's site | Authorization attestation, optional domain verification, quotas, polite crawling |
| T7 | Resource exhaustion (huge pages, endless crawls) | Timeouts, page caps, memory limits, concurrency limits |
| T8 | Secret leakage | Env-only secrets, validated at startup, never sent to the frontend, redacted from logs |
| T9 | CSV/formula injection in exports | Escape cells starting with `= + - @ \t \r` |

## 2. SSRF defence in depth

```mermaid
flowchart TB
    A["User enters URL"] --> B["Layer 1: syntax rules (Zod)<br/>http/https only, port 80/443,<br/>no user:pass@, length ≤ 2048"]
    B --> C["Layer 2: DNS check (API + worker)<br/>resolve all A/AAAA records,<br/>reject private/reserved ranges"]
    C --> D["Layer 3: egress guard proxy<br/>EVERY request (page, image, script,<br/>redirect hop, link check) is resolved<br/>and checked again, then connected<br/>to that exact IP"]
    D --> E["Layer 4: Docker network<br/>worker has no route to the internet<br/>except through the proxy"]
    E --> F(("Public internet"))
```

**Layer 1: syntax (`packages/shared/src/url-safety.ts`)**
- Only `http:` and `https:`; ports 80/443 only (configurable allow-list).
- Reject embedded credentials (`https://user:pass@host`).
- Hostname normalized (lower-case, IDN → punycode, trailing dot removed).
- Reject `localhost`, `*.localhost`, `*.local`, `*.internal`, and IP literals
  in blocked ranges (including tricky forms such as `0x7f.1`, `2130706433`,
  `[::ffff:127.0.0.1]`, which the WHATWG URL parser normalizes first).

**Layer 2: DNS resolution check.** Resolve **all** IPv4 and IPv6 addresses.
If **any** is in a blocked range, reject. Blocked (via `ipaddr.js` range
names + explicit list): loopback, private (10/8, 172.16/12, 192.168/16),
link-local (169.254/16, fe80::/10, includes cloud metadata 169.254.169.254),
unique-local (fc00::/7), carrier-grade NAT (100.64/10), unspecified, broadcast,
multicast, reserved, benchmarking (198.18/15), documentation ranges, 6to4 and
Teredo encapsulations, and IPv4-mapped IPv6 (unwrapped and re-checked).

**Layer 3: the egress guard proxy (the authoritative check).** Why do we
need it when Layers 1–2 exist?
- **Redirects:** `https://good.com` may answer `302 → http://169.254.169.254/`.
  Playwright's `page.route()` **does not intercept redirect hops**, so an
  in-browser check alone would miss this.
- **Sub-resources:** a page can include `<img src="http://10.0.0.5/admin">`.
- **DNS rebinding:** the domain resolves to a public IP when we check, then
  to `127.0.0.1` a second later when the browser connects.

So Chromium (Playwright **and** Lighthouse) is launched with
`--proxy-server=http://egress-proxy:3128`, and Node-side requests (robots.txt,
sitemap, link checks, header checks, domain verification) use the same proxy
via an undici `ProxyAgent`. For every request and every `CONNECT` tunnel the
proxy:
1. resolves the hostname itself,
2. rejects if any resolved IP is blocked,
3. **connects to the exact IP it checked** (no second lookup → no rebinding),
4. enforces port rules, a max response size and timeouts,
5. logs the decision (`allowed`/`blocked`, host, reason) with the scan ID.

Every redirect hop is a new request, so **every redirect is revalidated
automatically**. Chromium flags close bypasses: `--disable-quic` (UDP),
`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, and no `file://`
navigation (blocked in the context's request handler too).

**Layer 4: network isolation (Docker Compose).**
- Network `internal` (`internal: true`, no internet): postgres, redis,
  scanner, api, egress-proxy.
- Network `egress`: only egress-proxy (and api, which needs to reach Claude and
  SMTP; the API never fetches user-supplied URLs except through the proxy).
- So even a bug in our code can't let the scanner reach the internet or our
  database host directly, only through the proxy, which refuses internal
  targets.

**Testing SSRF defences:** unit tests feed a list of ~40 known bypass inputs to
the validator; integration tests start a fake target that redirects to
`127.0.0.1` and assert the proxy blocks the hop.

**Local test exception:** fixture sites run on a private Docker IP. The setting
`SCANNER_TEST_ALLOW_HOSTS=fixtures` allows **only that hostname**, and the
proxy refuses to start with it when `NODE_ENV=production`.

## 3. Scan resource limits

| Limit | Default (env var) |
|---|---|
| Navigation timeout | 30 s (`SCAN_NAV_TIMEOUT_MS`) |
| Per-page total | 60 s |
| Whole scan | 15 min (`SCAN_MAX_DURATION_MS`) |
| Pages per scan | website setting, hard cap 100 (`SCAN_MAX_PAGES`) |
| Crawl depth | hard cap 5 |
| Links checked per scan | 500 |
| Response size via proxy | 20 MB per response |
| Worker concurrency | 2 scans per worker (`SCANNER_CONCURRENCY`) |
| Container limits | scanner: 2 CPU / 3 GB RAM, `shm_size: 1gb` |
| Browser context | fresh per scan; downloads disabled; service workers blocked; no permissions granted |

## 4. Authentication & sessions

- **Passwords:** argon2id (memory-hard), never logged, never returned.
- **Access token:** JWT (HS256, secret ≥ 32 random bytes from env), 15 min,
  in an `HttpOnly; Secure; SameSite=Lax` cookie, so page JavaScript (or an XSS
  bug) can't read it.
- **Refresh token:** opaque random value, only its SHA-256 stored, 7 days,
  **rotated on every use**; reuse of an old one revokes the whole family.
- **Logout** revokes the session server-side (not only "delete the cookie").
- **CSRF:** `SameSite=Lax` cookies + a required custom header
  (`X-Requested-With`) on non-GET requests, which a cross-site form can't
  add + CORS allow-list with exact origins.
- **Brute force:** rate limits per IP and per email; uniform error messages
  ("Invalid email or password"); constant-time comparison.
- **Password reset:** no user enumeration, 30-min single-use hashed token,
  all sessions revoked after reset.
- **API tokens** (extension): random, shown once, stored hashed, revocable,
  optional expiry; same permission checks as the user.

## 5. Authorization (RBAC)

Global role: `ADMIN` (user management, sees everything) / `USER`.
Project role through `ProjectMember`:

| Action | VIEWER | EDITOR | OWNER |
|---|:-:|:-:|:-:|
| View websites, scans, reports, screenshots | ✅ | ✅ | ✅ |
| Use AI explain / suggest fix | ✅ | ✅ | ✅ |
| Add/edit/delete websites, start/cancel scans, baselines, bug reports, schedules | | ✅ | ✅ |
| Mark issues ignored / false positive | | ✅ | ✅ |
| Manage members, rename/delete project | | | ✅ |

**How it's enforced:** permission checks live in the **service layer** (not
only in routes), and every query includes the membership condition, e.g.
```ts
prisma.scan.findFirst({
  where: { id: scanId, website: { project: { members: { some: { userId } } } } },
});
```
If nothing comes back, the API answers **404** (not 403), so IDs of other
teams' data can't be probed. Integration tests cover "user B tries user A's
scan/screenshot/report/export/AI endpoint" for every resource type.

## 6. Input, output and data handling

- **Validation:** every body, query and path param goes through a Zod schema;
  unknown fields are stripped.
- **SQL injection:** Prisma parameterizes all queries. `$queryRawUnsafe` is
  banned (ESLint rule); `$queryRaw` tagged templates only.
- **Scanned content is untrusted:** HTML snippets, titles, console messages
  and URLs from scanned sites are **always rendered as text** (React escapes
  by default; `dangerouslySetInnerHTML` is banned by ESLint). Code snippets use
  a highlighter that outputs escaped tokens. External links in reports use
  `rel="noopener noreferrer"`.
- **Our own web app:** `helmet` + a strict CSP (`default-src 'self'`, no
  inline scripts), `X-Content-Type-Options`, `Referrer-Policy`,
  `frame-ancestors 'none'`. We should pass our own security checker.
- **Files:** stored outside any web root under random `storageKey`s
  (`scans/<scanId>/<uuid>.png`); served only via authorized API routes with a
  fixed `Content-Type: image/png`, `nosniff`, and `Content-Disposition`. No
  user file uploads in v1, so no upload attack surface. Paths are built
  from IDs only and checked to stay inside the storage root (no `../`).
- **Exports:** CSV formula-injection escaping; PDFs rendered from our template
  with scanned text escaped.

## 7. AI (Claude) safety

- The key lives only in the API container (`ANTHROPIC_API_KEY`); the frontend
  sends an `issueId`, never a prompt.
- Scanned content goes into the prompt **inside delimited tags** with the
  instruction that it is data to analyse, not instructions to follow.
- **Structured output** (JSON schema) + Zod validation, so the model can only
  return the fields we expect.
- No tools or web access are given to the model; its output is **displayed as
  text/code** and never executed or applied to any website.
- Snippets are truncated (≤ 2 KB) to limit cost and data sent. The Settings
  page states that issue data is sent to Anthropic when the AI buttons are used.

## 8. Responsible scanning

- Mandatory checkbox: *"I own this website or have permission to test it."*
  Timestamp stored and shown in the audit log.
- Optional domain verification (meta tag / `.well-known` file); can be made
  mandatory with `REQUIRE_DOMAIN_VERIFICATION=true`.
- Passive checks only; **no** vulnerability probing, fuzzing, login attempts
  or port scanning.
- Polite crawling: honest user agent, robots.txt respected by default, max 2
  parallel requests per site, delay between pages, one running scan per website.

## 9. Secrets & configuration

- All config from environment variables, **validated with Zod at startup**:
  the app refuses to start with a missing or weak `JWT_SECRET`, an invalid
  `DATABASE_URL`, etc. `ANTHROPIC_API_KEY` is optional (AI turns off).
- `.env` is git-ignored; `.env.example` documents every variable with safe
  placeholder values.
- Logs (pino) redact `authorization`, `cookie`, `set-cookie`, `password`,
  `token` fields.

## 10. Supply chain & runtime

- Lockfile committed; `npm audit` in CI; Dependabot/Renovate suggested.
- Containers run as **non-root**; scanner based on the official Playwright
  image of the **same version** as the npm package.
- Health checks on all services; restart policies.
