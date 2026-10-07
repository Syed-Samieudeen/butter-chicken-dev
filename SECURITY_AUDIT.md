# Butter Chicken security assessment: internet upgrade

**Assessment date: 7 October 2026. Scope: this application and isolated local test services only.** No public host, third-party relay, unrelated device or destructive load test was targeted. This report includes the current relay assessment followed by the earlier LAN baseline report, whose date/scope qualify its historical statements.

## Current executive result

The upgrade implements authenticated WSS internet routing, encrypted remote pairing, mutual public-key pin authorization, persistent ciphertext-only offline queues, signed encrypted delivery/read receipts, stable retry envelopes, pair epochs, sequenced encrypted payloads, replay tombstones, bounded reconnect and LAN fallback. Keys/passphrase/pairing token remain in the local browser; relay storage and logs contain no tested known message plaintext. No critical/high issue was identified in this bounded assessment; that does not prove none exist.

The existing seven baseline findings were fixed. One additional **Medium** relay amplification finding was reproduced and fixed with a passing regression and an exercised failing negative control. Audience-binding and trust-removal lifecycle safeguards were also added and tested. **No independent cryptographic audit or physical two-network verification occurred.** Long-term box keys still lack forward secrecy, and trusted endpoint/local-process boundaries remain unchanged.

## Current attack surfaces and controls

| Surface                       | Review and tests                                                                                                                                                                         | Limits                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Relay WSS authentication      | Random fresh challenge, Ed25519 proof binds identity and canonical configured relay URL; invalid key, old proof, cross-audience proof and unauthenticated poll fail                      | Self-generated cryptographic identity, not verified real-world name/account; malicious endpoint key holder remains that identity |
| Relay live pair links         | Authenticated connection, bounded links, sender/recipient binding; unknown established-peer link rejected                                                                                | Initial unpaired links can reach a client, which rejects absent/invalid invitation tokens and requires both human confirmations  |
| Pair mailbox registration     | Both signed matching peer pins and same pair epoch required; mismatched epoch/stranger refused                                                                                           | Relay can inspect public peer IDs/keys/epoch; old pins survive destroyed keys until operator cleanup                             |
| Ciphertext forwarding/storage | Strict signed envelopes, sender identity/recipient authorization, duplicate equality, receiver-only consume, bound rows/TTL                                                              | Malicious relay can drop/delay/reorder and lie about acceptance; metadata visible                                                |
| Browser durable mail          | Exact pinned keys, signature/box/schema/epoch checks, authenticated sequence and permanent dedup transaction; nonce/recipient tampering and old pair rejected                            | No contiguous-order guarantee or trusted anti-rollback state; authorized history/tombstones grow                                 |
| Receipts                      | DELIVERED/READ are encrypted signed peer messages; relay acceptance is SENT only                                                                                                         | READ reports app display, not human attention; no read-receipt privacy opt-out                                                   |
| Lifecycle                     | Local archive contains exact pending wire ciphertext, encrypted vault contains outgoing counter; service/relay restart, outage backoff, trust removal/re-pair and LAN fallback exercised | Physical sleep/wake, real IP/hotspot changes not tested; stopping local Node needs reload/unlock                                 |
| Transport/TLS                 | Public client requires WSS, loopback dev exception, no redirects/insecure fallback; bad certificate rejected, valid local trusted TLS proxy authenticates                                | Supplied Docker/Caddy, actual public DNS/certificates and provider network not executed here                                     |
| Input and resource limits     | Duplicate/malformed/binary/oversized JSON/WS, wrong signatures, auth/session expiry, burst/caps, queue expiry and healthy recovery exercised                                             | Small deterministic local tests only; no public/sustained/distributed DoS claim                                                  |
| Local API/rendering/storage   | Original Host/Origin/cookie/CSRF/epoch/CSP/SQL/React/permissions protections retained; browser tests cover injection and lock races                                                      | Native local process, browser extensions and altered local code are trusted endpoint risks                                       |
| Privacy/logs                  | Known synthetic plaintext/passphrases absent from captured browser transport/HTTP, local SQLite, relay rows and application event logs                                                   | Negative scans test known fixtures, not formal information-flow proof; provider logs/backups require their own policy            |

## Exact limits and safe reproduction

`relay/service.ts` has 5-second auth timeout, 64 connections, one session per identity, 1-hour session cap, 60 commands and 512 KiB per second per connection, 4 pair links per identity, 64 KiB envelope plus bounded wrapper, 1 MiB buffered-output cap, 256 mailbox rows per recipient, 4096 total mail rows, 10,000 public-pin rows, 24-hour ciphertext retention and a 15-second cleanup/heartbeat cycle. Poll/reconnect deliveries are eight at a time. Container memory/CPU/PID/log bounds supplement these limits. The native listener trusts its TLS marker only behind the protected proxy/network; do not publish it.

All reproductions use generated identities and disposable loopback databases:

```bash
npm ci
npm run check
npm run test:relay
npm run test:security
npm run audit:security
```

