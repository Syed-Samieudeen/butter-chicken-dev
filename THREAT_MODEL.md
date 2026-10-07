# Butter Chicken threat model

## Assets and trusted endpoints

Private X25519/Ed25519 keys, archive/vault keys, passphrase, pairing token, displayed plaintext, saved trust and replay ledger belong on the clients. Both OS accounts, browsers, extensions, local code and dependencies must be trusted. The localhost Node service is inside that endpoint boundary. Same-user/native malware or an administrator is not isolated by browser cookies/CSRF. No forward secrecy, ratchet, secure OS enclave, trusted anti-rollback state or guaranteed memory erasure exists.

## Adversaries and boundaries

| Adversary                     | Expected protection                                                                                                | Limits                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Passive internet/LAN observer | Message/name/token contents encrypted in browser; WSS protects internet hop                                        | Traffic/IP/size/time metadata persists; LAN uses authenticated encrypted boxes over plaintext WS                                              |
| Malicious relay/operator      | Cannot forge a newly valid friend's envelope or decrypt without endpoint private keys                              | Can observe identities/routes/timing, drop/delay/reorder/replay, lie about SENT and deny service                                              |
| Unpaired stranger             | Fresh signed identity proof, relay pair authorization, endpoint invitation token/code confirmation and pinned keys | Can attempt bounded unauthenticated sessions; initial unpaired identities are self-generated, not an external real-name identity provider     |
| Malicious website             | Local Host/Origin/FetchMetadata/cookie/CSRF/reset guards, CSP, React text rendering                                | Native local processes are outside this browser boundary                                                                                      |
| Stolen locked disk/vault      | Argon2id plus encrypted vault/archive and private file permissions                                                 | Offline password guesses, filesystem snapshots and weak passphrases remain risks                                                              |
| Trusted malicious friend      | Signed sender and valid ciphertext checks prevent outside substitution                                             | A recipient can retain/share plaintext and intentionally send new malicious traffic; signatures are not behavioral trust                      |
| Cloned/restored identity      | Exact key pins distinguish changed keys                                                                            | Identical stolen keys are indistinguishable. One active relay session helps contain accidental duplication, not cryptographic clone detection |
| Distributed flooder           | Application and container bounds constrain tested small local cases                                                | No public DDoS, sustained load or availability guarantee; provider/network controls required                                                  |

## Pairing and replay

Invitations contain a high-entropy one-time token, signed identity, expiry, local endpoint and optional signed relay URL. Relay routing sees identity/pair IDs but not the encrypted token/name. Both humans independently compare the whole safety code. After mutual confirmation, each vault stores the same random invitation ID as its pairing epoch. A relay mailbox requires matching signed endorsements from both identities. An endpoint rejects wrong identities, epoch, recipients, altered outer metadata or invalid box contents. New pair epochs prevent old-pair mail acceptance. Legacy pairs must re-pair for offline delivery.

Live handshake control frames retain fresh challenge binding. Durable mail frames deliberately survive disconnects, using persistent sender/message-ID tombstones plus an authenticated pairing epoch and encrypted sequence, not timestamps for freshness. Duplicate retransmissions do not create another history entry. Out-of-order signed sequences are displayed as delayed; missing sequences are not fabricated. This release does not require contiguous sequencing, so a malicious relay can suppress or reorder delivery without forging message content. Deleting history retains the replay ledger. Restoring an older backup can roll it back.

## Relay and hosting boundary

The relay is not a trusted endpoint. It stores temporary signed ciphertext plus public routing metadata, not permanent chat history. Ciphertext is removed on recipient consume/expiry, at most 24 hours plus the bounded 15-second cleanup interval after expiry; deleted SQLite/cloud media and snapshots cannot be guaranteed erased. Public signed pins persist until authenticated unpin. Local pending messages survive relay data loss and can be retried.

Production clients require WSS and normal certificate validation. Auth proofs include the canonical relay URL; signatures cannot simply be moved across relay audiences. The supplied TLS proxy is trusted to terminate TLS and protect its isolated native HTTP hop. Never publish the native plaintext relay port; an HTTPS header is meaningful only behind that protected proxy. Compromise of the public proxy can inspect metadata and sabotage delivery, but cannot decrypt client boxes. Compromise of locally served client code can steal keys and is a separate, stronger endpoint failure.

## Assessment limitations

Only this application and isolated local fixtures were assessed. No public relay, provider account, unrelated host or network was targeted. Physical two-network/mobile/Windows/macOS testing, Docker runtime, live DNS/ACME, distributed load, independent cryptographic review and formal verification remain pending. There is no “unhackable” guarantee.
