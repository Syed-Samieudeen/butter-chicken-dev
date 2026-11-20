import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRelay } from "../relay/service.js";
import { createApp } from "../server/app.js";
import { ChatEngine } from "../client/engine.js";
import { ClientApi, type LocalSocket } from "../client/api.js";
import {
  cryptoReady,
  createIdentity,
  sealEnvelope,
  randomId,
  parseInvitation,
  type SecretIdentity,
} from "../client/crypto.js";
import { authInput, pinInput, signed, RelayUrl } from "../shared/relay.js";
const wait = async (p: () => boolean, label = "Timed out", ms = 15000) => {
  const start = Date.now();
  while (!p()) {
    if (Date.now() - start > ms) throw Error(label);
    await new Promise((r) => setTimeout(r, 15));
  }
};
const api = (port: number, wire: string[] = []) =>
  new ClientApi(`http://127.0.0.1:${port}`, (url, cookie) => {
    const ws = new WebSocket(url, {
      headers: { Cookie: cookie, Origin: `http://127.0.0.1:${port}` },
    });
    const send = ws.send.bind(ws);
    ws.send = ((v: string) => {
      wire.push(v);
      send(v);
    }) as typeof ws.send;
    return ws as unknown as LocalSocket;
  });
async function connect(port: number, identity?: SecretIdentity) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
  const packets: any[] = [];
  ws.on("error", () => {});
  ws.on("message", (raw) => packets.push(JSON.parse(raw.toString())));
  await wait(() => packets.some((p) => p.type === "challenge"));
  const challenge = packets[0].challenge;
  if (identity) {
    ws.send(
      JSON.stringify({
        type: "auth",
        identity: identity.public,
        signature: signed(
          authInput(challenge, identity.public, `ws://127.0.0.1:${port}/relay`),
          identity.signSecret,
        ),
      }),
    );
    await wait(() => packets.some((p) => p.type === "ready"));
  }
  return {
    ws,
    packets,
    challenge,
    send: (v: unknown) => ws.send(JSON.stringify(v)),
  };
}
function pin(
  c: Awaited<ReturnType<typeof connect>>,
  a: SecretIdentity,
  b: SecretIdentity,
  pairId: string,
) {
  c.send({
    type: "pin",
    peer: b.public,
    pairId,
    signature: signed(pinInput(a.public, b.public, pairId), a.signSecret),
  });
}