`tests/relay.test.ts` runs real browser-engine/local-service/relay flow with signed pairing, online/offline sends, twelve-message offline batches, app and relay restarts, ACK/read state, replay/deletion, tampered nonce/recipient, LAN preference/fallback, relay outage reconnect and trust removal/re-pair epoch rejection. Raw client cases exercise auth/key/audience replay, unauthorized routes/mutual pins, malformed/binary/oversized frames, flood, auth/session timeout, full/expired mailbox, conflicting duplicate and receiver-only consume.

`tests/tls.test.ts` generates disposable loopback TLS credentials using OpenSSL. It first confirms the self-signed/untrusted certificate fails, then adds that disposable certificate to the test process's trusted roots and confirms WSS authentication through an isolated TLS proxy. `rejectUnauthorized` is never disabled. Trust changes and temporary keys are cleaned up. This tests platform certificate enforcement, not Caddy/ACME deployment.

`BC_TEST_RELAY=1 npm run test:browser` uses the actual production UI and isolated relay for five QR images, two-sided pairing/safety code, encrypted bidirectional messages/receipts, mobile lock, offline browser send/SENT, temporary ciphertext, reconnect delivery, inert name/message injection, delayed archive-write/lock race, history deletion, mobile themes/200% layout, policies/FAQs/metadata/schema/robots/custom404. Ordinary `npm run test:browser` retests the direct LAN mode. Existing global-install checks use a disposable npm prefix and encrypted identity/history fixtures; they never alter the user's global app/data.

### BC-RELAY-001: mailbox rescan amplifies live message delivery

**Severity: Medium. Fixed.** A valid paired sender could cause avoidable transport/receiver work by submitting a short burst while the recipient's mailbox retained unconsumed items. Every accepted submission called the full mailbox delivery loop. With eight queued messages this forwarded 1+2+...+8 = **36** envelopes instead of eight. Longer bursts could overload the browser's intentionally bounded processing queue and lock the vault. This is an availability issue; no plaintext/key disclosure or unauthorized identity trust was demonstrated.

**Root cause:** insertion and full-mailbox polling used the same forwarding path. Mailbox retries are useful periodically but should not be repeated for every new submission.

**Safe local reproduction:** `node --import tsx --test --test-name-pattern="relay delivery does not amplify" tests/relay.test.ts`. The fixed code must observe eight forwards. In a disposable checkout only, restore the old insertion branch `if (peer) deliver(peer)` in place of its single-envelope `send(peer, {type:"mail", envelope:e, pairId:v.pairId})` branch and rerun; the regression expects eight and observes 36. Restore the fixed source before other use. The assessment exercised this negative control in temporary fixture files, observed `36 !== 8`, then deleted those fixtures. No public relay was used.

**Fix:** live acceptance sends only that envelope. Startup/pin/poll/maintenance delivers bounded batches of eight; local retry uploads are also batched. The regression passes on fixed code, while the isolated negative control failed as expected. Offline batch/reconnect and the complete browser suite retest normal delivery.

### Additional reviewed hardening

- Relay auth proofs include the configured canonical URL, preventing simple cross-relay proof forwarding. The cross-audience negative test rejects a correctly signed proof for a different service URL. No content-impersonation exploit was claimed.
- Authenticated no-friend clients unpin stale own relay registration on reconnect. Relay disconnect notifications clear local ready state after trust removal. Same-identity re-pair generates a new epoch; old encrypted mail is rejected. Reset/destroyed old keys cannot authenticate old server-pin deletion, explicitly documented.
- Heartbeat closes nonresponsive upgraded sockets instead of waiting the full one-hour cap. Strict transport validation, disabled compression, no payload logging and capacity limits remain in place.
- Mobile manual lock remains reachable; it is exercised during the internet browser offline-delivery test. No forward-secrecy feature or OS-process isolation claim was added.

## Final local verification result

The complete `npm run check` passed **35 Node tests**, strict TypeScript and production build. Current `npm run audit:security` reports **zero** known production/development advisories and no heuristic failures across 48 source/build files. Outdated direct packages remain recorded below; no untested major upgrade was introduced. Internet and LAN browser flows passed. The ready global tarball retains exact shrinkwrap and matched compiled runtime; isolated clean install/reinstall/uninstall retained encrypted local data. Compose YAML was parsed and its native relay port is not published. Docker execution and actual public TLS provisioning remain unverified.

## Current scorecard and unresolved risks

| Category                                           | Result           | Qualification                                                                                      |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| Internet cryptographic authentication/routing      | PASS exercised   | Fresh/audience-bound proof, matching pins, wrong identities and unauthorized routes tested         |
| Remote pairing/pin/epoch                           | PASS exercised   | Real relay handshake and two-sided human confirmation UI; initial human comparison still essential |
| Offline delivery/restart/dedup/receipts            | PASS exercised   | Exact locally archived envelopes and persistent relay data; signed receipts and tombstones         |
| WSS certificate validation                         | PASS local       | Untrusted refused, trusted local TLS authenticated; actual hosted TLS pending                      |
| Local/relay plaintext fixture checks               | PASS exercised   | Known synthetic secrets absent from checked transport/storage/logs; metadata remains               |
| Input and bounded resilience                       | PASS exercised   | Limited safe corpus/bursts/caps/expiry; not DDoS certification                                     |
| Forward secrecy/ratchet                            | **UNSUPPORTED**  | Static long-term keys                                                                              |
| Native local-process or compromised-code isolation | **UNSUPPORTED**  | Trusted OS/browser/code endpoint boundary                                                          |
| Physical two-network/mobile/public deployment      | **NOT VERIFIED** | Exact manual procedure supplied                                                                    |
| Docker/Caddy/DNS/ACME and cross-platform hardware  | **NOT VERIFIED** | Complete configuration provided, runtime/provider validation pending                               |

