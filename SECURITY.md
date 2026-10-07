# Butter Chicken security model

Butter Chicken encrypts in the browser before using either LAN or a configured WSS internet relay. The complete application protocol is new and has not been independently audited. It uses established libsodium primitives, but has **no forward secrecy, double ratchet or post-compromise security**. Read [THREAT_MODEL.md](THREAT_MODEL.md), [PRIVACY.md](PRIVACY.md) and [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Endpoint trust and cryptography

Each browser creates X25519 box and Ed25519 signing keys; a BLAKE2b-256 fingerprint binds both. The 128-bit safety code binds both complete identities. Libsodium secure RNG supplies keys, 32-byte challenges, message IDs and 24-byte nonces. Network boxes use `crypto_box_easy` (X25519/XSalsa20-Poly1305). Ed25519 covers every outer envelope field, including recipient, ID, timestamp, nonce and ciphertext. The receiver pins keys, verifies signatures/box authentication, and strictly validates decrypted payloads before display.

Argon2id uses two passes, 64 MiB and a random 16-byte salt to derive a 32-byte vault key. XChaCha20-Poly1305 protects the vault and local archives with separate archive keys and record-bound associated data. The browser worker does expensive password derivation. Passphrases/private keys are not sent to local Node or relay. A locked vault can still be guessed offline; choose a strong passphrase and use disk encryption/private OS permissions.

Static long-term box keys mean later key compromise may expose recorded old traffic. There is no cryptographic identity-clone detection: copied private keys are the same identity. JavaScript strings/browser/OS copies cannot be reliably zeroed. Lock closes transport, removes visible history and best-effort wipes explicit buffers; it is not an OS screen lock.

## Internet authentication, pairing and authorization

Production connections use WSS with ordinary certificate validation, no redirect following and no insecure fallback. Dev WS is permitted only on explicit loopback addresses under development/test configuration. Client config never automatically trusts a relay named by an invitation; the signed invite URL must match the already configured URL.

The relay challenges each connection with fresh 256-bit random data. Ed25519 proof binds that challenge, complete identity and canonical relay URL. Five-second auth deadline, one active session per identity and one-hour session expiry bound exposure. Names/IPs are not credentials. TLS protects a session after authentication; possession of the user's private signing key is needed for fresh proofs.

The existing ten-minute, one-time 256-bit invitation token stays inside client-encrypted handshake boxes. Fresh connection challenges protect live controls. Both users must independently compare every safety-code group and confirm before saving exact key pins. A token thief can disrupt initial pairing but cannot silently replace the verified key without defeating the code comparison.

A new pair stores the invitation ID as its persistent epoch. Both endpoints sign matching relay endorsements; the relay permits temporary mailbox writes only for mutually pinned identities with the same epoch. A stranger cannot enter an established conversation or consume another recipient's queue. The relay sees public keys/IDs/epoch, not pairing secrets. Removing trust while connected unpins local identity relay state. Offline removal/reset cannot erase unreachable old public server pins; temporary ciphertext expires regardless.

## Offline messages, replay and receipts

Durable mail uses the same signed encrypted envelope primitives on both relay and direct LAN paths. The encrypted payload includes the pair epoch and a sender sequence. Unlike live handshake controls, it is not tied to a connection challenge, so it remains valid across restarts. The browser verifies the pinned sender, correct recipient, signature, box, payload and epoch. Its SQLite transaction atomically saves an encrypted archive and a persistent `(sender,message ID)` tombstone before sending an encrypted receipt. Exact retransmission never creates a second history entry, including after deleting visible history. Tombstones reset only with an identity reset. Backup rollback can undo replay state.

Outgoing sequence counters are stored inside the encrypted vault before creating the archive. Gaps can follow interrupted writes. Receiving out-of-order authenticated sequences raises a delayed-message notice; there is no contiguous-order blocking or trusted global ordering. Timestamp alone is never freshness protection. Relay retries keep the exact saved ciphertext/ID; existing queue rows are not rewritten/refreshed by a retry.

SENT is a relay acceptance statement and can be lied about by a malicious relay. DELIVERED/READ require encrypted signed receipts from the pinned friend. DELIVERED confirms local save. READ means displayed in the active visible chat UI, not human comprehension. Offline messages stay encrypted locally; relay loss/TLS failure does not erase them or downgrade encryption. Temporary relay ciphertext expires within 24 hours plus periodic cleanup scheduling. Permanent chat history remains local.

## Browser, local API and storage

The UI/API bind to 127.0.0.1 and require socket/Host/Origin/FetchMetadata checks. HttpOnly SameSiteStrict cookies protect API reads; CSRF and data-generation tokens protect mutations, including ordered reset/late writes. A single local WebSocket is allowed. Strict duplicate-rejecting JSON and Zod schemas, body/frame limits, static-path containment, CSP/noindex/anti-framing headers, parameterized SQLite and React text rendering address tested cross-site, injection and validation cases.

Native processes on the same endpoint can obtain bootstrap credentials and mutate/read encrypted storage/metadata. Cookies/CSRF are browser defenses, not OS-process authentication. Compromised local code can serve malicious JavaScript and steal unlocked keys. Both OS/browser/code endpoints must be trusted.

On POSIX, local data directories must be owned by the user with 0700 permissions and databases use 0600; Windows relies on private user ACLs, not physically tested here. Local history/replay records can grow with authorized use. Deletion cannot guarantee removal from snapshots/backups/SSD layers or the other person's device.

## Relay resources and deployment

The relay has no decrypt path or private keys. It validates signed senders and routing, caps frames/commands/connections/link/mailbox/total storage rows, uses expiry, auth/session deadlines, heartbeat and backpressure. Structured logs contain event name/time only. Delivery polling is batched to eight envelopes; live submissions forward once rather than amplifying a mailbox rescan. See [relay/README.md](relay/README.md) for exact limits.

TLS terminates at Caddy on a public host; the plaintext internal listener must stay isolated or loopback behind that trusted proxy. Never publish port 8787 or trust a spoofable HTTPS marker on an exposed native listener. The container deployment includes CPU/memory/PID/log bounds, persistent storage, health, update and rollback instructions. No cloud credentials/API keys belong in Git.

These controls do not guarantee public availability against distributed DoS or eliminate metadata visibility. No sustained public load, Docker runtime, ACME/DNS deployment or physical two-network test was performed. No critical/high issue was identified in the bounded local assessment; that is not evidence of their absence in all circumstances.
