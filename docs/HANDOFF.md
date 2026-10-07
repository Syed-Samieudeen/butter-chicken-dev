# Butter Chicken internet handoff

The updated **ButterChicken-Final.zip** contains implemented frontend, local backend/global CLI, internet relay, shared signed protocols, tests, scripts, Docker/TLS deployment configuration, all guides, exact npm shrinkwrap, production assets and ready `butter-chicken-1.0.0.tgz`. It is not a mock or documentation-only archive. It includes no personal databases, private keys, live credentials or installed dependencies.

## Install and terminal launch

Install Node 24. Extract ZIP, open `butter-chicken`:

```bash
npm install --global ./butter-chicken-1.0.0.tgz
butter-chicken
```

Open the printed localhost URL. Global command works from any directory; Ctrl+C stops it. `butter-chicken status`, `--version`, `--help` are supported. Windows can use `.cmd` shims. Private data stays in the OS user-data directory outside installation; README lists all locations and PATH fixes.

## Deploy once, then message from anywhere

A relay must be hosted before internet messaging is usable. [relay/README.md](../relay/README.md) gives exact production/dev environment, compose build/start, DNS, TLS, logs, health, storage, limits, update and rollback steps. No host is provisioned or public service address supplied here. No user router forwarding or incoming internet port is required. A server administrator exposes only TLS/ACME ports on the public relay host.

Each client stops its app and adds to its printed `config.env`:

```dotenv
BC_RELAY_URL=wss://YOUR-DEPLOYED-RELAY-DOMAIN/relay
```

Use exactly the same real domain URL on both computers, restart, then create/unlock separate identities. Privately share one-time BC1 invitation/QR, compare every safety-code group on an independent trusted channel, and both confirm. Future launches use saved pins. [FRIEND_SETUP.md](FRIEND_SETUP.md) includes beginner steps. Legacy pairs must re-pair once for a durable pairing epoch.

LOCAL uses authenticated direct LAN; INTERNET uses WSS relay; OFFLINE retains encrypted local pending copies. Messages progress through QUEUED/SENDING/SENT/DELIVERED/READ or FAILED with retained retry. COMPOSING is a local composer state. Relay SENT is not delivery. READ means active visible chat displayed the message, not human attention. Offline ciphertext lasts at most 24 hours plus cleanup scheduling; sender local pending survives longer. Reconnect uses exponential backoff/jitter capped at 60 seconds. Local service shutdown requires restart/reload/unlock.

## GitHub push and friend clone

Create an empty repository. Replace the username/repository before running:

```bash
git init
git add .
git commit -m "Butter Chicken internet messaging"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/butter-chicken.git
git push -u origin main
```

Inspect staged files; exclude live `.env`, user data, passwords, cloud credentials and private keys. The supplied ignore rules cover normal generated/sensitive files. GitHub hosts the code, not the live relay. The clone needs a rebuild because compiled assets/bundles are ignored:

```bash
git clone https://github.com/YOUR_USERNAME/butter-chicken.git
cd butter-chicken
npm ci
npm run pack:release
npm install --global ./butter-chicken-1.0.0.tgz
butter-chicken
```

Configure the same real relay URL on the friend's computer before pairing. Updates: stop, back up private data while stopped, `git pull --ff-only`, `npm ci`, `npm run check`, `npm run pack:release`, reinstall the tarball and relaunch. Reinstall/uninstall do not delete the separate private data. Typed REMOVE/RESET handle trust/identity removal, not passphrase recovery.

## Inventory, services and costs

The complete technology/tool and exact direct dependency inventory is in [README.md](../README.md#technology-stack--tools). The same Node/native HTTP/SQLite/ws/libsodium/Zod stack implements the relay. No cloud SDK, new npm dependency, paid API, managed database or message broker was introduced. Production hosting uses Docker + Caddy TLS channels, whose deployed image digests/actual versions must be recorded by the operator; these containers were not executed here.

External services at runtime: configured relay host, its DNS/TLS certificate infrastructure, optional local mDNS. GitHub/npm/Node suppliers are used for obtaining/updating software, not chat payload APIs. No OpenAI, Firebase or Cloudflare service is used. The relay operator may choose any suitable public infrastructure. No API key or relay password is needed by clients; Ed25519 proves identity.

FREE OPTIONS and OPTIONAL PAID / PRODUCTION OPTIONS are separated in README and relay guide. No per-message software/API fee exists. Existing public infrastructure or a qualifying free VM may avoid an additional compute charge; free capacity/idle-reclamation/bandwidth/domain limits still apply. The dated official Oracle example is documented with its live quota caveats. No blanket zero-cost, uptime or provider-account promise is made. Confirm exact paid quotes before purchase; no spending occurred.

## Security, privacy and verification

[SECURITY.md](../SECURITY.md), [THREAT_MODEL.md](../THREAT_MODEL.md), [PRIVACY.md](../PRIVACY.md) and [SECURITY_AUDIT.md](../SECURITY_AUDIT.md) document keys staying in browser, signed identity/pins, encrypted pairing, durable replay/deduplication, metadata, resource limits, findings/fixes and tests. Relay operators cannot create a valid friend's new envelope or decrypt without endpoint keys, but can observe/drop/reorder/replay traffic. No forward secrecy, endpoint malware isolation, guaranteed deletion or distributed-DoS guarantee exists.

[VERIFICATION.md](VERIFICATION.md) distinguishes actual isolated Node/browser/TLS/global-installer tests from unavailable physical tests. **Two-network internet testing could not be physically verified in this environment.** Use [TWO_COMPUTERS.md](TWO_COMPUTERS.md) for the exact different-Wi-Fi/mobile procedure. Public relay deployment, Docker/ACME/DNS, Windows/macOS ACL/firewall and physical camera/router/sleep-wake tests remain pending. GitHub commands were not executed against a user's account. Troubleshooting is in the root guide and relay guide.

Optional source security verification: `npm run check` requires OpenSSL for the disposable TLS certificate test. Normal installation and chat do not require OpenSSL. The release was verified with OpenSSL 3.0.13; install that test prerequisite before running the complete suite on another computer.