**Two-network internet testing could not be physically verified in this environment.** See `docs/TWO_COMPUTERS.md`. Remote network reachability depends on a deployed public TLS relay and outbound network access. No relay host/account, cloud credentials, production endpoint or spending was provisioned. No GitHub push/clone was performed without the user's repository URL. Internet-specific tests simulate independent clients/outages on loopback; they do not assert physical different-Wi-Fi success.

An untrusted relay cannot forge a new valid friend's encrypted envelope without stolen private keys, but can replay/delay/drop/reorder or falsely claim SENT. Its compromised infrastructure still cannot provide endpoint forward secrecy. Cloned keys, older backup rollback, offline password guessing, visible metadata, JS/OS memory copies, recipient retention, persistent local history growth and distributed DoS remain documented risks. No automated assessment makes the app unhackable or independently certified.

## Historical LAN baseline follows

The remainder records the **6 October LAN-only version** and its seven fixed findings, root causes and regressions. Statements there about absence of a relay, 28 tests and local-only scope describe that baseline, not the updated release above. Current behavior and limitations are defined by the internet assessment, SECURITY.md and README.

# Butter Chicken application security assessment

**Assessment date:** 6 October 2026. **Target:** the supplied Butter Chicken 1.0.0 source and production build. **Scope:** this application only, on disposable loopback instances representing its two LAN endpoints. **Assessor:** implementation-associated automated application assessment, not an independent audit or certification.

## Executive result

The final automated security suite passed **28 tests**, the production build and TypeScript checks passed, and the complete isolated Chromium browser flow passed. The final npm advisory scan reported **zero known vulnerabilities across production and development dependencies**. Seven findings were corrected: two medium-severity local availability defects and five low-severity validation, resource, dependency or filesystem issues. No unresolved critical/high vulnerability was identified in the exercised scope.

This result supports a local development release within the documented trust model. It does **not** certify the new application handshake for sensitive production messaging. Physical two-computer LAN testing, camera scanning, mDNS/firewalls, Windows/macOS behavior, long-running stress and independent protocol review remain outstanding. Availability against a determined LAN attacker is not guaranteed.

A native process running on the same computer can obtain the loopback API cookie/CSRF tokens and delete or replace encrypted storage. The loopback service does not authenticate operating-system users or processes. This was tested and is an explicit endpoint trust boundary, not a hidden promise of local process isolation. Cryptographic verification and decryption reside in the browser; ordinary API access did not reveal private keys, passphrases or message plaintext. A malicious local code distributor can replace browser JavaScript and steal secrets at the next unlock. Use a trusted endpoint and private OS account.

## Authorization and safety

All attack traffic went to servers created by the tests, on random `127.0.0.1` ports. Storage was either in-memory SQLite or a newly created temporary directory. No user vault, public system, unrelated device or external network was probed. Dependency metadata/advisory queries are package review, not penetration tests against npm. Tests used synthetic names, passphrases and messages and clean browser profiles.

Stress was bounded: 70 simultaneous TCP sockets, eight accepted peer WebSockets plus a ninth refusal, 101 frames in a rate-limit burst, one 65,537-byte WebSocket payload, approximately one MiB of HTTP input, a 32-write database burst, and 300 synthetic queued browser events. Sockets and temporary databases were closed/removed in `finally` blocks. No host-exhaustion, crash-dump extraction or destructive test was attempted. Only a disposable child process was used to reproduce the original HTTP crash.

## Threat model

| Actor or capability                                                               | Expected protection and limit                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unpaired LAN peer, including one knowing the port/IP                              | Cannot establish saved trust or deliver accepted chat without key possession, invitation authorization where needed, and both confirmations |
| Passive network observer or opaque relay                                          | Cannot open message boxes without a participant's private key; sees traffic metadata and public hello identities                            |
| Network modifier, replay or identity-substitution attacker                        | Full-envelope signature, authenticated encryption, expected identity, fresh challenges and persistent replay records reject tested attacks  |
| Attacker possessing an invitation                                                 | Can consume it and disrupt pairing; cannot bypass the other human's independent code comparison and local confirmation                      |
| Thief copying a locked vault                                                      | Obtains encrypted data and metadata; offline password guessing remains possible                                                             |
| Malicious local process, browser extension, OS admin or modified application code | Outside endpoint integrity protection; cookie/CSRF are browser cross-site defenses, not OS process authorization                            |
| Trusted friend or holder of a cloned private identity                             | Can send messages as that identity and retain/share messages; key possession cannot distinguish a clone from its original                   |
| Determined LAN denial of service                                                  | Bounds reduce resource use, but cannot guarantee availability or prevent all connection-slot starvation                                     |

The protocol uses established libsodium primitives, but its application handshake and persistence logic are new. There is no forward secrecy, double ratchet or post-compromise recovery. Later compromise of long-term box private keys can expose recorded older traffic. Human code comparison is essential during first pairing.

## Attack surface inventory

