# Internet-upgrade verification record

Assessment date: 7 October 2026. Linux, Node 24.19.0/npm 11.9.0, native SQLite 3.53.3, libsodium 1.0.22 and separate test-only Chromium 143.0.7499.0. Only synthetic identities/disposable loopback files/services were used. The browser was launched through the existing isolated harness with container flags; CSP and browser same-origin security were not disabled.

## Current completed checks

- Production frontend/local backend/relay compilation and strict TypeScript checks.
- Full Node suite: 35 tests, comprising original 28 plus six relay cases and a TLS regression. Relay scenarios include authenticated remote pairing, twelve-message offline batch, online chat, signed DELIVERED/READ, persistent app/relay restart, duplicate/deletion ledger, tampered nonce/recipient, LAN preference/fallback, outage auto-reconnect and same-identity unpin/re-pair with old epoch rejection.
- Relay negative cases: invalid keys/proofs, old/cross-audience proof, unauthed command, stranger route, mismatched mutual epoch, malformed/duplicate/binary/oversized frame, 70-command flood, expired session/auth deadline, full/expired mailbox, conflicting duplicate and receiver-only consume.
- Local TLS proxy: ordinary WSS validation rejects an untrusted certificate; a generated disposable trusted root enables correct URL-bound auth. OpenSSL is a test prerequisite only. No TLS verification bypass used.
- The actual browser suite over the relay: identity/Argon2 worker, five generated QR decodes, both confirmations, matching code/success, encrypted bidirectional chat, mobile lock/offline send/SENT/temporary ciphertext/unlock delivery, no known plaintext in captured browser WS/HTTP/local SQLite, inert name/message injections, delayed-save lock race, history retention/deletion, responsive themes, 200% text, skeletons, sticky CTA, five FAQs, policies/breadcrumbs/metadata/schema/robots/demo/custom404.
- Relay amplification regression: fixed eight-message burst gives eight forwards. A discarded isolated negative-control source fixture restored the mailbox-rescan branch and reproduced 36 forwards; regression failed as expected before restoring fixed code.

The full dependency advisory review reported zero known production/development advisories; 48 project/build files passed heuristic secret/sink checks. Direct-LAN and internet browser suites passed. The actual isolated global install/reinstall/uninstall checks passed and retained encrypted identity, trust and history. Compose YAML parses, the native port is not published, and the ready tarball matches compiled runtime files and includes npm shrinkwrap. Archive integrity/allowlist verification is performed before delivery. These are local checks, not public service provisioning.

## Reproduce

```bash
npm ci
npm run check
npm run audit:security
npm run test:install
npx playwright install chromium
npm run test:browser
```

Then run the browser suite with the local relay: POSIX `BC_TEST_RELAY=1 npm run test:browser`; PowerShell `$env:BC_TEST_RELAY="1"; npm run test:browser`. Use isolated profiles and test data only. Tests may need browser OS dependencies. OpenSSL creates throwaway TLS keys for `tests/tls.test.ts`; none are distributed in the ZIP.

## Not verified

**Two-network internet testing could not be physically verified in this environment.** The exact different-Wi-Fi/hotspot/manual process is in `TWO_COMPUTERS.md`. No public relay, user provider account, paid service, Docker engine, Caddy binary, DNS/ACME certificate setup, physical sleep/wake, IPv6-only/mobile carrier, router, macOS/Windows ACL/firewall or camera hardware test was performed. No GitHub push/clone was executed without the user's repository URL. Source/install commands are supplied, not falsely marked live cloud deployment.

The localhost scenarios simulate independent clients and relay/connection failures; they are not a physical multi-network result. No sustained/distributed DoS soak, exhaustive fuzzer, formal verification, independent penetration certification or third-party crypto audit was completed. Read SECURITY_AUDIT.md and THREAT_MODEL.md.

## Historical baseline record

The following 6 October record describes LAN-only baseline verification before this upgrade. Current scope/results above supersede historical local-only networking statements.