test(
  "relay internet path: real pairing, offline ciphertext, restart recovery, read receipt, deduplication and local fallback",
  { timeout: 60000 },
  async () => {
    await cryptoReady;
    const dir = await mkdtemp(join(tmpdir(), "bc-internet-"));
    const logs: object[] = [];
    let relay = await createRelay({
      port: 0,
      dataFile: join(dir, "relay", "relay.sqlite"),
      development: true,
      log: (r) => logs.push(r),
    });
    const port = relay.port;
    const relayUrl = `ws://127.0.0.1:${port}/relay`;
    const opts = (name: string) => ({
      uiPort: 0,
      lanPort: 0,
      lanHost: "127.0.0.1",
      discovery: false,
      dataFile: join(dir, name, "chat.sqlite"),
      relayUrl,
      relayDevelopment: true,
    });
    let a = await createApp(opts("a")),
      b = await createApp(opts("b"));
    const wires: string[] = [];
    let ea = new ChatEngine(api(a.uiPort, wires)),
      eb = new ChatEngine(api(b.uiPort));
    try {
      await ea.init();
      await eb.init();
      await ea.create("Alex", "long private passphrase a");
      await eb.create("Sam", "long private passphrase b");
      await wait(
        () =>
          !!ea.getSnapshot().relayConnected &&
          !!eb.getSnapshot().relayConnected,
      );
      await ea.invite();
      await wait(() => !!ea.getSnapshot().invitation?.code, "Pair code");
      const code = ea.getSnapshot().invitation!.code!;
      assert.match(code, /^\d{6}$/);
      await eb.join(code);
      await wait(
        () => !!ea.getSnapshot().pending && !!eb.getSnapshot().pending,
        "Relay pairing handshake",
      );
      assert.equal(
        ea.getSnapshot().pending!.code,
        eb.getSnapshot().pending!.code,
      );
      await assert.rejects(() => ea.sendMessage("not trusted"));
      await ea.verifyPairing();
      await eb.verifyPairing();
      await wait(
        () =>
          ea.getSnapshot().state === "CONNECTED" &&
          eb.getSnapshot().state === "CONNECTED",
      );
      assert.equal(ea.getSnapshot().path, "INTERNET");
      assert.equal(
        ea.getSnapshot().friend!.pairId,
        eb.getSnapshot().friend!.pairId,
      );
      const secret = "ONLY_LOCAL_PLAINTEXT_739f2";
      await ea.sendMessage(secret);
      await wait(
        () =>
          eb.getSnapshot().messages.some((m) => m.text === secret) &&
          ea.getSnapshot().messages[0].delivered,
        "Online relay chat",
      );
      eb.markRead();
      await wait(
        () => ea.getSnapshot().messages[0].state === "READ",
        "Read receipt",
      );
      await eb.sendMessage("reply from another service");
      await wait(
        () =>
          ea.getSnapshot().messages.length === 2 &&
          eb.getSnapshot().messages.at(-1)!.delivered,
      );
      eb.lock();
      await wait(() => ea.getSnapshot().state !== "CONNECTED");
      await ea.sendMessage("offline-encrypted-message");
      await wait(
        () => ea.getSnapshot().messages.at(-1)!.state === "SENT",
        "Relay offline acceptance",
      );
      const rows = relay.db.prepare("SELECT * FROM mail").all();
      assert.ok(rows.length > 0);
      assert.ok(!JSON.stringify(rows).includes("offline-encrypted-message"));
      assert.ok(!JSON.stringify(logs).includes(secret));
      assert.ok(!JSON.stringify(wires).includes(secret));
      const wire = ea.getSnapshot().messages.at(-1)!.wire!;
      assert.ok(wire);
      for (let i = 0; i < 12; i++) await ea.sendMessage(`offline-batch-${i}`);
      await wait(
        () =>
          ea
            .getSnapshot()
            .messages.filter((m) => m.text.startsWith("offline-batch-"))
            .every((m) => m.state === "SENT"),
        "Bounded offline batch upload",
        20000,
      );
      assert.ok(!JSON.stringify(rows).includes("long private passphrase"));
      ea.dispose();
      await a.close();
      await relay.close();
      relay = await createRelay({
        port,
        dataFile: join(dir, "relay", "relay.sqlite"),
        development: true,
      });
      a = await createApp(opts("a"));
      ea = new ChatEngine(api(a.uiPort));
      await ea.init();
      await ea.unlock("long private passphrase a");
      await eb.unlock("long private passphrase b");
      await wait(
        () =>
          eb
            .getSnapshot()
            .messages.some((m) => m.text === "offline-encrypted-message") &&
          ea
            .getSnapshot()
            .messages.filter((m) => m.from === "me")
            .every((m) => m.delivered),
        "Persisted offline delivery after app and relay restart",
        25000,
      );
      const count = eb.getSnapshot().messages.length;
      await assert.rejects(() =>
        (eb as any).receiveMail({
          ...wire,
          nonce:
            wire.nonce.slice(0, -1) + (wire.nonce.endsWith("A") ? "B" : "A"),
        }),
      );
      await assert.rejects(() =>
        (eb as any).receiveMail({
          ...wire,
          recipientId: ea.getSnapshot().self!.public.id,
        }),
      );
      assert.equal(
        eb.getSnapshot().messages.length,
        count,
        "Untrusted relay tampering cannot alter local history",
      );
      (ea as any).transmitMail(wire);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(
        eb.getSnapshot().messages.length,
        count,
        "No duplicate display",
      );
      await eb.clearHistory();
      (ea as any).transmitMail(wire);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(
        eb.getSnapshot().messages.length,
        0,
        "History deletion retains replay tombstone",
      );
      // A dropped friend link reconnects automatically through the relay, without re-entering anything.
      ea.disconnect();
      await wait(
        () => ea.getSnapshot().state === "CONNECTED",
        "Automatic reconnect to friend",
        25000,
      );
      await ea.sendMessage("reconnected through relay");
      await wait(() =>
        eb
          .getSnapshot()
          .messages.some((m) => m.text === "reconnected through relay"),
      );
      // Relay outage: keep encrypted outgoing data locally, retry automatically, never plaintext fallback.
      await relay.close();
      await wait(() => !ea.getSnapshot().relayConnected);
      ea.disconnect();
      await ea.sendMessage("saved while relay down");
      assert.ok(ea.getSnapshot().messages.at(-1)!.wire);
      assert.equal(ea.getSnapshot().path, "OFFLINE");
      relay = await createRelay({
        port,
        dataFile: join(dir, "relay", "relay.sqlite"),
        development: true,
      });
      await wait(
        () =>
          eb
            .getSnapshot()
            .messages.some((m) => m.text === "saved while relay down") &&
          ea.getSnapshot().messages.at(-1)!.delivered,
        "Automatic exponential reconnect",
        25000,
      );
      const oldPair = ea.getSnapshot().friend!.pairId;
      await ea.removeFriend();
      await eb.removeFriend();
      await wait(
        () =>
          !!ea.getSnapshot().relayConnected &&
          !!eb.getSnapshot().relayConnected,
        "Relay reconnect after removing trust",
        20000,
      );
      await ea.invite();
      await wait(() => !!ea.getSnapshot().invitation?.code, "Second pair code");
      await eb.join(ea.getSnapshot().invitation!.code!);
      await wait(
        () => !!ea.getSnapshot().pending && !!eb.getSnapshot().pending,
        "Fresh pairing after relay unpin",
      );
      await ea.verifyPairing();
      await eb.verifyPairing();
      await wait(() => !!ea.getSnapshot().friend && !!eb.getSnapshot().friend);
      assert.notEqual(ea.getSnapshot().friend!.pairId, oldPair);
      await assert.rejects(
        () => (eb as any).receiveMail(wire),
        /pairing epoch/,
      );
    } finally {
      ea.dispose();
      eb.dispose();
      await a.close();
      await b.close();
      await relay.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("relay authentication freshness, wrong keys, unauthorized routing and production transport policy", async () => {
  await cryptoReady;
  assert.throws(() => RelayUrl.parse("ws://example.com/relay"));
  assert.throws(() => RelayUrl.parse("wss://user:secret@example.com/relay"));
  assert.throws(() => RelayUrl.parse("wss://example.com/relay?token=secret"));
  const r = await createRelay({
    port: 0,
    dataFile: ":memory:",
    development: true,
  });
  const a = createIdentity("a"),
    b = createIdentity("b"),
    attacker = createIdentity("attacker");
  const sockets: WebSocket[] = [];
  try {
    const x = await connect(r.port);
    sockets.push(x.ws);
    const proof = signed(
      authInput(x.challenge, a.public, `ws://127.0.0.1:${r.port}/relay`),
      a.signSecret,
    );
    x.send({
      type: "auth",
      identity: a.public,
      signature: signed(
        authInput(x.challenge, a.public, `ws://127.0.0.1:${r.port}/relay`),
        attacker.signSecret,
      ),
    });
    await wait(() => x.ws.readyState === 3);
    const y = await connect(r.port);
    sockets.push(y.ws);
    y.send({ type: "auth", identity: a.public, signature: proof });
    await wait(
      () => y.ws.readyState === 3,
      "Old challenge cannot authenticate",
    );
    const aa = await connect(r.port, a),
      bb = await connect(r.port, b),
      evil = await connect(r.port, attacker);
    sockets.push(aa.ws, bb.ws, evil.ws);
    const pairId = randomId();
    pin(aa, a, b, pairId);
    pin(bb, b, a, pairId);
    await wait(() => aa.packets.some((p) => p.type === "paired"));
    evil.send({ type: "link", peerId: a.public.id, requestId: randomId() });
    await wait(
      () => evil.ws.readyState === 3,
      "Stranger cannot link to pinned user",
    );
    const unauthed = await connect(r.port);
    sockets.push(unauthed.ws);
    unauthed.send({ type: "poll" });
    await wait(() => unauthed.ws.readyState === 3);
    const original = sealEnvelope(a, b.public, { text: "secret" });
    aa.send({
      type: "mail",
      envelope: {
        ...original,
        timestamp: new Date(Date.now() + 1).toISOString(),
      },
      pairId,
    });
    await wait(() => aa.ws.readyState === 3, "Metadata tamper");
    assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM mail").get()!.n, 0);
  } finally {
    for (const ws of sockets) ws.terminate();
    await r.close();
  }
  const production = await createRelay({
    port: 0,
    dataFile: ":memory:",
    publicUrl: "wss://relay.example.com/relay",
  });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${production.port}/relay`);
    ws.on("error", () => {});
    await wait(
      () => ws.readyState === 3,
      "Production rejects missing TLS proxy",
    );
  } finally {
    await production.close();
  }
});

test(
  "relay rejects malformed, binary, oversized and flooding frames; expires auth/session and stays healthy",
  { timeout: 20000 },
  async () => {
    await cryptoReady;
    const r = await createRelay({
      port: 0,
      dataFile: ":memory:",
      development: true,
      sessionMs: 100,
    });
    try {
      for (const payload of [
        '{"type":"poll","type":"auth"}',
        "{",
        Buffer.from([1, 2, 3]),
        "a".repeat(70000),
      ]) {
        const c = await connect(r.port);
        c.ws.send(payload);
        await wait(() => c.ws.readyState === 3);
      }
      const c = await connect(r.port, createIdentity("flood"));
      for (let i = 0; i < 70; i++) c.send({ type: "poll" });
      await wait(() => c.ws.readyState === 3);
      const expired = await connect(r.port, createIdentity("expiry"));
      await new Promise((x) => setTimeout(x, 120));
      expired.send({ type: "poll" });
      await wait(() => expired.ws.readyState === 3);
      const unauth = await connect(r.port);
      await wait(() => unauth.ws.readyState === 3, "Auth timeout", 7000);
      assert.equal(
        (await fetch(`http://127.0.0.1:${r.port}/health`)).status,
        200,
      );
    } finally {
      await r.close();
    }
  },
);

test("relay mutual pin authorization, conflicting duplicates, bounded offline queue, receiver-only consume and expiry", async () => {
  await cryptoReady;
  const r = await createRelay({
    port: 0,
    dataFile: ":memory:",
    development: true,
    retentionMs: 10000,
  });
  const a = createIdentity("a"),
    b = createIdentity("b");
  const aa = await connect(r.port, a),
    bb = await connect(r.port, b);
  const pairId = randomId();
  try {
    pin(aa, a, b, pairId);
    pin(bb, b, a, pairId);
    await wait(() => aa.packets.some((p) => p.type === "paired"));
    bb.ws.close();
    await wait(() => bb.ws.readyState === 3);
    const e = sealEnvelope(a, b.public, { secret: "never plaintext stored" });
    aa.send({ type: "mail", envelope: e, pairId });
    await wait(() => aa.packets.some((p) => p.type === "accepted"));
    aa.send({ type: "mail", envelope: e, pairId });
    await wait(
      () => aa.packets.filter((p) => p.type === "accepted").length === 2,
    );
    assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM mail").get()!.n, 1);
    aa.send({ type: "consume", senderId: a.public.id, messageId: e.messageId });
    aa.send({ type: "poll" });
    await new Promise((x) => setTimeout(x, 30));
    assert.equal(
      r.db.prepare("SELECT COUNT(*) AS n FROM mail").get()!.n,
      1,
      "Sender cannot consume another recipient mailbox",
    );
    // Fill isolated storage up to the fixed recipient bound, then verify next signed submission fails safely.
    const fill = r.db.prepare("INSERT INTO mail VALUES (?,?,?,?,?,?)");
    for (let i = 1; i < 256; i++)
      fill.run(
        a.public.id,
        b.public.id,
        i.toString(16).padStart(32, "0"),
        pairId,
        JSON.stringify(e),
        Date.now() + 10000,
      );
    aa.send({
      type: "mail",
      envelope: sealEnvelope(a, b.public, { text: "overflow" }),
      pairId,
    });
    await wait(() => aa.packets.some((p) => p.type === "rejected"));
    assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM mail").get()!.n, 256);
    r.db.prepare("UPDATE mail SET expires=?").run(Date.now() - 1);
    aa.send({ type: "poll" });
    await wait(
      () => r.db.prepare("SELECT COUNT(*) AS n FROM mail").get()!.n === 0,
      "Expired ciphertext removed",
    );
    aa.send({ type: "mail", envelope: e, pairId });
    await wait(
      () => r.db.prepare("SELECT COUNT(*) AS n FROM mail").get()!.n === 1,
    );
    aa.send({
      type: "mail",
      envelope: sealEnvelope(
        a,
        b.public,
        { text: "changed" },
        e.messageId,
        e.timestamp,
      ),
      pairId,
    });
    await wait(() => aa.ws.readyState === 3, "Conflicting duplicate rejected");
  } finally {
    aa.ws.terminate();
    bb.ws.terminate();
    await r.close();
  }
});

test("relay delivery does not amplify a short legitimate burst by rescanning the complete mailbox", async () => {
  await cryptoReady;
  const r = await createRelay({
    port: 0,
    dataFile: ":memory:",
    development: true,
  });
  const a = createIdentity("a"),
    b = createIdentity("b");
  const aa = await connect(r.port, a),
    bb = await connect(r.port, b);
  const pairId = randomId();
  try {
    pin(aa, a, b, pairId);
    pin(bb, b, a, pairId);
    await wait(() => aa.packets.some((p) => p.type === "paired"));
    for (let i = 0; i < 8; i++)
      aa.send({
        type: "mail",
        envelope: sealEnvelope(a, b.public, { text: `burst-${i}` }),
        pairId,
      });
    await wait(
      () => aa.packets.filter((p) => p.type === "accepted").length === 8,
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      bb.packets.filter((p) => p.type === "mail").length,
      8,
      "Exactly one live forward for each accepted message, not 36 rescanned sends",
    );
  } finally {
    aa.ws.terminate();
    bb.ws.terminate();
    await r.close();
  }
});

test("relay proof binds its public URL and matching pins cannot authorize a different pairing epoch", async () => {
  await cryptoReady;
  const r = await createRelay({
    port: 0,
    dataFile: ":memory:",
    development: true,
  });
  const a = createIdentity("a"),
    b = createIdentity("b");
  const spoof = await connect(r.port);
  let aa: Awaited<ReturnType<typeof connect>> | undefined,
    bb: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    spoof.send({
      type: "auth",
      identity: a.public,
      signature: signed(
        authInput(
          spoof.challenge,
          a.public,
          "wss://different-relay.example/relay",
        ),
        a.signSecret,
      ),
    });
    await wait(() => spoof.ws.readyState === 3, "Cross-relay proof refused");
    aa = await connect(r.port, a);
    bb = await connect(r.port, b);
    const pairId = randomId();
    pin(aa, a, b, pairId);
    pin(bb, b, a, randomId());
    await wait(
      () =>
        aa!.packets.some((p) => p.type === "pinned") &&
        bb!.packets.some((p) => p.type === "pinned"),
    );
    aa.send({
      type: "mail",
      envelope: sealEnvelope(a, b.public, { text: "not mutually authorized" }),
      pairId,
    });
    await wait(() => aa!.ws.readyState === 3);
    assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM mail").get()!.n, 0);
  } finally {
    spoof.ws.terminate();
    aa?.ws.terminate();
    bb?.ws.terminate();
    await r.close();
  }
});