| Layer               | Surface                                                                                                                                                                                  | Controls and assessment                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend identity   | Name, passphrase, confirmation, unlock and reset forms                                                                                                                                   | Bounded inputs; Argon2id worker; passphrase stays in browser; wrong-password and lock tests                                                                                                       |
| Frontend pairing    | Pasted BC1 invitation, uploaded QR image, optional camera and manual address                                                                                                             | Signed strict data, private literal IPv4 policy, expiry, token, expected identity and two-sided confirmation; five generated QR images decoded; physical camera untested                          |
| Frontend rendering  | Chat text, names, pairing metadata, notices, settings, help pages                                                                                                                        | React text rendering; no `dangerouslySetInnerHTML`; live harmless HTML/JS/SQL/shell-like chat and malicious display-name fixtures stayed inert                                                    |
| Browser lifecycle   | Async writes, lock, reconnect, timer, active tab                                                                                                                                         | Epoch guards discard stale work; bounded 128-event queue; one timer job; one active local WebSocket; lock race tested                                                                             |
| Browser storage     | localStorage, browser caches and profile                                                                                                                                                 | Only theme/auto-lock preferences in localStorage; no application IndexedDB; live decrypted state in memory; no reliable JS/OS memory erasure guarantee                                            |
| Loopback HTTP       | `GET /api/bootstrap`, metadata-only `/api/status`, `/api/vault`, `/api/history`; mutations `/api/vault`, `/api/outgoing`, `/api/receive`, `/api/delivered`, `/api/history`, `/api/reset` | Loopback socket plus exact Host, Origin and Fetch Metadata; cookie, CSRF and reset-generation guards; strict JSON/schema and body cap. Bootstrap deliberately available to native local processes |
| Loopback WebSocket  | `/local`                                                                                                                                                                                 | Exact origin and cookie; single active client; strict local commands; private destination policy, bounded connects and buffers                                                                    |
| LAN HTTP/WebSocket  | HTTP returns 404; `/lan` upgrades                                                                                                                                                        | No UI/storage API on LAN listener; private source address; no browser Origin; max eight peers; strict opaque frame validation; browser performs identity/trust verification                       |
| Discovery           | `_butterchicken._tcp` mDNS advertisements, node ID and IPv4 addresses                                                                                                                    | Unauthenticated hints only; private IPv4 selection and bounded frontend device list; no real multicast injection or firewall test available                                                       |
| Crypto              | Identity, hello, invitation, signed boxes, vault and archives                                                                                                                            | Secure RNG, distinct signing/box/archive keys, standard libsodium APIs, signatures and challenge binding; source review plus exercised tamper/recipient/relay/replay tests                        |
| Storage             | SQLite vault, messages, replay tombstones and metadata                                                                                                                                   | Schema validation, bound SQL, encrypted payloads, atomic receive+seen, 0700/0600 POSIX checks, `secure_delete`/`VACUUM`; reopened-file tests                                                      |
| Files/configuration | `.env`, data path, static paths, logs, reset and backups                                                                                                                                 | Optional non-secret example config; private data directory; static root containment; no plaintext logging; documented backups/rollback risks                                                      |
| Build/dependencies  | npm lockfile, optional native installers, Vite, tsx and production assets                                                                                                                | Exact direct versions, npm integrity hashes/registry origins, npm audit/outdated, heuristic secret/sink/config scan; source maps off; no runtime CDN/font/API dependency                          |
| Informational pages | Help, FAQs, demo, terms, privacy, success, custom 404 and metadata                                                                                                                       | Per-page metadata, restrictive production CSP and noindex; accurate SoftwareApplication schema; no fake testimonials, SLA or LocalBusiness identity                                               |

The foreground global CLI starts the compiled app from its installed package directory. Default data is in the OS user-data directory, independent of the caller’s working directory. Whitelisted configuration loads from its dedicated config file with environment precedence; it never imports a random launch-folder .env. The metadata-only loopback status endpoint does not issue credentials and remains protected by Host/Origin/socket checks. CLI tests verify these fields and reject cross-origin status reads.

No cloud account, internet relay, attachment upload, debug HTTP endpoint, administrator API or generic shell-command endpoint is implemented. Local configuration paths come from the operator, not LAN packets. IPv6-only connectivity is unsupported.

## Test method and evidence

Run from the project directory on Node.js 24.x:

```bash
npm ci
npm run check
npm run audit:security
npx playwright install chromium
npm run test:browser
```

`npm run check` type-checks, builds the production client/server, then runs every `tests/*.test.ts` test, including CLI configuration/launch/status cases. `npm run test:security` runs the crypto, store, network, CLI and adversarial files explicitly. `audit:security` uses npm's current advisory/outdated reports and project-scoped heuristic configuration, credential and sink checks. This heuristic scan is not a full data-flow analyzer or proof that no secret exists. No git repository/history was available, so historical secret scanning was not possible.

The browser environment available here used isolated **Chromium 143.0.7499.0**, with Playwright 1.63.0. Its standard binary download failed in this environment; a separate test-only Chromium binary was used. Container flags included `--no-sandbox`, `--disable-dev-shm-usage` and `--no-zygote`. CSP, same-origin restrictions and web security remained enabled. The app never adds those flags or bundles that test binary. The full flow was additionally exercised against a globally installed npm tarball, launched from an unrelated temporary directory with distinct private data directories. This does not validate the OS browser sandbox or the user's exact installed browser.

