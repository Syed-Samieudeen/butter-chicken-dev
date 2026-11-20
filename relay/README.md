# Butter Chicken relay deployment

This directory contains the implemented Node 24 + ws + native SQLite relay. It shares the existing pinned dependencies. A single process is appropriate for a small private deployment; it is not a horizontally scaled messaging platform.

**Cloudflare option:** For easy internet messaging/pairing through Cloudflare, use the included Cloudflare Worker + Durable Object relay in [`../cloudflare/relay/`](../cloudflare/relay/README.md). Deploy it to your Cloudflare account and configure `BC_CLOUDFLARE_RELAY=<your-worker-host>` (or `BC_RELAY_URL=wss://<your-worker-host>/relay`) on both computers.

The Node relay below remains available for self-hosted deployments (for example with Docker + Caddy TLS termination).

## Production deployment

Prerequisites: a public Linux server with Docker Engine and Compose v2, and a DNS name you control. Both clients make outbound connections only. Users do not configure routers, open incoming internet ports or know their friend's IP. The relay administrator configures the public server once.

1. Clone your GitHub repository onto the public server.
2. Point the DNS A/AAAA record for `relay.your-domain.example` at the server. Remove an incorrect/unreachable AAAA record.
3. Permit inbound TCP 80 and 443 on the server firewall/cloud security group. Do not expose 8787, SQLite, Docker administration or either client's UI. Restrict SSH to the administrator.
4. In the project:

```bash
cd relay
cp .env.example .env
```

Edit `.env`: set `RELAY_DOMAIN` to the real DNS name. This value is public configuration, not a password. Do not commit actual environment files.

```bash
docker compose --env-file .env build
docker compose --env-file .env up -d
curl --fail https://relay.your-domain.example/health
docker compose --env-file .env logs --tail=50 relay
```

Caddy obtains and renews publicly trusted TLS certificates. The relay container has no published host port. Only the isolated Compose network reaches its plaintext internal hop; Caddy sets the trusted HTTPS marker. A compromised proxy/container host breaks this transport boundary. If replacing Compose, keep the native listener on loopback behind a trusted TLS proxy and never expose it directly. The marker alone is not proof of TLS on an exposed listener.

Set **exactly the same** `BC_RELAY_URL=wss://relay.your-domain.example/relay` on both clients, in their printed `config.env`, then restart the local apps. Production clients reject `ws://`; normal certificate validation remains enabled. No automatic insecure downgrade or redirect following occurs.

## Development, isolated loopback only

From the project root, Node 24:

```bash
npm ci
npm run build
```

POSIX:

```bash
RELAY_DATA_FILE=/absolute/private/test-dir/relay.sqlite npm run relay:dev
BC_RELAY_URL=ws://127.0.0.1:8787/relay npm run dev
```

PowerShell:

```powershell
$env:RELAY_DATA_FILE="$env:LOCALAPPDATA\ButterChickenRelayTest\relay.sqlite"
npm run relay:dev
```

In a second terminal set `$env:BC_RELAY_URL="ws://127.0.0.1:8787/relay"` and run `npm run dev`. For two clients on one machine use separate browser profiles, UI/LAN ports and private data directories. No public insecure development bind is supplied. The application test harness explicitly enables a loopback relay for isolated tests.

Native production environment variables: `RELAY_PUBLIC_URL` (required canonical WSS URL ending `/relay`), `RELAY_PORT` (default 8787), `RELAY_HOST` (default 127.0.0.1), `RELAY_DATA_FILE` (default `/data/relay.sqlite`). Start compiled service with `npm run relay:start`; put a trusted TLS reverse proxy in front. There is no deployment API token in the app. Hosting/DNS credentials belong in the provider's administration tools, never Git.

## Authentication, limits and storage

A fresh random challenge authenticates an Ed25519 identity, including the canonical relay URL in the signed proof. Auth deadline: 5 seconds. Connections: 64 process-wide, one active per identity. Sessions: 1 hour maximum; clients reconnect with fresh proof. Frames: 64 KiB plus bounded wrapper. Commands: 60/second and 512 KiB/second per connection. Links: 4 per identity. Offline queues: 256 envelopes per recipient and 4096 total. Pins: 10,000 total. Slow send buffers above 1 MiB are closed. Pings and stale-session cleanup run every 15 seconds. The native HTTP/TCP limits also bound headers and idle sockets. Container memory/CPU/PID limits and bounded logs are configured.