# Verification record

Verified on Linux with Node 24.19.0, npm 11.9.0 and isolated Chromium 143.0.7499.0 on 6 October 2026. Only synthetic identities and disposable test databases were used.

## Completed

- `npm run check`: TypeScript, 28 crypto/storage/network/CLI/adversarial tests, and production build passed.
- `npm run audit:security`: current project configuration/heuristic secret/sink checks and full npm advisory review passed; zero known production/development advisories. Outdated packages and installer limits are documented in `SECURITY_AUDIT.md`.
- Actual two-service tests: both pairing confirmations, wrong/reused tokens, concurrent candidates, ciphertext/ACK, same-session replay, reconnection, service restart with persisted identities, old-session replay, deletion tombstones, reset-key warning, browser origin/CSRF/Host/generation rejection.
- Controlled adversarial tests: malformed HTTP/headers/Unicode credentials, path traversal, duplicate JSON, field mutations, oversized input/frames, 101-frame burst, ninth-peer refusal, 70 TCP connections, 300 browser events, corrupt vault and private POSIX storage modes, exact identity cloning and a 32-write database burst.
- Actual browser: identity/KDF worker, five fresh QR image decodes, both confirmations and success page, bidirectional chat/receipts, no plaintext in requests/SQLite, inert message and display-name injection fixtures, delayed-write lock race, unlock/retry, deletion, mobile dark/light layout, 200% text, loading skeleton, sticky CTA, FAQs/breadcrumbs, policies, metadata/schema/robots, actual demonstration image, custom HTTP 404/recovery. No page/console error remained.
- Visually inspected desktop chat, mobile FAQ and 200% security layout screenshots. The demonstration image is an actual screenshot of this app with synthetic data.

The test-only browser binary was separate from the app and launched with container flags including `--no-sandbox`. Browser CSP/same-origin protections remained active. Normal users do not need these flags. This does not assess browser sandbox strength.

Global installation was also exercised using an isolated npm prefix and the actual generated `.tgz`, with `butter-chicken --version`/help and foreground launch from a different directory. The full browser creation/pairing/chat/history/lock/error flow passed against two instances of that installed global runtime. No user-global installation was changed. The dedicated `npm run test:install` also passed a fresh global command-shim installation, matched installed dependency versions to packaged shrinkwrap, reinstalled the app without losing encrypted identity/pairing/history, then uninstalled it while retaining its private database. No actual GitHub clone/push was possible without a supplied repository URL; the GitHub commands are documented for the user to run.

## Reproduce

```bash
npm ci
npm run check
npm run audit:security
npx playwright install chromium
npm run test:browser
```

Browser OS prerequisites may be necessary on Linux. An existing isolated test browser can be selected with `BC_TEST_BROWSER_PATH`; never reuse a real user browser profile. Do not disable web security/CSP. Browser output captures only generated test identities; do not distribute `test-results/qr-test.png` as a reusable invitation.

The package exporter includes source, compiled production output and documentation. It excludes test results, browsers, `.data`, `.env`, SQLite files and installed dependencies. ZIP integrity and its allowlist were checked before delivery. A clean extraction successfully ran `npm ci`, started the compiled production server with a fresh private test directory, served the UI/bootstrap, and returned HTTP 404 on its separate LAN port. Initial installation requires internet access; offline cache-only installation was unavailable because this environment did not cache every package. Chat has no runtime internet requirement.

## Still needs physical testing

Use `TWO_COMPUTERS.md` on the actual machines. Verify private IPv4/firewall routing and guest-network isolation, automatic mDNS discovery, direct manual address, Wi-Fi/IP changes, sleep/resume, service/computer reboot, camera QR scanning, target browser behavior, macOS/Linux firewalls and Windows ACLs. Existing tests restart services and databases; they do not reboot hardware or assess physical network equipment.

No independent cryptographic review, formal verification, exhaustive fuzzing or sustained LAN DoS soak was completed. See the security report for the trust boundaries and complete test inventory.