| Area                         | Actual exercises                                                                                                                                                             | Result                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Authentication/authorization | Missing/wrong cookies, wrong Host/origin, cross-site Fetch Metadata, no CSRF, stale reset generation, local WS missing auth, wrong origin, browser-to-LAN upgrade            | Rejected with safe errors or closed connections                                               |
| Pairing                      | Wrong random token, four bounded guesses, two simultaneous valid-token candidates, consumed-token reuse, remote verify without local confirmation, malformed/expired invites | One candidate only; no saved friend without local confirmation; reuse/guess attempts rejected |
| Identity verification        | Modified hello identity; invitation key/endpoint substitution; peer reset with same display name; saved pins after actual service restart                                    | Signatures/identity checks failed; changed key blocked with warning; pins retained            |
| Crypto/tamper                | Every outer envelope field including version; nonce/ciphertext/signature/IDs/timestamp; wrong recipient, unrelated relay key, archive AAD and wrong password                 | No tampered or unrelated plaintext accepted                                                   |
| Replay                       | Exact same-session capture, old capture on new connection, real service restart with persistent SQLite, duplicate tombstone after history deletion                           | One displayed message; old challenge context rejected; duplicate persistent record rejected   |
| Mutation harness             | More than 120 field mutations: missing/null/empty/wrong-type/Unicode/long values; duplicate fields; invalid JSON, versions and encodings; malicious invitation metadata      | Rejected safely; liveness checked after live transport cases                                  |
| HTTP parser/static files     | `//[`, malformed absolute URL, illegal/duplicate headers, 20KB header, invalid percent encoding, NUL path, traversal, `.env` and database paths, multibyte credentials       | No crash or sensitive file response; regression child alive                                   |
| WebSockets/resources         | Binary rejection, binary rejection, malformed frames, 64KiB cap, 101-frame burst, ninth peer, second local client, no negotiated compression, duplicate local command        | Limits enforced; safe closure/errors; service remained responsive                             |
| TCP exhaustion               | 70 idle LAN TCP sockets against max 64                                                                                                                                       | Excess connections closed; normal HTTP resumed after release                                  |
| Queue/lifecycle              | 300 synthetic local events, 128-event bound, stale-event discard, delayed outgoing persistence released after lock                                                           | Vault safely locked on overload; no plaintext resurrection; unlock recovered                  |
| Injection                    | SQL/prototype-shaped API payloads, path traversal; actual browser chat containing harmless script/img handler/SQL/shell-like text and a markup-shaped display name           | Strict schemas/bound parameters/text rendering prevented tested interpretation                |
| Storage                      | Raw SQLite plaintext searches, vault key material check, close/reopen persistence, reset/history delete, corrupt vault JSON, POSIX private directory and file modes          | Ciphertext only for sensitive payloads; safe corruption error; permissions enforced           |
| Dependencies/configuration   | Full npm audit, outdated detection, exact/integrity-pinned versions, installer list, secret/sink heuristic, no production source maps/CORS wildcard                          | Zero final known advisories; no heuristic findings                                            |
| Website/browser              | Five QR images; success and chat; mobile themes/CTA; five FAQs, breadcrumbs/policies, unique metadata, actual demo, 404 recovery, 200% text                                  | Passed without browser page/console errors                                                    |

A nonce uniqueness sample of 200 envelopes passed. This is a smoke test, not statistical proof; the security basis is libsodium's secure RNG with 24-byte nonces. Tampering with ciphertext also modifies its embedded authenticator; no separate unauthenticated tag field exists. Signed timestamps are never a freshness authority.

## Findings and corrections

Severity reflects actual reachability and impact. No critical/high severity is assigned merely because a case involves cryptography. Source-identified hardening findings and advisory evidence are distinguished from demonstrated crashes.

### BC-SEC-001: malformed request target terminates local server

- **Severity/component:** Medium; loopback HTTP routing.
- **Prerequisite:** A process can send an HTTP request to the local UI port. The UI port is not LAN-exposed.
- **Safe reproduction:** `node scripts/probe-local-http.mjs`. The script starts an in-memory child server and sends `GET //[ HTTP/1.1` with its valid localhost Host. Never point it at an installed vault.
- **Expected/actual before fix:** Expected a client error. Actual reproduced result was an empty response, child no longer alive, and an `Invalid URL` exception.
- **Impact/root cause:** Local availability loss from one request. `new URL(req.url, ...)` threw outside an exception boundary in an async request callback.
- **Fix:** Catch invalid request-target parsing and return HTTP 400.
- **Regression:** `forked service survives malformed request targets...` in `tests/security.test.ts`; the dedicated probe also now reports `HTTP/1.1 400 Bad Request`, `childAlive: true`, no diagnostic.
- **Status:** Fixed and retested.

### BC-SEC-002: multibyte credential comparison can throw

