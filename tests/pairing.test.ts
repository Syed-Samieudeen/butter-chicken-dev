import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRelay } from "../relay/service.js";
import { createApp } from "../server/app.js";
import { ChatEngine, IDLE_LOCK_MS } from "../client/engine.js";
import { ClientApi, type LocalSocket } from "../client/api.js";
import {
  cryptoReady,
  createIdentity,
  makeInvitation,
  type SecretIdentity,
} from "../client/crypto.js";
import { authInput, signed } from "../shared/relay.js";

const wait = async (p: () => boolean, label = "Timed out", ms = 15000) => {
  const start = Date.now();
  while (!p()) {
    if (Date.now() - start > ms) throw Error(label);
    await new Promise((r) => setTimeout(r, 15));
  }
};

async function connect(port: number, identity: SecretIdentity) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
  const packets: any[] = [];
  ws.on("error", () => {});
  ws.on("message", (raw) => packets.push(JSON.parse(raw.toString())));
  await wait(() => packets.some((p) => p.type === "challenge"));
  ws.send(
    JSON.stringify({
      type: "auth",
      identity: identity.public,
      signature: signed(
        authInput(
          packets[0].challenge,
          identity.public,
          `ws://127.0.0.1:${port}/relay`,
        ),
        identity.signSecret,
      ),
    }),
  );
  await wait(() => packets.some((p) => p.type === "ready"));
  return {
    ws,
    packets,
    send: (v: unknown) => ws.send(JSON.stringify(v)),
  };
}

test("6-digit codes are single use, owner-bound, throttled and expire", { timeout: 30000 }, async () => {
  await cryptoReady;
  const relay = await createRelay({
    port: 0,
    dataFile: ":memory:",
    development: true,
  });
  const url = `ws://127.0.0.1:${relay.port}/relay`;
  const a = createIdentity("Alex"),
    b = createIdentity("Sam"),
    c = createIdentity("Mallory");
  const aa = await connect(relay.port, a),
    bb = await connect(relay.port, b),
    cc = await connect(relay.port, c);
  const sockets = [aa.ws, bb.ws, cc.ws];
  try {
    const { text } = makeInvitation(a, url);
    aa.send({ type: "pair-create", invitation: text });
    await wait(() => aa.packets.some((p) => p.type === "pair-code"));
    const code = aa.packets.find((p) => p.type === "pair-code").code as string;
    assert.match(code, /^\d{6}$/);

    // Someone else cannot register an invitation that names another identity.
    cc.send({ type: "pair-create", invitation: text });
    await wait(() => cc.ws.readyState === 3, "Foreign invitation rejected");

    // The owner cannot join their own code.
    aa.send({ type: "pair-join", code });
    await wait(() => aa.packets.some((p) => p.code === "PAIR_NOT_FOUND"));

    const wrong = code === "000000" ? "000001" : "000000";
    bb.send({ type: "pair-join", code: wrong });
    await wait(() => bb.packets.some((p) => p.code === "PAIR_NOT_FOUND"));

    bb.send({ type: "pair-join", code });
    await wait(() => bb.packets.some((p) => p.type === "pair-offer"));
    assert.equal(
      bb.packets.find((p) => p.type === "pair-offer").invitation,
      text,
    );
    bb.send({ type: "pair-join", code });
    await wait(
      () => bb.packets.filter((p) => p.code === "PAIR_NOT_FOUND").length === 2,
      "Code is single use",
    );

    // Expired codes are refused even if the relay still has the row.
    aa.send({ type: "pair-create", invitation: text });
    await wait(() => aa.packets.filter((p) => p.type === "pair-code").length === 2);
    const second = aa.packets.filter((p) => p.type === "pair-code")[1].code as string;
    relay.db.prepare("UPDATE offers SET expires=?").run(Date.now() - 1);
    const other = createIdentity("Late");
    const ll = await connect(relay.port, other);
    sockets.push(ll.ws);
    ll.send({ type: "pair-join", code: second });
    await wait(() => ll.packets.some((p) => p.code === "PAIR_NOT_FOUND"), "Expired code");

    // Repeated wrong guesses across the relay are throttled.
    for (let n = 0; n < 50; n++) {
      const guess = String(100000 + n);
      if (guess === code || guess === second) continue;
      ll.send({ type: "pair-join", code: guess });
    }
    await wait(
      () => ll.packets.some((p) => p.code === "PAIR_RATE_LIMITED"),
      "Rate limit",
      10000,
    );
    ll.send({ type: "pair-join", code: "654321" });
    await wait(
      () => ll.packets.filter((p) => p.code === "PAIR_RATE_LIMITED").length >= 2,
      "Still throttled",
      10000,
    );
  } finally {
    for (const ws of sockets) ws.terminate();
    await relay.close();
  }
});

test("screen lock keeps the relay connection, hides content until the passphrase is re-entered", { timeout: 30000 }, async () => {
  await cryptoReady;
  assert.equal(IDLE_LOCK_MS, 10 * 60_000);
  const relay = await createRelay({
    port: 0,
    dataFile: ":memory:",
    development: true,
  });
  const relayUrl = `ws://127.0.0.1:${relay.port}/relay`;
  const app = await createApp({
    dataFile: ":memory:",
    uiPort: 0,
    relayUrl,
    relayDevelopment: true,
  });
  const base = `http://127.0.0.1:${app.uiPort}`;
  const api = new ClientApi(base, (url, cookie) =>
    new WebSocket(url, {
      headers: { Cookie: cookie, Origin: base },
    }) as unknown as LocalSocket,
  );
  const engine = new ChatEngine(api);
  const passphrase = "long private passphrase for lock test";
  try {
    await engine.init();
    await engine.create("Alex", passphrase);
    await wait(() => !!engine.getSnapshot().relayConnected, "Relay connected");
    assert.equal(engine.getSnapshot().recoverySetupNeeded, true);
    engine.dismissRecoverySetup();
    engine.lockScreen();
    const locked = engine.getSnapshot();
    assert.equal(locked.locked, true);
    assert.equal(locked.self, undefined);
    assert.deepEqual(locked.messages, []);
    assert.equal(locked.relayConnected, true, "Locking must not drop the relay");
    await assert.rejects(() => engine.unlock("wrong passphrase entirely"), /not correct/);
    assert.equal(engine.getSnapshot().locked, true);
    await engine.unlock(passphrase);
    const open = engine.getSnapshot();
    assert.equal(open.locked, false);
    assert.equal(open.self?.displayName, "Alex");
    assert.equal(open.relayConnected, true);

    const identityId = open.self!.public.id;
    const recoveryKey = engine.recoveryCode();
    const changedPassphrase = "new passphrase after exposed test";
    await engine.changePassphrase(passphrase, changedPassphrase);
    engine.lock();
    await engine.unlock(changedPassphrase);
    assert.equal(engine.getSnapshot().self?.public.id, identityId);

    const recoveredPassphrase = "recovered passphrase for test";
    engine.lock();
    await engine.recoverWithKey(recoveryKey, recoveredPassphrase);
    assert.equal(engine.getSnapshot().self?.public.id, identityId);
    engine.lock();
    await assert.rejects(() => engine.unlock(changedPassphrase));
    await engine.unlock(recoveredPassphrase);
    assert.equal(engine.getSnapshot().self?.public.id, identityId);
  } finally {
    engine.dispose();
    await app.close();
    await relay.close();
  }
});
