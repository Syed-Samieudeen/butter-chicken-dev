# Internet protocol extension (7 October 2026)

Production browser keys remain local; the Node bridge connects to the configured WSS relay. `shared/relay.ts` defines strict relay commands, canonical URLs and domain-separated Ed25519 auth/pin transcripts. A random relay challenge is signed with the configured URL/identity; fresh proof is required each reconnect. Public pair pins are mutually signed and must match the invitation epoch before mailbox writes.

A BC1 invitation may include `relayUrl`, covered by its signature. Clients reject a different configured URL, and never silently adopt a pasted endpoint. Live pairing still uses signed hello/fresh challenges, encrypted name/token auth, ready and two human verification messages. The invite ID becomes `Friend.pairId` inside each encrypted vault. Legacy pairs without this ID need re-pairing for offline mail.

Durable messages are existing version-1 signed `box` envelopes with strict encrypted payload `{type:"mail-chat",pairId,sequence,text}`. The outer Ed25519 signature already authenticates all ciphertext/nonce/IDs/timestamp; no custom cipher is added. Replies use `{type:"mail-receipt",pairId,messageId,state:"DELIVERED"|"READ"}`. Both direct LAN and relay routes can carry this durable format. Unlike handshake controls, mail is not connection-challenge-bound: it must remain valid across disconnects. The pinned identity, pair epoch, authenticated sequence and persistent message-ID tombstone replace that freshness condition for durable mail. Timestamps are not replay protection. Reordering is detected/reported rather than requiring a contiguous sequence.

Group creation sends an encrypted `mail-group-invite` to each selected, already-paired contact. It carries a common group ID, creator identity, member IDs/names and creation time. A recipient accepts the metadata only from the named creator over the existing trusted pair and only when the recipient appears in the roster. Each group chat message is encrypted and signed separately for each recipient using their existing pairwise identity and relay-pair ID. A random `groupMessageId` is shared inside those envelopes so the sender's local UI can deduplicate its fan-out copies and group replies can target the same logical message. Since relay delivery requires mutual per-contact pins, every participant must pair with every other participant via the six-digit flow before they can send to the full group.

The outgoing counter is inside the encrypted vault. Each exact signed mail envelope is inside its encrypted local archive, allowing stable retries after process restart. Relay commands route and consume envelopes, but cannot generate a valid encrypted receipt. The relay checks sender signature/recipient and matching pins; receivers independently verify/decrypt before atomic local archive+tombstone insertion. Duplicate history and old-pair mail are rejected. Deleting history retains tombstones; older backups can roll them back.

Relay rows include ciphertext, sender/recipient/message IDs, public epoch and expiry only. Queues are bounded and expire after 24 hours, with cleanup every 15 seconds/on operations. Matching retransmissions do not refresh an existing row. Public pins persist until authenticated unpin; no-friend clients unpin their old own registration when reconnecting. Reset keys cannot remove an unreachable old identity's pin.

SENT is server acceptance, DELIVERED is signed peer save, READ is signed active chat display. Local queued archives survive relay loss/expiry. Reconnect is exponential with jitter and 60-second cap. Production TLS failure never falls back to WS/HTTP. The LAN default has no transport TLS but retains application box/signature authentication. No forward secrecy/ratchet is added. See SECURITY.md and relay/README.md for exact boundaries.

## LAN baseline protocol reference

The following sections describe the original live LAN handshake and session-bound chat format, retained for legacy LAN compatibility. New internet-enabled pairings use the durable extension above for chat/receipts.

# Protocol version 1

These application messages are built on established libsodium APIs. The complete application protocol is new and unaudited, and does not provide forward secrecy. The authoritative strict schemas are in `shared/protocol.ts`, `client/crypto.ts` and `client/engine.ts`.

## Transport boundary

Each browser has an authorized loopback `/local` WebSocket to its own Node process. Node services use `/lan` WebSockets to forward validated opaque frames. Only the browser decrypts. Discovery advertises `_butterchicken._tcp`, a random routing node ID, version and port; discovered addresses do not confer trust.

The wire permits two frame kinds: `hello` and `box`. JSON uses explicit version 1 and rejects extra or duplicate fields. Values use native `JSON.stringify` encodings; insignificant whitespace between tokens is allowed. Alternate number/string escape encodings are rejected by the strict parser. Encoded bytes use canonical unpadded base64url; IDs use lowercase hexadecimal. Maximum LAN frame size is 65,536 bytes. Text messages are limited to 8,000 characters and 32,000 UTF-8 bytes.

## Public identity and hello

The identity contains a 32-byte X25519 public key, 32-byte Ed25519 public key and a 32-byte BLAKE2b digest of a domain-separated canonical array binding both keys. A hello includes that identity, a fresh random 32-byte challenge and an Ed25519 signature binding all its fields. A hello alone proves only the signing key’s possession and is not enough to trust chat.

Canonical signing inputs are JSON arrays in a fixed field order, encoded as UTF-8, with separate `ButterChicken/.../v1` prefixes for identities, hellos, envelopes, invitations and safety codes. These are application encodings, not newly implemented cryptographic algorithms.