- **Severity/component:** Medium; local cookie/CSRF comparison.
- **Prerequisite:** Raw local HTTP header containing a same-character-length but different UTF-8-byte-length credential. For the CSRF path, a valid local cookie is needed; bootstrap can supply one locally.
- **Safe reproduction:** The regression test first demonstrates `timingSafeEqual(Buffer.from('é'.repeat(64)), Buffer.from('a'.repeat(64)))` throws, then sends Latin-1 header bytes to its disposable service. The original helper compared JavaScript string lengths before calling `timingSafeEqual`.
- **Expected/actual before fix:** Expected failed authorization. The former comparison passed the character-length test and the native byte comparison threw `RangeError`. This exception path was reproduced in the helper; a second original-version server crash was not separately retained as evidence.
- **Impact/root cause:** Potential local denial of service; string length is not byte length and the comparison was outside route error handling.
- **Fix:** Encode both values to buffers, compare buffer lengths, and only then perform constant-time comparison.
- **Regression:** Malformed Unicode cookie/CSRF requests in the forked-service test; failed authorization and service liveness are asserted.
- **Status:** Fixed and retested.

### BC-SEC-003: duplicate JSON members accepted with last-value semantics

- **Severity/component:** Low; protocol/API deserialization.
- **Prerequisite:** Attacker supplies malformed/ambiguous JSON to an available input boundary.
- **Safe reproduction:** `JSON.parse('{"version":1,"version":1}')` accepts duplicate members. The test sends duplicated `version` on a real LAN frame and duplicated `type` on a local command; it also exercises the API parser.
- **Expected/actual before fix:** Expected explicit duplicate rejection. Native JSON parsing collapsed duplicates. No signature bypass was demonstrated: signatures still bound the interpreted fields.
- **Impact/root cause:** Parser ambiguity and unnecessarily permissive protocol input; strict Zod validation happens after duplicates have been discarded.
- **Fix:** `shared/json.ts` validates against native serialized values after removing only insignificant whitespace. Duplicate members and alternate value encodings are rejected. All legitimate application-generated JSON remains supported. This is a wire-format policy, not cryptography.
- **Regression:** Strict JSON tests, direct mutation corpus, live LAN/local WS cases and API duplicate-body cases.
- **Status:** Fixed and retested.

### BC-SEC-004: browser processing chain lacked an explicit queue bound

- **Severity/component:** Low hardening finding; frontend transport lifecycle.
- **Prerequisite:** Incoming traffic arrives faster than async archive operations complete.
- **Safe reproduction:** A synthetic Backend callback supplies 300 network events without resolving the microtask queue. No real flood or host exhaustion is performed.
- **Expected/actual before fix:** Expected a bounded event backlog. Source inspection showed every event appended a Promise without a count limit. OS memory exhaustion was not attempted or demonstrated.
- **Impact/root cause:** Potential application memory/latency accumulation under sustained input; server frame rates alone do not bound an async browser queue.
- **Fix:** Maximum 128 queued events. Overload locks the vault, disconnects transport, clears decrypted state and reports the reason. Old epochs cannot resume handling. Only one timer job may be pending.
- **Regression:** Queue overload, locked-state stability and successful unlock in `tests/security.test.ts`; delayed-write lock race in the browser suite.
- **Status:** Fixed and retested. An attacker can still deny availability; the queue bound protects resources, not uptime.

### BC-SEC-005: vulnerable development esbuild dependency

- **Severity/component:** Low; development supply chain.
- **Prerequisite:** Advisory-specific Windows esbuild development-server use. Butter Chicken production does not expose an esbuild server; this Linux assessment did not reproduce the Windows exploit.
- **Safe reproduction:** The initial full `npm audit --json` reported `GHSA-g7r4-m6w7-qqqr`, affecting esbuild versions `>=0.27.3 <0.28.1`. Runtime-only audit had not revealed this development issue.
- **Expected/actual before fix:** Expected no current known advisories in the distributed lockfile; one low advisory was present.
- **Impact/root cause:** Advisory-described development file access; stale transitive dev dependency.
- **Fix:** Update exact tsx to 4.23.15 and Vite to 8.3.3; the locked esbuild version is now 0.28.2.
- **Regression:** `npm run audit:security` fails if npm reports any advisory; complete build/type/unit/network/browser checks after the update.
- **Status:** Fixed; final full advisory count zero. Advisory absence does not prove supply-chain integrity or future safety.

### BC-SEC-006: corrupted vault record escapes bootstrap error handling

- **Severity/component:** Low; storage recovery and bootstrap.
- **Prerequisite:** Local database corruption or a writer already able to alter its vault row. Not a network path to arbitrary database changes.
- **Safe reproduction:** An in-memory fixture inserts `{"corrupted":true}` into its own vault row and requests bootstrap. The Store parser throws for this invalid schema; the original bootstrap path did not catch it. No user's database is changed.
- **Expected/actual before fix:** Expected a recoverable storage error. Source review and direct Store validation identified the uncaught bootstrap exception path. No claim of a remotely exploitable corruption primitive is made.
- **Impact/root cause:** Damaged local data could turn an ordinary reload into service termination; bootstrap evaluated `store.vault()` outside its guarded API handling.
- **Fix:** Catch the vault-read error and return a generic HTTP 503 recovery message without corrupt contents or stack details.
- **Regression:** The corrupted-vault test verifies 503, removes the synthetic damaged row, then verifies normal bootstrap returns 200.
- **Status:** Fixed and retested.

