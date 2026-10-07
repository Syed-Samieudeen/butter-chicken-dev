import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { ClientApi, type LocalSocket } from "../client/api.js";
import { ChatEngine } from "../client/engine.js";
import {
  cryptoReady,
  createIdentity,
  makeHello,
  randomChallenge,
  openEnvelope,
  sealEnvelope,
  parseInvitation,
} from "../client/crypto.js";
import type { Envelope, Frame } from "../shared/protocol.js";

const waitFor = async (
  predicate: () => boolean,
  message = "Timed out",
  timeout = 8000,
) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(message);
    await new Promise((r) => setTimeout(r, 15));
  }
};
const apiFor = (
  port: number,
  spy?: { socket?: WebSocket; commands: string[] },
) =>
  new ClientApi(`http://127.0.0.1:${port}`, (url, cookie) => {
    const ws = new WebSocket(url, {
      headers: { Cookie: cookie, Origin: `http://127.0.0.1:${port}` },
    });
    if (spy) {
      spy.socket = ws;
      const send = ws.send.bind(ws);
      ws.send = ((data: string) => {
        spy.commands.push(data);
        send(data);
      }) as typeof ws.send;
    }
    return ws as unknown as LocalSocket;
  });

test(
  "real two-service integration: two-sided pairing, encryption, ACK, replay, reconnect and identity mismatch",
  { timeout: 30000 },
  async () => {
    await cryptoReady;
    const wire: Frame[] = [];
    const a = await createApp({
      dataFile: ":memory:",
      uiPort: 0,
      lanPort: 0,
      lanHost: "127.0.0.1",
      discovery: false,
      onRelayFrame: (frame) => wire.push(frame),
    });
    const b = await createApp({
      dataFile: ":memory:",
      uiPort: 0,
      lanPort: 0,
      lanHost: "127.0.0.1",
      discovery: false,
      onRelayFrame: (frame) => wire.push(frame),
    });
    const spy: { socket?: WebSocket; commands: string[] } = { commands: [] };
    const ea = new ChatEngine(apiFor(a.uiPort, spy));
    const eb = new ChatEngine(apiFor(b.uiPort));
    try {
      await ea.init();
      await eb.init();
      await ea.create("Alex", "private five word test passphrase");
      await eb.create("Sam", "a different five word passphrase");
      await ea.invite();
      const invitation = ea.getSnapshot().invitation!.code;
      // A device on the same network can send a valid signature of its own, but cannot guess the invitation secret.
      const offer = parseInvitation(invitation);
      const attacker = createIdentity("Mallory");
      const challenge = randomChallenge();
      const attack = new WebSocket(`ws://127.0.0.1:${a.endpoint.port}/lan`);
      const attackClosed = new Promise<void>((resolve) =>
        attack.once("close", () => resolve()),
      );
      attack.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as Frame;
        if (frame.kind === "hello")
          attack.send(
            JSON.stringify(
              sealEnvelope(attacker, frame.identity, {
                type: "auth",
                senderChallenge: challenge,
                recipientChallenge: frame.challenge,
                name: "Mallory",
                endpoint: b.endpoint,
                inviteId: offer.inviteId,
                token: randomChallenge(),
              }),
            ),
          );
      });
      await new Promise<void>((resolve) =>
        attack.once("open", () => resolve()),
      );
      attack.send(JSON.stringify(makeHello(attacker, challenge)));
      await attackClosed;
      assert.equal(ea.getSnapshot().pending, undefined);
      assert.equal(ea.getSnapshot().friend, undefined);
      await eb.join(invitation);
      await waitFor(
        () => Boolean(ea.getSnapshot().pending && eb.getSnapshot().pending),
        "Pairing did not authenticate",
      );
      assert.equal(
        ea.getSnapshot().pending!.code,
        eb.getSnapshot().pending!.code,
      );
      assert.equal(ea.getSnapshot().friend, undefined);
      assert.equal(eb.getSnapshot().friend, undefined);
      await assert.rejects(() =>
        ea.sendMessage("Cannot send before verification"),
      );
      await ea.verifyPairing();
      assert.equal(ea.getSnapshot().friend, undefined);
      await eb.verifyPairing();
      await waitFor(
        () =>
          ea.getSnapshot().state === "CONNECTED" &&
          eb.getSnapshot().state === "CONNECTED",
        "Mutual verification did not complete",
      );
      const secret = "meet me where only the two of us know — 🍲";
      await ea.sendMessage(secret);
      await waitFor(
        () =>
          eb.getSnapshot().messages.length === 1 &&
          ea.getSnapshot().messages[0]?.delivered === true,
        "Message/ACK failed",
      );
      assert.equal(eb.getSnapshot().messages[0].text, secret);
      const original = spy.commands.find((raw) => {
        const command = JSON.parse(raw);
        return (
          command.type === "send" &&
          command.frame.kind === "box" &&
          command.frame.messageId === ea.getSnapshot().messages[0].id
        );
      })!;
      spy.socket!.send(original);
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(
        eb.getSnapshot().messages.length,
        1,
        "same-session replay duplicated a message",
      );
      await eb.sendMessage("Reply from Sam");
      await waitFor(
        () =>
          ea.getSnapshot().messages.length === 2 &&
          eb.getSnapshot().messages[1]?.delivered === true,
      );
      assert.ok(!JSON.stringify(wire).includes(secret));
      assert.ok(!JSON.stringify(a.store.history()).includes(secret));
      assert.ok(!JSON.stringify(a.store.vault()).includes("Alex"));
      const relay = createIdentity("Relay");
      const captured = wire.find(
        (x) =>
          x.kind === "box" && x.messageId === ea.getSnapshot().messages[0].id,
      ) as Envelope;
      assert.throws(() =>
        openEnvelope(relay, ea.getSnapshot().self!.public, captured),
      );
      // Reinject a captured packet on a NEW connection: per-connection challenges reject it.
      const replay = new WebSocket(`ws://127.0.0.1:${b.endpoint.port}/lan`);
      await new Promise<void>((resolve) =>
        replay.once("open", () => resolve()),
      );
      replay.send(
        JSON.stringify(
          wire.find(
            (x) =>
              x.kind === "hello" &&
              x.identity.id === ea.getSnapshot().self!.public.id,
          )!,
        ),
      );
      replay.send(JSON.stringify(captured));
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(eb.getSnapshot().messages.length, 2);
      replay.terminate();
      // Deletion removes ciphertext history but keeps persistent replay tombstones.
      const incoming = b.store
        .history()
        .find((x) => x.direction === "incoming")!;
      await eb.clearHistory();
      assert.equal(b.store.receive(incoming), false);
      spy.socket!.send(original);
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(
        eb.getSnapshot().messages.length,
        0,
        "history deletion allowed a replay",
      );
      ea.lock();
      await waitFor(() => eb.getSnapshot().state === "DISCONNECTED");
      await ea.unlock("private five word test passphrase");
      assert.equal(ea.getSnapshot().friend!.displayName, "Sam");
      ea.reconnect();
      await waitFor(
        () =>
          ea.getSnapshot().state === "CONNECTED" &&
          eb.getSnapshot().state === "CONNECTED",
      );
      await ea.sendMessage("After restart");
      await waitFor(() => eb.getSnapshot().messages.length === 1);
      // Resetting identity cannot silently retain trust on the other machine.
      await eb.resetIdentity();
      await eb.create("Sam", "new replacement identity password");
      ea.reconnect();
      await waitFor(
        () => ea.getSnapshot().state === "IDENTITY_CHANGED",
        "Changed identity was not warned",
      );
      assert.ok(ea.getSnapshot().warning);
      assert.equal(ea.getSnapshot().friend!.displayName, "Sam");
    } finally {
      ea.dispose();
      eb.dispose();
      await a.close();
      await b.close();
    }
  },
);

