# Two-computer, two-network manual verification

**Two-network internet testing could not be physically verified in this environment.** Local integration tests simulate independent clients and outages. This procedure verifies the actual devices and networks without targeting unrelated systems.

## Before starting

Deploy your relay using [relay/README.md](../relay/README.md). From both computers verify `https://YOUR-REAL-DOMAIN/health` shows the relay status. Do not disable TLS validation. Configure exactly `BC_RELAY_URL=wss://YOUR-REAL-DOMAIN/relay` in each app's printed config file. Install Node 24 and the app as in [FRIEND_SETUP.md](FRIEND_SETUP.md).

Use synthetic identities/messages for this test. A uses home Wi-Fi. B uses a different Wi-Fi network, or a phone hotspot with Wi-Fi disconnected on the phone so its uplink is mobile data. Verify that B is actually using a different network. No port forwarding, friend IP exchange or client inbound internet firewall opening is needed. The relay host administrator alone configured its inbound TLS ports.

## Primary test

1. Launch `butter-chicken` independently on A/B. Open each computer's own localhost URL. Create separate vaults and strong passphrases.
2. Check relay connected on both. Choose Create invitation on A, privately transfer the text/QR to B, and Connect to friend on B.
3. Compare every safety-code group on a trusted call, then both confirm. Confirm both save the same pinned keys and show the real success page.
4. Start chatting. Verify INTERNET path and live secure friend connection.
5. A sends a unique synthetic message. B sees exactly one correct message; A obtains DELIVERED. With B's visible active chat focused, verify READ.
6. B replies; A receives correct text and B obtains delivery acknowledgement.
7. Lock B or stop its service. A sends another unique message. Verify saved local encrypted pending data and, while relay remains available, SENT. It must not show DELIVERED before B processes it.
8. Restart/unlock B. Confirm the offline message arrives and A receives DELIVERED, then READ on focused chat. Count one entry only.
9. Repeat with A stopped/restarted after sending. Confirm its identity, pinned friend, history and pending delivery survive.
10. Temporarily stop the relay in your isolated deployment. A queues a synthetic message, shows OFFLINE and keeps it locally. Restart relay; verify automatic backoff/reconnect, eventual delivery and one entry.
11. Change B from mobile hotspot to another Wi-Fi; test a new message, then laptop sleep/wake. Confirm fresh reconnect, identity pin retention and no IP entry.
12. Inspect the authorized test relay SQLite/structured logs using server administration tools. Confirm no known synthetic plaintext, passphrase, private key or pairing token appears; stored mail is signed ciphertext with routing/expiry metadata. Do not infer this simply from a UI label.
13. Inspect local history after both service restarts. Delete visible history on B, retry an already delivered test envelope through the isolated regression harness, and confirm its replay tombstone prevents reappearance.

## Retention, TLS and pairing negatives

Use only the included automated local fixtures for shortened-expiry, malformed-frame, queue-cap, certificate-failure and replay tests:

```bash
npm run test:relay
npm run test:security
```

Never modify production ciphertext or stress a public relay for these checks. The real TTL is 24 hours plus maintenance scheduling; wait beyond it if validating actual elapsed retention. Exact retransmissions do not refresh an existing row's expiry. Local sender pending copies remain after relay expiry and may be resubmitted.

Do not trust mismatching safety codes. Confirm a different configured relay URL rejects the signed invitation rather than silently switching. Legacy LAN-only pairs require re-pairing once for internet offline delivery. An expired/stolen token must not authorize trust without both independent confirmations.

## Optional LAN optimization

Put A/B on the same permitted private IPv4 LAN. Allow TCP4455 and optional mDNS UDP5353 only on that private subnet; keep the configured internet relay. Restart services if their LAN interfaces changed. Discovery should establish LOCAL. Send a unique message both ways. Block only that app's direct test LAN path or move B back to the hotspot; confirm relay fallback and INTERNET with saved key pins. Guest/AP isolation may prevent direct discovery without affecting the relay path.

Record actual OS/browser versions, network types, relay commit/image IDs, observed states/timings and failures. Do not report this physical checklist as passed until performed on the actual two computers.
