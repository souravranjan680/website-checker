# Test-only TLS certificates

These self-signed certificates and their keys exist **only** so the scanner tests can
run a local HTTPS server for `fixtures.whc.test` and check that invalid certificates
are reported. They are not secrets: they protect nothing, are not trusted by any
browser and are never used outside the test suite.

| File | What it tests |
|---|---|
| `self-signed.crt` / `.key` | Valid dates (until 2126) but self-signed → "not trusted" |
| `expired.crt` / `.key` | Expired on 2021-01-01 → "certificate has expired" |

Regenerate (OpenSSL 3.4+, from this folder, in Git Bash):

```bash
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout self-signed.key -out self-signed.crt -days 36500 -subj "/CN=fixtures.whc.test" -addext "subjectAltName=DNS:fixtures.whc.test"
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout expired.key -out expired.crt -not_before 20200101000000Z -not_after 20210101000000Z -subj "/CN=fixtures.whc.test" -addext "subjectAltName=DNS:fixtures.whc.test"
```