## Signed box envelope

| Field                      | Meaning                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `version`                  | Exactly 1                                                            |
| `kind`                     | Exactly `box`                                                        |
| `senderId` / `recipientId` | Identity digests, checked against the expected peer and local device |
| `messageId`                | Random 16-byte logical message ID, 32 hex characters                 |
| `timestamp`                | ISO-8601 sender assertion; never the replay/freshness authority      |
| `nonce`                    | New random 24-byte nonce, base64url                                  |
| `ciphertext`               | Libsodium public-key box output including its Poly1305 authenticator |
| `signature`                | Ed25519 signature over all preceding envelope fields                 |

The box encrypts an application payload using the sender’s X25519 private key and recipient’s public key. The receiver checks the complete outer signature with the pinned Ed25519 key, expected IDs, authenticated box opening and strict payload schema. Every decrypted payload contains both `senderChallenge` and `recipientChallenge`, checked against the current connection. An unrelated relay with only public keys and ciphertext cannot open the box.

## Pairing flow

The human-facing pairing step is a relay-mediated, single-use six-digit code that expires after ten minutes. The relay keeps the signed invitation described below behind that code; users do not paste or scan the internal `BC1.` invitation.

1. A creates a signed `BC1.` invitation: version, identity, private LAN endpoint, random 32-byte token, random invitation ID and ten-minute expiry. The entire invitation is base64url-encoded JSON text, not a URL.
2. B verifies its structure, expiry and embedded-key signature, connects to its endpoint and expects A’s exact public identity.
3. Both send signed hellos with fresh challenges. B sends encrypted `auth`, including both challenges, its name/endpoint, the invitation ID and token.
4. A checks the token in constant time against its in-memory, unused invitation. A consumes it and sends its encrypted `auth` response with the same invitation ID and no token.
5. Each endpoint checks the echoed challenges and sends encrypted `ready`. A device cannot decrypt the challenge-bearing response without the required box private key. Reaching ready establishes possession checks, not saved human trust.
6. Both display a 16-byte BLAKE2b safety code binding the sorted pair of complete public identities. Each human compares all eight hex groups independently and sends encrypted `verify` for that invitation ID.
7. Once both confirmations are present and the pairing has not expired, each endpoint encrypts and saves the exact peer public keys in its vault. Only then can chat be accepted.

An interrupted pairing or storage failure can save trust on one side before the other. Remove any partial trust and repeat verification; do not silently replace keys. A short six-digit code is not used as an authentication secret.

## Subsequent connections

Both hellos must match the previously pinned identity. Encrypted auth/ready binds fresh challenges and proves private-key possession. No invitation token is accepted in a previously trusted connection. An unexpected outbound identity triggers a warning and is rejected. Unknown inbound identities are ignored without becoming trusted.

Connection states are `DISCOVERING`, `CONNECTING`, `AUTHENTICATING`, `CONNECTED`, `DISCONNECTED`, `PAIRING_REQUIRED` and `IDENTITY_CHANGED`. Public UI status derives from the browser’s cryptographic decisions, not a discovery advertisement. A warning stops automatic reconnect until the user inspects or resets trust.

## Delivery, replay and ordering

The sender encrypts and saves the outgoing archive before transmission. The receiver atomically saves the encrypted archive and `(senderId,messageId)` replay tombstone before acknowledging. Duplicate copies are acknowledged but do not display twice. The sender marks delivery only after an authenticated ACK for a local outgoing ID from its pinned friend.

Pending messages retry every five seconds while connected and after reconnect, up to 50 per tick, with a new nonce/envelope but the same logical ID and original sender timestamp. Session challenges reject packets captured from prior connections. In-memory control IDs are bounded and duplicate control envelopes are ignored. Replay tombstones survive history deletion and removal of a friend.

There is no global trusted ordering or trusted sender clock. Histories follow local insertion order. An incoming bubble uses its local receipt timestamp; the sender’s signed timestamp is available as a tooltip. No typing/read-receipt or attachment protocol is included.

## Persistence and resets

Vault encryption is Argon2id-derived XChaCha20-Poly1305. History records use a distinct random archive key and associated data binding record ID, peer and direction. Node only validates and stores encrypted structures.

Reset removes the vault, messages and replay ledger, while retaining the non-authenticating routing node ID. A new identity is generated on first run and must be reverified by the other device. Reset rotates a local API generation token to reject writes issued by stale clients. Restored backups can roll state back; no trusted monotonic counter protects against that.

## Resource boundaries

There are at most eight peer WebSockets, 100 frames per second per peer, 1 MiB transport buffers, a 1 MiB HTTP body cap and 64 TCP connections per HTTP listener. Compression is disabled. HTTP header timeout is 10 seconds and request/inactivity timeout 15 seconds. The browser queue permits 128 events, with one pending timer job; overload locks and disconnects rather than accumulating work. These bounds do not guarantee LAN availability.
