# Test fixture websites

Small sites with **intentional** defects, used by `apps/scanner` tests. They are
served by `apps/scanner/test/fixture-server.ts` on `127.0.0.1` and reached under
the fake name `fixtures.whc.test` through the egress proxy's test-only host map.
The proxy still blocks `127.0.0.1` itself, which is how the tests prove SSRF protection.

| Path | Contains |
|---|---|
| `a11y/` | Missing alt, unnamed button/link, unlabeled input, low contrast, invalid ARIA, duplicate IDs, heading skips, no `lang`; links to duplicates, a 404, redirects, an internal address, a dead domain, a robots-disallowed page |
| `a11y/page2.html` | Missing CSS, JS and image, a console error, an uncaught exception |
| `ui/` | Horizontal overflow, an element that overflows only on small screens, clipped text, a covered button, an empty button, a stretched image, plus look-alikes that are **not** bugs (ellipsis, screen-reader-only text, scrollable carousel) |
| `clean/` | An accessible page (expected: no violations) |
| dynamic routes | `/toggle/` (defects that can be "fixed" between scans), `/slow/` (20 s response), `/redirect`, `/redirect-to-secret`, `/secret` (counts hits; must stay 0), `/robots.txt` |
