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
import { cryptoReady } from "../client/crypto.js";

const waitFor = async (
  predicate: () => boolean,
  label: string,
  ms = 20_000,
) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const makeApi = (port: number) =>
  new ClientApi(`http://127.0.0.1:${port}`, (url, cookie) => {
    return new WebSocket(url, {
      headers: { Cookie: cookie, Origin: `http://127.0.0.1:${port}` },
    }) as unknown as LocalSocket;
  });

async function pair(
  owner: ChatEngine,
  guest: ChatEngine,
  guestId: string,
): Promise<void> {
  await owner.invite();
  await waitFor(() => Boolean(owner.getSnapshot().invitation?.code), "pair code");
  const code = owner.getSnapshot().invitation!.code!;
  assert.match(code, /^\d{6}$/);
  await guest.join(code);
  await waitFor(
    () => Boolean(owner.getSnapshot().pending && guest.getSnapshot().pending),
    "safety-code verification prompt",
  );
  assert.equal(owner.getSnapshot().pending!.code, guest.getSnapshot().pending!.code);
  await owner.verifyPairing();
  await guest.verifyPairing();
  await waitFor(
    () =>
      owner.getSnapshot().friends.some((friend) => friend.public.id === guestId) &&
      guest
        .getSnapshot()
        .friends.some((friend) => friend.public.id === owner.getSnapshot().self!.public.id),
    "trusted contact saved after safety-code confirmation",
  );
}

test(
  "six-digit pairings share group invites and group messages fan out to every paired member",
  { timeout: 90_000 },
  async () => {
    await cryptoReady;
    const dir = await mkdtemp(join(tmpdir(), "bc-groups-"));
    const relay = await createRelay({
      port: 0,
      dataFile: join(dir, "relay.sqlite"),
      development: true,
    });
    const relayUrl = `ws://127.0.0.1:${relay.port}/relay`;
    const appOptions = (name: string) => ({
      uiPort: 0,
      dataFile: join(dir, name, "chat.sqlite"),
      relayUrl,
      relayDevelopment: true,
    });
    let appA: Awaited<ReturnType<typeof createApp>> | undefined;
    let appB: Awaited<ReturnType<typeof createApp>> | undefined;
    let appC: Awaited<ReturnType<typeof createApp>> | undefined;
    let a: ChatEngine | undefined;
    let b: ChatEngine | undefined;
    let c: ChatEngine | undefined;
    try {
      appA = await createApp(appOptions("a"));
      appB = await createApp(appOptions("b"));
      appC = await createApp(appOptions("c"));
      a = new ChatEngine(makeApi(appA.uiPort));
      b = new ChatEngine(makeApi(appB.uiPort));
      c = new ChatEngine(makeApi(appC.uiPort));
      await Promise.all([a.init(), b.init(), c.init()]);
      await Promise.all([
        a.create("Alice", "alice test passphrase for groups"),
        b.create("Basil", "basil test passphrase for groups"),
        c.create("Chandra", "chandra test passphrase for groups"),
      ]);
      await waitFor(
        () =>
          Boolean(a!.getSnapshot().relayConnected) &&
          Boolean(b!.getSnapshot().relayConnected) &&
          Boolean(c!.getSnapshot().relayConnected),
        "all clients connected to relay",
      );

      const aliceId = a.getSnapshot().self!.public.id;
      const basilId = b.getSnapshot().self!.public.id;
      const chandraId = c.getSnapshot().self!.public.id;

      // Alice pairs with both contacts using single-use 6-digit codes.
      await pair(a, b, basilId);
      await pair(a, c, chandraId);

      // A group invite should be queued encrypted while a member is offline.
      b.lock();
      await a.createGroup("Weekend plans", [basilId, chandraId]);
      const aliceGroup = a.getSnapshot().groups.find(
        (group) => group.name === "Weekend plans",
      )!;
      await waitFor(
        () => c!.getSnapshot().groups.some((group) => group.id === aliceGroup.id),
        "online group invitation delivered",
      );
      const queuedMail = relay.db.prepare("SELECT json FROM mail").all();
      assert.ok(queuedMail.length > 0, "offline member invite is queued");
      assert.equal(
        JSON.stringify(queuedMail).includes("Weekend plans"),
        false,
        "group metadata remains encrypted at the relay",
      );
      await b.unlock("basil test passphrase for groups");
      await waitFor(
        () => b!.getSnapshot().groups.some((group) => group.id === aliceGroup.id),
        "queued group invitation delivered after Basil reconnects",
      );
      for (const engine of [a, b, c]) {
        const group = engine.getSnapshot().groups.find(
          (entry) => entry.id === aliceGroup.id,
        )!;
        assert.deepEqual(group.memberIds, [aliceId, basilId, chandraId]);
        assert.equal(group.creatorId, aliceId);
      }

      // Pairwise relay authorization is still required between every group member.
      b.selectConversation({ type: "group", id: aliceGroup.id });
      assert.equal(
        b.getSnapshot().messages.some((message) => message.mailKind === "group-invite"),
        false,
        "group control messages are not shown as chat messages",
      );
      await assert.rejects(
        () => b!.sendMessage("should wait for the last pairing"),
        /Pair with every group member/,
      );
      await pair(b, c, chandraId);

      b.selectConversation({ type: "group", id: aliceGroup.id });
      c.lock();
      await b.sendMessage("Hello from Basil");
      a.selectConversation({ type: "group", id: aliceGroup.id });
      await waitFor(
        () => a!.getSnapshot().messages.some((message) => message.text === "Hello from Basil"),
        "Basil's group message delivered to an online member",
      );
      await c.unlock("chandra test passphrase for groups");
      c.selectConversation({ type: "group", id: aliceGroup.id });
      await waitFor(
        () => c!.getSnapshot().messages.some((message) => message.text === "Hello from Basil"),
        "queued group message delivered after Chandra reconnects",
      );

      const basilMessage = b.getSnapshot().messages.find(
        (message) => message.text === "Hello from Basil",
      )!;
      a.selectConversation({ type: "group", id: aliceGroup.id });
      await a.sendMessage("Reply from Alice", {
        id: basilMessage.groupMessageId!,
        text: basilMessage.text,
      });
      await waitFor(
        () =>
          b!.getSnapshot().messages.some((message) => message.text === "Reply from Alice") &&
          c!.getSnapshot().messages.some((message) => message.text === "Reply from Alice"),
        "Alice's fan-out delivered",
      );
      assert.equal(
        b.getSnapshot().messages.find((message) => message.text === "Reply from Alice")
          ?.replyTo,
        basilMessage.groupMessageId,
        "group replies refer to the shared logical message ID",
      );
      assert.equal(
        a.getSnapshot().messages.filter((message) => message.text === "Reply from Alice").length,
        1,
        "the sender sees one logical message, not a copy per recipient",
      );
      assert.ok(
        b
          .getSnapshot()
          .groups.find((group) => group.id === aliceGroup.id)!
          .memberNames?.[chandraId],
        "the shared roster includes member names",
      );
    } finally {
      a?.dispose();
      b?.dispose();
      c?.dispose();
      await appA?.close();
      await appB?.close();
      await appC?.close();
      await relay.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
