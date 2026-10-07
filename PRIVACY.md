# Butter Chicken privacy

Butter Chicken uses an internet relay to deliver encrypted messages when devices are not on the same network. The operator/URL is configured by the users; this ZIP does not provide a hosted account or collect analytics, advertising or telemetry.

Messages, display names and pairing tokens are encrypted on the user's device before transport. Private encryption/signing/archive/vault keys and the passphrase stay in the local browser/worker. The relay forwards signed ciphertext and cannot decrypt message contents without compromised endpoint keys. Local SQLite receives encrypted vault/history records; each user's permanent history remains on their device.

## Visible and stored metadata

The relay sees public identity keys and IDs, public pairing IDs, source IP, session/connect/disconnect timing, sender/recipient/message IDs, sender-declared timestamps, signatures, ciphertext length/volume and forwarding/receipt timing. Its pins store public peer identities/pairing IDs until authenticated unpin. Temporary mailbox rows store signed ciphertext and routing/expiry metadata for offline delivery, at most 24 hours after first acceptance. Exact retries do not extend an existing row's deadline. Expiry cleanup runs on startup, queue operations and every 15 seconds. A processed receiver requests deletion. Backups/provider snapshots can retain deleted bytes independently.

Local SQLite exposes IDs, direction, order, receipt state, ciphertext lengths and replay tombstones. LAN discovery exposes a random routing ID and address. End-to-end encryption does not hide all network metadata. Provider, ISP, DNS and certificate services have their own policies; a relay administrator must disclose any additional infrastructure logging/retention.

## Logs, browser permissions and deletion

Application relay logs use event names and server timestamps only, without names, packet bodies, pairing/auth tokens or private keys. The supplied proxy does not enable access logging. Infrastructure operators can change this, so review the actual deployment.

Browser local storage holds theme and auto-lock preferences only. The temporary HttpOnly cookie authorizes the local browser API. Optional QR-camera frames and uploaded QR images are processed locally. Invitations should be shared privately through a channel you trust.

History deletion affects one local device and retains replay tombstones. Removing trust unpins relay data when connected and deletes local history. If removed offline, its public server pin remains until the same identity next unlocks without a friend and automatically unpins, or the operator deletes it. Reset creates a new identity and cannot authenticate as an already destroyed old key to erase its relay pin. Temporary ciphertext still expires. The other person's copies, OS caches, SSD remapping and backups are not erased by this app.

READ is an authenticated acknowledgement that the active, visible chat UI displayed incoming messages; it does not prove human attention. It adds viewing/timing metadata. There is no opt-out read-receipt setting in this release.

There is no recovery service or password reset that recovers old history. Installing Node/npm dependencies or updating from GitHub contacts their suppliers. Actual operation uses the configured relay, optional LAN, and provider TLS/DNS infrastructure. No OpenAI, Firebase, paid broker or managed database API is used.

Updated 7 October 2026. This is the supplied software's behavior, not a promise about a modified version or an unknown relay operator.
