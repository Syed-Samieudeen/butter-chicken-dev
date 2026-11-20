import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { isLocalIPv4 } from "../server/discovery.js";
import { mkdtemp, readFile, rm, mkdir, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveMessage,
  createVault,
  cryptoReady,
  openArchive,
  unlockVault,
  wipe,
} from "../client/crypto.js";
const row = {
  messageId: "ab".repeat(16),
  peerId: "cd".repeat(32),
  direction: "incoming" as const,
  delivered: true,
  data: {
    version: 1 as const,
    nonce: "A".repeat(32),
    ciphertext: "B".repeat(40),
  },
};
test("SQLite stores only opaque encrypted records and deduplicates atomically", () => {
  const s = new Store(":memory:");
  assert.equal(s.receive(row), true);
  assert.equal(s.receive(row), false);
  assert.equal(s.history().length, 1);
  s.clearHistory();
  assert.equal(s.history().length, 0);
  assert.equal(s.receive(row), false);
  const id = s.nodeId();
  s.reset();
  assert.equal(s.nodeId(), id);
  assert.equal(s.receive(row), true);
  s.close();
});
test("outgoing delivery survives queries; plaintext cannot enter database API", () => {
  const s = new Store(":memory:");
  s.putOutgoing({ ...row, direction: "outgoing", delivered: false });
  s.delivered(row.messageId);
  assert.equal(s.history()[0].delivered, true);
  assert.throws(() =>
    s.putOutgoing({ ...row, direction: "outgoing", text: "plaintext" }),
  );
  s.close();
});
test("LAN destination policy blocks public endpoints and ambiguous host names", () => {
  for (const ip of [
    "192.168.1.2",
    "10.0.0.2",
    "172.31.1.3",
    "127.0.0.1",
    "100.64.0.1",
    "100.80.149.116",
    "100.127.255.254",
  ])
    assert.equal(isLocalIPv4(ip), true);
  for (const ip of [
    "8.8.8.8",
    "172.32.1.1",
    "example.com",
    "192.168.1.2.evil.test",
    "::1",
    "0.0.0.0",
    "100.0.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "100.200.0.1",
  ])
    assert.equal(isLocalIPv4(ip), false);
});
test("real encrypted vault, history and replay ledger survive closing and reopening SQLite", async () => {
  await cryptoReady;
  const folder = await mkdtemp(join(tmpdir(), "bc-persistence-"));
  const file = join(folder, "store.sqlite");
  let store: Store | undefined;
  let live: Awaited<ReturnType<typeof unlockVault>> | undefined;
  try {
    const created = await createVault(
      "Persistence test",
      "unrelated words for disposable persistence test",
    );
    live = created.unlocked;
    const text = "Synthetic persistence test message";
    const peerId = "ca".repeat(32);
    const message = {
      id: "cb".repeat(16),
      peerId,
      from: "friend" as const,
      text,
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };
    const archive = archiveMessage(live.identity, peerId, message, true);
    store = new Store(file);
    store.saveVault(created.vault, true);
    store.receive(archive);
    const nodeId = store.nodeId();
    const identityId = live.identity.public.id;
    store.close();
    store = undefined;
    wipe(live);
    live = undefined;
    const bytes = await readFile(file);
    assert.ok(!bytes.includes(Buffer.from(text)));
    assert.ok(!bytes.includes(Buffer.from("Persistence test")));
    store = new Store(file);
    live = await unlockVault(
      store.vault(),
      "unrelated words for disposable persistence test",
    );
    assert.equal(live.identity.public.id, identityId);
    assert.equal(store.nodeId(), nodeId);
    assert.equal(openArchive(live.identity, store.history()[0]).text, text);
    store.clearHistory();
    store.close();
    store = new Store(file);
    assert.equal(store.receive(archive), false);
  } finally {
    if (live) wipe(live);
    store?.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test(
  "private directory and database permissions are enforced on POSIX",
  { skip: process.platform === "win32" },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "bc-permission-"));
    try {
      const unsafe = join(folder, "unsafe");
      await mkdir(unsafe);
      await chmod(unsafe, 0o777);
      assert.throws(() => new Store(join(unsafe, "test.sqlite")), /private/);
      const file = join(folder, "private", "test.sqlite");
      const store = new Store(file);
      try {
        assert.equal((await stat(join(folder, "private"))).mode & 0o777, 0o700);
        assert.equal((await stat(file)).mode & 0o777, 0o600);
      } finally {
        store.close();
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