test(
  "loopback API blocks wrong Host, cross-origin writes, unauthenticated writes and browser access to LAN",
  { timeout: 10000 },
  async () => {
    const app = await createApp({
      dataFile: ":memory:",
      uiPort: 0,
      lanPort: 0,
      lanHost: "127.0.0.1",
      discovery: false,
    });
    const base = `http://127.0.0.1:${app.uiPort}`;
    try {
      assert.equal((await fetch(base + "/api/vault")).status, 401);
      assert.equal(
        (
          await fetch(base + "/api/bootstrap", {
            headers: { Origin: "https://evil.invalid" },
          })
        ).status,
        403,
      );
      const bootstrap = await fetch(base + "/api/bootstrap");
      const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0];
      const info = (await bootstrap.json()) as {
        csrf: string;
        dataEpoch: string;
      };
      assert.equal(
        (
          await fetch(base + "/api/reset", {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        403,
      );
      const badHost = await new Promise<number>((resolve, reject) => {
        import("node:http").then(({ get }) => {
          get(
            base + "/api/bootstrap",
            { headers: { Host: "evil.invalid" } },
            (res) => {
              res.resume();
              resolve(res.statusCode!);
            },
          ).on("error", reject);
        });
      });
      assert.equal(badHost, 403);
      const headers = {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-BC-CSRF": info.csrf,
        "X-BC-DATA-EPOCH": info.dataEpoch,
      };
      assert.equal(
        (
          await fetch(base + "/api/reset", {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(base + "/api/reset", {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
        409,
        "a stale session wrote after reset",
      );
      assert.equal(
        (await fetch(`http://127.0.0.1:${app.endpoint.port}/`)).status,
        404,
      );
      const socket = new WebSocket(`ws://127.0.0.1:${app.endpoint.port}/lan`, {
        origin: base,
      });
      await new Promise<void>((resolve) => {
        socket.once("error", () => resolve());
        socket.once("open", () => {
          socket.terminate();
          assert.fail("Browser Origin accepted");
        });
      });
    } finally {
      await app.close();
    }
  },
);

test(
  "single-use invitation resists concurrent candidates and requires local confirmation even with a stolen token",
  { timeout: 15000 },
  async () => {
    await cryptoReady;
    const app = await createApp({
      dataFile: ":memory:",
      uiPort: 0,
      lanPort: 0,
      lanHost: "127.0.0.1",
      discovery: false,
    });
    const engine = new ChatEngine(apiFor(app.uiPort));
    const attackers: WebSocket[] = [];
    try {
      await engine.init();
      await engine.create("Victim", "race test only five secret words");
      await engine.invite();
      const invitation = parseInvitation(engine.getSnapshot().invitation!.code);
      const attack = async (token: string) => {
        const identity = createIdentity("Unverified device"),
          challenge = randomChallenge();
        const ws = new WebSocket(`ws://127.0.0.1:${app.endpoint.port}/lan`);
        attackers.push(ws);
        ws.on("message", (raw) => {
          const frame = JSON.parse(raw.toString()) as Frame;
          if (frame.kind === "hello") {
            ws.send(JSON.stringify(makeHello(identity, challenge)));
            ws.send(
              JSON.stringify(
                sealEnvelope(identity, frame.identity, {
                  type: "auth",
                  senderChallenge: challenge,
                  recipientChallenge: frame.challenge,
                  name: "Unverified device",
                  endpoint: app.endpoint,
                  inviteId: invitation.inviteId,
                  token,
                }),
              ),
            );
            ws.send(
              JSON.stringify(
                sealEnvelope(identity, frame.identity, {
                  type: "ready",
                  senderChallenge: challenge,
                  recipientChallenge: frame.challenge,
                }),
              ),
            );
            ws.send(
              JSON.stringify(
                sealEnvelope(identity, frame.identity, {
                  type: "verify",
                  senderChallenge: challenge,
                  recipientChallenge: frame.challenge,
                  inviteId: invitation.inviteId,
                }),
              ),
            );
          }
        });
        await new Promise<void>((resolve) => ws.once("open", resolve));
        return ws;
      };
      // A small bounded guessing run. No public target or cryptographic brute-force claim.
      for (let n = 0; n < 4; n++) {
        const ws = await attack(randomChallenge());
        await new Promise<void>((resolve) => ws.once("close", () => resolve()));
      }
      assert.equal(engine.getSnapshot().pending, undefined);
      const racing = await Promise.all([
        attack(invitation.token),
        attack(invitation.token),
      ]);
      await waitFor(
        () =>
          Boolean(engine.getSnapshot().pending) &&
          racing.some((ws) => ws.readyState === WebSocket.CLOSED),
      );
      assert.equal(engine.getSnapshot().pending!.localVerified, false);
      assert.equal(engine.getSnapshot().pending!.remoteVerified, true);
      assert.equal(
        engine.getSnapshot().friend,
        undefined,
        "Remote verification bypassed local human confirmation",
      );
      const reuse = await attack(invitation.token);
      await new Promise<void>((resolve) =>
        reuse.once("close", () => resolve()),
      );
      assert.equal(engine.getSnapshot().friend, undefined);
      engine.cancelPairing();
      assert.equal(engine.getSnapshot().pending, undefined);
    } finally {
      for (const ws of attackers) ws.terminate();
      engine.dispose();
      await app.close();
    }
  },
);

test(
  "service restart retains pins and replay tombstones; captured previous-session traffic fails",
  { timeout: 20000 },
  async () => {
    await cryptoReady;
    const folder = await mkdtemp(join(tmpdir(), "bc-service-restart-"));
    let apps: Awaited<ReturnType<typeof createApp>>[] = [];
    let engines: ChatEngine[] = [];
    const wire: Frame[] = [];
    const passwords = [
      "restart Alice synthetic private words",
      "restart Bob synthetic private words",
    ];
    const boot = async () => {
      apps = await Promise.all(
        ["a", "b"].map((name) =>
          createApp({
            dataFile: join(folder, name + ".sqlite"),
            uiPort: 0,
            lanPort: 0,
            lanHost: "127.0.0.1",
            discovery: false,
            onRelayFrame: (frame) => wire.push(frame),
          }),
        ),
      );
      engines = apps.map((app) => new ChatEngine(apiFor(app.uiPort)));
      await Promise.all(engines.map((engine) => engine.init()));
    };
    try {
      await boot();
      await engines[0].create("Alice", passwords[0]);
      await engines[1].create("Bob", passwords[1]);
      await engines[0].invite();
      await engines[1].join(engines[0].getSnapshot().invitation!.code);
      await waitFor(() =>
        engines.every((engine) => Boolean(engine.getSnapshot().pending)),
      );
      await engines[0].verifyPairing();
      await engines[1].verifyPairing();
      await waitFor(() =>
        engines.every((engine) => engine.getSnapshot().state === "CONNECTED"),
      );
      await engines[0].sendMessage("Restart replay fixture");
      await waitFor(
        () =>
          engines[0].getSnapshot().messages[0]?.delivered === true &&
          engines[1].getSnapshot().messages.length === 1,
      );
      const sender = engines[0].getSnapshot().self!.public.id;
      const capturedHello = wire.find(
        (frame) => frame.kind === "hello" && frame.identity.id === sender,
      )!;
      const captured = wire.find(
        (frame) =>
          frame.kind === "box" &&
          frame.messageId === engines[0].getSnapshot().messages[0].id,
      )!;
      const archive = apps[1].store.history()[0];
      const pins = engines.map(
        (engine) => engine.getSnapshot().friend!.public.id,
      );
      for (const engine of engines) engine.dispose();
      for (const app of apps) await app.close();
      apps = [];
      engines = [];
      await boot();
      await Promise.all(
        engines.map((engine, n) => engine.unlock(passwords[n])),
      );
      assert.deepEqual(
        engines.map((engine) => engine.getSnapshot().friend!.public.id),
        pins,
      );
      assert.equal(apps[1].store.receive(archive), false);
      const replay = new WebSocket(
        `ws://127.0.0.1:${apps[1].endpoint.port}/lan`,
      );
      await new Promise<void>((resolve) => replay.once("open", resolve));
      const closed = new Promise<void>((resolve) =>
        replay.once("close", () => resolve()),
      );
      replay.send(JSON.stringify(capturedHello));
      replay.send(JSON.stringify(captured));
      await closed;
      assert.equal(engines[1].getSnapshot().messages.length, 1);
      engines[0].reconnect("127.0.0.1", apps[1].endpoint.port);
      await waitFor(() =>
        engines.every((engine) => engine.getSnapshot().state === "CONNECTED"),
      );
      await engines[0].sendMessage(
        "Fresh message after actual service restart",
      );
      await waitFor(() => engines[1].getSnapshot().messages.length === 2);
    } finally {
      for (const engine of engines) engine.dispose();
      for (const app of apps) await app.close();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
