# Butter Chicken relay on Cloudflare Workers

This deploys a Butter Chicken-compatible relay to your Cloudflare account as a Worker + Durable Object, so pairing and message delivery can run through `wss://butterchickenworker.bakri-downtime-sub.workers.dev/relay`.

## What this is

- Implements the same relay protocol as the Node relay in `../../relay/` (challenge/auth, pins, live links, offline mail queue, consume, poll).
- Uses a single Durable Object with SQLite storage for coordination and temporary encrypted mailboxes.
- Stores only relay state the protocol requires (public identities/pins, pairing IDs, signed ciphertext envelopes, expiry). It does not decrypt messages or hold private keys.

## Prerequisites

- Node.js and npm
- A Cloudflare account
- `wrangler` authenticated to your account (`npx wrangler login`)

## Configure

`wrangler.toml` is preconfigured for:

- Worker name: `bakris-downtime-relay`
- Public relay URL: `wss://butterchickenworker.bakri-downtime-sub.workers.dev/relay`

If you deploy to a different name or a custom domain, update both `name` and `RELAY_PUBLIC_URL` so the public URL exactly matches `wss://<your-host>/relay`. Clients sign the relay URL during authentication, so it must match.

## Deploy

From this directory:

```bash
npm install
npx wrangler deploy
```

## Verify

```bash
curl https://butterchickenworker.bakri-downtime-sub.workers.dev/health
```

Expected JSON includes `"service":"Butter Chicken relay"` and `"status":"ok"`.

## Use with Butter Chicken clients

On both computers, set the same relay URL in each app's printed `config.env` and restart:

```dotenv
BC_RELAY_URL=wss://butterchickenworker.bakri-downtime-sub.workers.dev/relay
```

Or use the Cloudflare shortcut supported by this app:

```dotenv
BC_CLOUDFLARE_RELAY=butterchickenworker.bakri-downtime-sub.workers.dev
```

Then pair/unlock on both devices as usual. Internet pairing and message delivery will go through your Cloudflare relay.

## Notes

- Mail is temporary encrypted ciphertext (24h max retention, removed on consume/expiry). Public pins remain until an authenticated unpin.
- This is intended for small/private use. It does not provide horizontal scaling, forward secrecy, or protection against a malicious/compromised endpoint.
- Keep your Cloudflare account secure; account access can affect availability/configuration of the relay.