Pins store public identities and pairing IDs only. A mailbox accepts messages only when both identities have signed matching pair endorsements. Pair tokens and display names stay inside client-encrypted handshake messages. The relay verifies envelope sender signatures and recipient authorization but never decrypts envelopes.

Ciphertext expires no later than 24 hours after first acceptance and is purged on startup, queue operations and the 15-second maintenance cycle. Exact retransmissions do not refresh expiry. Receiver `consume` removes queued ciphertext after local processing and after submitting its encrypted receipt. Only the named recipient can consume its inbox. A lost receipt causes the sender to retry, and the receiver's persistent tombstone prevents a duplicate chat entry. Relay acceptance is SENT, not DELIVERED. Public pins remain until authenticated unpin; they have no automatic retention timer. Removing trust deletes that identity's relay pins/queued mail when connected. Relay backups/cloud snapshots are outside application erasure; avoid backup retention for temporary ciphertext.

The SQLite volume persists across restarts and deployments. Do not run multiple relay replicas against separate stores or a shared SQLite file. No access-log payloads, auth tokens, names, pairing secrets or messages are logged. Structured logs contain event names and server timestamps only. Health reveals service/protocol status, not identities or mailbox contents.

## Updates and rollback

Record the current Git commit and locally built image ID before upgrading. Stop/recreate containers without deleting volumes:

```bash
git pull --ff-only
docker compose --env-file .env build
docker compose --env-file .env up -d
curl --fail https://relay.your-domain.example/health
```

For rollback check out the previously verified commit, rebuild and run `up -d` again. Do not use `down -v`: it deletes queues and public pins. A rollback must be storage-compatible; this release introduces the initial two-table relay schema. Browser clients retain local outgoing/history data independently of relay state. Avoid routinely backing up relay mailboxes; if an operational snapshot is needed, stop the relay first, protect it and delete it within the same retention policy.

Base images currently use `node:24-bookworm-slim` and `caddy:2` maintained release channels. Resolve, review and pin digests for a controlled production rollout; actual Docker/Caddy binaries were not downloaded or run in the restricted test environment. npm dependencies are exactly shrinkwrapped. Docker deployment and public TLS are configuration deliverables, not claimed live tests.

## Free options and optional paid production options

The relay code, Node, SQLite, ws and Caddy have no per-message API fee. Existing suitable public infrastructure can run this at no additional software charge; electricity, bandwidth, DNS/domain and host costs still apply. No hosted relay account is provisioned in this ZIP.

Oracle's Always Free page, checked 7 October 2026, lists up to two AMD micro instances, or A1 free-tenancy capacity of 1,500 OCPU-hours/9,000 GB-hours monthly (equivalent to 2 OCPUs/12 GB), plus 200 GB combined boot/block storage in the home region. Capacity can be unavailable; idle instances may be reclaimed. Its separate paid-tenancy A1 allowance differs, so check your actual console, avoid paid resources and confirm limits before provisioning. A small two-user deployment may qualify, but there is no uptime or capacity guarantee. Account verification and a domain may still be required. Source: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm .

Optional paid: any suitably sized public Linux VM and a domain for the self-hosted Node relay. Prices vary by provider/region; there is no paid provider or spend authorization configured here. Obtain exact quotes before purchasing. Alternatively, the included Cloudflare Worker relay can run on Cloudflare's platform (subject to your account's plan, limits, and terms) - see [`../cloudflare/relay/README.md`](../cloudflare/relay/README.md). Neither GitHub Pages nor ordinary ephemeral/serverless HTTP functions host the Node relay.

TLS reference: https://caddyserver.com/docs/automatic-https . Reverse proxy reference: https://caddyserver.com/docs/reverse-proxy .

## Troubleshooting

- No relay: check both canonical URLs match, production uses WSS, DNS resolves, `health` succeeds and apps are unlocked.
- TLS failure: fix domain/certificate/clock/proxy. Never disable certificate verification.
- 1008/reconnect: wrong public URL, invalid protocol, exceeded limit, duplicate identity clone, expired session or pending/old server pin. Check event-only logs.
- Old pairing: legacy LAN pairs lack a pairing epoch. Remove trust on both clients and pair once after relay configuration to enable offline internet delivery.
- Queue full: sender retains ciphertext locally and retries. Receive/delete queued messages or wait for expiry. A 24-hour relay expiry does not delete the local pending copy.
- LAN changes: relay retries automatically. Direct LAN listener binding may require a local service restart; no IP entry is needed for internet fallback.
- Scaling/DoS: these bounds do not stop distributed denial of service. Add provider network protection and alerts; do not confuse local bounded tests with a public load certification.