### BC-SEC-007: pre-existing POSIX data directory may be permissive

- **Severity/component:** Low; filesystem setup.
- **Prerequisite:** Operator selects an existing directory readable/writable by other local users.
- **Safe reproduction:** The test creates a disposable directory, sets mode 0777, and attempts to create its test Store there.
- **Expected/actual before fix:** Expected a private dedicated directory. `mkdir(..., mode:0700)` does not alter an existing directory; database mode 0600 alone does not stop other directory writers deleting/replacing its entries.
- **Impact/root cause:** Local users can observe encrypted storage metadata or cause data loss; directory ownership/mode was not validated. Decrypting a locked vault still requires its passphrase.
- **Fix:** On POSIX, refuse data directories with group/other permissions or a different owner. New directories are 0700 and database files 0600. The app does not silently change permissions on arbitrary shared folders.
- **Regression:** POSIX directory refusal and actual 0700/0600 stat checks in `tests/store.test.ts`.
- **Status:** Fixed and retested on Linux. Windows requires private account ACLs; that platform guarantee is not asserted from chmod.

## Additional hardening and quality fixes

These changes do not represent demonstrated authentication bypasses and are not counted as additional vulnerabilities:

- Both HTTP listeners now bound total connections to 64, header count to 32, header timeout to 10 seconds, request/inactivity timeout to 15 seconds and keep-alive to five seconds.
- Invitation parsing now rejects arbitrary URLs, public IPs, ambiguous hosts and malformed literal addresses early, using the same private IPv4 policy as the backend. The backend already rejected these connection destinations, so there was no demonstrated SSRF/public connection path.
- Dense exported QR invites use integer pixel modules, a four-module quiet zone and a clean-code decode fallback. Five independently generated images passed. This fixes scanning reliability; it does not change trust checks or permit URL execution.
- Browser route interception in the regression harness now waits for handlers to finish. This was a test race, not an app authorization issue.
- Production builds clear stale client assets before rebuilding. The shipped demonstration image is an actual tested app screenshot with synthetic data.

## Cryptographic and identity review

The implementation uses libsodium's RNG, X25519 boxes with XSalsa20-Poly1305, Ed25519 signatures, BLAKE2b identity/safety-code hashes, Argon2id and XChaCha20-Poly1305 storage. Keys have separate roles: box secret 32 bytes; signing secret 64 bytes; independently generated archive key 32 bytes; derived vault key 32 bytes. Random challenge/token 32 bytes, box/storage nonce 24 bytes, KDF salt 16 bytes. Domain labels separate signing/hash inputs; fixed-order arrays encode signed fields. No homemade encryption, weak fallback, hardcoded operational key, private-key URL or normal plaintext transmission was identified.

Signatures are checked before trusted content handling; expected sender/recipient, identity fingerprint/key consistency, authenticated box opening, payload schemas and connection challenges must all pass. Human verification is enforced in ChatEngine, not merely by disabling a button. Backend Node intentionally cannot enforce peer-key trust itself because it has no private browser vault; protocol decisions happen in the browser and only encrypted archives reach Node.

The lack of ephemeral session keys/ratchets is a material cryptographic limitation, not something these tests repair. Replacing it requires a separately designed and independently reviewed protocol rather than casually adding a new crypto scheme. This assessment does not establish formal handshake security.

Restoring the **same** encrypted vault preserves the same identity and trust: exercised by reopening storage and restarting both services. Resetting to **new** keys under the same name triggers a pinned-identity warning: exercised. A copied encrypted vault was unlocked as an exact clone and its signed encrypted message validated against the original public identity. A full clone retaining the same private keys is cryptographically the same identity and cannot be detected reliably by this protocol. Two local tabs are restricted, but that is not clone detection across machines. Corrupted vault schema fails safely; authenticated encrypted corruption cannot silently replace a friend. Backup rollback and key theft remain outside the protection offered by pins.

## Supply-chain review

Direct dependencies are exact versions, with a supplied `npm-shrinkwrap.json` containing registry URLs and integrity hashes. It is included in the global installation tarball, so npm global installation also uses the reviewed transitive versions. The scan identified two install-script packages: esbuild 0.28.2, whose platform binary installer/version checks were inspected, and optional macOS fsevents 2.3.3, which is not installed on this Linux host. The latter installer was not executed or dynamically assessed. No app-owned install hook exists. Package integrity pins prevent unnoticed byte changes relative to the lock, but do not establish that a trusted upstream package is harmless.

Outdated direct packages remain: Node/React/WebSocket type definitions, ZXing browser/library, TypeScript and Prettier. They were reported, not automatically replaced with potentially incompatible majors. No known advisory was reported for those locked versions. A maintained version is not a guarantee of safety; review updates and rerun the full suite. There was no git history to assess dependency provenance over time, no independent registry attestation validation and no malware sandbox analysis of every transitive package.

## Remaining risks and limitations

