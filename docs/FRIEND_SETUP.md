# Setting up Butter Chicken with your friend

Each person needs Node.js 24, a browser and their own copy of the app. For different Wi-Fi/mobile networks, both computers must use the same internet relay URL. The easiest option is the included Cloudflare Worker relay: deploy [cloudflare/relay/README.md](../cloudflare/relay/README.md) to your Cloudflare account (or use an already-deployed compatible worker) and configure its `wss://.../relay` URL on both computers. You can also self-host the included Node relay using [relay/README.md](../relay/README.md). GitHub stores the source; it does not run the relay. No friend IP, router setting or port forwarding is needed.

## You: final ZIP

Extract the ZIP and open a terminal in `butter-chicken`:

```bash
npm install --global ./butter-chicken-1.0.0.tgz
butter-chicken
```

Open your printed localhost URL. Stop with Ctrl+C. Open the printed `config.env` path and add your Cloudflare relay (same URL on both computers):

```dotenv
BC_CLOUDFLARE_RELAY=butterchickenworker.bakri-downtime-sub.workers.dev
# or: BC_RELAY_URL=wss://butterchickenworker.bakri-downtime-sub.workers.dev/relay
```

If you use a different deployed relay, replace the host/URL with that relay's real address. Relaunch `butter-chicken`, create/unlock your own identity and check Internet: relay connected. The relay URL is public configuration, not a pairing secret.

## Your friend: GitHub

Replace `YOUR_USERNAME` and the repository name:

```bash
git clone https://github.com/YOUR_USERNAME/butter-chicken.git
cd butter-chicken
npm ci
npm run pack:release
npm install --global ./butter-chicken-1.0.0.tgz
butter-chicken
```

Your friend stops the app, adds the **exact same** Cloudflare relay setting/URL to their own printed `config.env`, relaunches, and opens **their own localhost UI**. They create their own identity/passphrase. Never copy the other person's database or keys.

If PowerShell rejects the npm `.ps1` shim, use `npm.cmd` and `butter-chicken.cmd`. If the command is not found, see the README's user-prefix/PATH instructions.

## Pair once, then chat

1. Both launch/unlock and connect to the relay.
2. A chooses Create invitation and privately sends the complete BC1 text/QR to B. It expires in ten minutes.
3. B pastes/scans it, then chooses Connect to friend. Signed invitation relay URL must match configured URL.
4. Compare **every group** of the safety code on an independent trusted call. Matching display names are insufficient.
5. Both confirm. Select Start chatting and test both directions.

After pairing, friends may use completely different networks. Unlock/running is required to receive. If B is offline, A's message saves encrypted locally and may show SENT when the relay accepts temporary ciphertext. B reconnects/unlocks and receives it. DELIVERED means local save; READ means visible active chat display, not proof of human attention. Relay ciphertext expires after 24 hours; A's local pending copy remains.

The next launch uses the same pinned identity. Keep the foreground terminal open, stop with Ctrl+C, check with `butter-chicken status`. Local history stays outside the installation. Update by pulling GitHub, `npm ci`, `npm run check`, `npm run pack:release`, then reinstall the local tarball and relaunch. Back up the private data directory while stopped.

Optional same-LAN chat uses direct discovery/TCP4455 and falls back to the configured relay. A legacy pairing without a pair epoch must be removed on both clients and paired once after relay configuration for offline internet delivery. Removing trust while disconnected is applied to that identity's relay registration when it next unlocks without a friend. Resetting/destroying its keys cannot authenticate removal of an old relay pin.

See [two-network manual test](TWO_COMPUTERS.md), [troubleshooting](../TROUBLESHOOTING.md), [privacy](../PRIVACY.md) and [security](../SECURITY.md). There is no built-in public relay service, guaranteed uptime or forward secrecy.

Optional source security verification: `npm run check` requires OpenSSL for the disposable TLS certificate test. Normal installation and chat do not require OpenSSL. The release was verified with OpenSSL 3.0.13; install that test prerequisite before running the complete suite on another computer.