| Risk                             | Why it remains / required operating practice                                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local process and code integrity | Native processes can bootstrap and mutate ciphertext storage; same-user malware can access files or change served JS. Use trusted OS/browser/code and a private user account. Cookie, Origin and CSRF defenses address malicious websites, not native process authentication |
| No forward secrecy or ratchet    | Long-term private-key compromise can expose earlier captured traffic. Independent redesign/review is needed before stronger claims                                                                                                                                           |
| Human first-pairing verification | Invitation substitution/stolen tokens can misdirect or disrupt users. Compare every safety-code group over an independently trusted channel                                                                                                                                  |
| Cloned/restored identities       | Same private keys are indistinguishable from the legitimate device. Remove trust and reset/reverify after suspected theft; backup rollback can restore old state                                                                                                             |
| LAN availability                 | Slot exhaustion, repeated reconnects, spoofed discovery and transport disruption can prevent chat. Caps/timeouts contain tested costs; no guarantee against sustained DoS                                                                                                    |
| Persistent growth                | History and replay records grow with authorized use. Pending retries are bounded per tick, but there is no total database quota or paginated history. Use suitable disk space and history controls; unpaired remote peers cannot create accepted chat records                |
| Metadata                         | Public keys, endpoint addresses, IDs, lengths/timing and SQLite delivery/order metadata are observable                                                                                                                                                                       |
| Password/at-rest protection      | Copied vaults permit offline guessing. Use a strong passphrase, private permissions and disk encryption; twelve characters alone is insufficient assurance                                                                                                                   |
| Memory/deletion                  | JS strings, browser/OS copies, swaps, crash dumps, SSD remapping, backups and the friend's copy cannot be guaranteed erased                                                                                                                                                  |
| Platform coverage                | No physical Wi-Fi/router, real multicast spoofing, camera hardware, Windows ACLs, macOS firewall or IPv6-only validation. Linux loopback simulations are not those tests                                                                                                     |
| Fuzz/analysis coverage           | Deterministic mutation tests, not exhaustive coverage-guided fuzzing; no sustained soak, formal verification, independent penetration assessment or complete static taint analysis                                                                                           |
| Transport/runtime                | Plain ws carries authenticated encrypted content; it reveals metadata. Production is local only. New internet/relay deployment requires separate security design                                                                                                             |
| Insider recipient                | A verified friend can capture/share plaintext, intentionally send duplicates under new IDs or maliciously retain keys. This app does not enforce recipient behavior                                                                                                          |

No accepted boundary is concealed as a passing local-process authentication check. The app is not suitable for a threat model requiring protection from a compromised endpoint or forward secrecy.

## Final security scorecard

PASS means the specified exercised boundary passed; it does not mean exhaustive security. FAIL entries are explicit unsupported guarantees, not claims of repaired protection.

| Category                                      | Result                    | Scope / qualification                                                                                                      |
| --------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| LAN authentication and authorization          | PASS                      | Unauthorized/reused tokens, key possession, trust and confirmation tested                                                  |
| Browser cross-site/loopback authorization     | PASS                      | Host/Origin/cookie/CSRF/generation checks tested                                                                           |
| Native local-process isolation                | **FAIL / unsupported**    | Native processes can bootstrap and mutate encrypted storage; trusted endpoint boundary                                     |
| Pairing and identity verification             | PASS                      | Two-sided confirmation, races, substitutions, reset and persisted pins tested; human comparison required                   |
| Cryptographic integrity/confidentiality tests | PASS                      | Established primitives and tested tamper/recipient/relay cases; not independent protocol certification                     |
| Forward secrecy/post-compromise security      | **FAIL / unsupported**    | Static long-term box keys, no ratchet                                                                                      |
| Replay protection                             | PASS                      | Same session, reconnect, actual service restart and deletion tested                                                        |
| WebSocket/input validation                    | PASS                      | Size/version/type/duplicate/rate/peer/local-client limits tested                                                           |
| XSS/injection                                 | PASS                      | Harmless actual browser message fixture, strict APIs, SQL binding and path cases tested                                    |
| Storage and reset                             | PASS                      | Encrypted persistence, replay tombstones, corruption recovery and Linux permissions tested; erasure/rollback limits remain |
| Known dependency advisories                   | PASS                      | Final full npm audit: zero; point-in-time advisory evidence only                                                           |
| Configuration/secrets                         | PASS                      | Current project heuristic scan, local binding and restrictive production headers; no git-history scan                      |
| Bounded DoS resilience                        | PASS                      | Specified small bursts/connection/queue tests only; no sustained availability guarantee                                    |
| Real two-computer/platform verification       | **FAIL / not yet tested** | Requires physical target machines and LAN                                                                                  |

| Finding severity | Discovered | Fixed | Unresolved in findings |
| ---------------- | ---------: | ----: | ---------------------: |
| Critical         |          0 |     0 |                      0 |
| High             |          0 |     0 |                      0 |
| Medium           |          2 |     2 |                      0 |
| Low              |          5 |     5 |                      0 |
| Total            |          7 |     7 |                      0 |

Accepted architecture boundaries are separately listed above and are not inflated into seven additional scored vulnerabilities. No authentication bypass, silent pin replacement, unrelated relay decryption, accepted ciphertext tampering, accepted old-session replay, operational private-key exposure, arbitrary code execution or injection was demonstrated in the final tested scope. These are observations with the stated coverage limits, not a proof of absence.

**Release gate:** no unresolved critical/high finding or tested trivial malformed-input crash remains. Deliver as a documented local application prototype; require independent protocol review and physical platform/LAN verification before higher-risk use.
