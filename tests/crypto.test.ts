import test from "node:test";
import assert from "node:assert/strict";
import {
  cryptoReady,
  createIdentity,
  createVault,
  unlockVault,
  sealVault,
  wipe,
  makeHello,
  verifyHello,
  sealEnvelope,
  openEnvelope,
  makeInvitation,
  parseInvitation,
  securityCode,
  archiveMessage,
  openArchive,
} from "../client/crypto.js";
import { parseFrame } from "../shared/protocol.js";
await cryptoReady;
test("identities are random; public identity is signed and key changes are detected", () => {
  const a = createIdentity("Alex");
  const b = createIdentity("Sam");
  assert.notEqual(a.public.id, b.public.id);
  assert.equal(a.boxSecret.length, 32);
  assert.equal(a.signSecret.length, 64);
  const h = makeHello(a, "A".repeat(43));
  assert.equal(verifyHello(h).identity.id, a.public.id);
  assert.throws(() => verifyHello({ ...h, identity: b.public }));
  assert.equal(
    securityCode(a.public, b.public),
    securityCode(b.public, a.public),
  );
});
test("public-key boxes encrypt, authenticate, bind recipient and sign every outer field", () => {
  const a = createIdentity("Alex");
  const b = createIdentity("Sam");
  const relay = createIdentity("Relay");
  const e = sealEnvelope(a, b.public, {
    text: "only our two browsers can read this",
  });
  assert.equal(
    (openEnvelope(b, a.public, e).payload as { text: string }).text,
    "only our two browsers can read this",
  );
  assert.ok(!JSON.stringify(e).includes("only our two browsers"));
  assert.throws(() => openEnvelope(relay, a.public, e));
  assert.throws(() => openEnvelope(b, relay.public, e));
  for (const key of [
    "ciphertext",
    "nonce",
    "messageId",
    "senderId",
    "recipientId",
    "timestamp",
    "signature",
  ] as const) {
    const bad = {
      ...e,
      [key]: e[key][0] === "A" ? "B" + e[key].slice(1) : "A" + e[key].slice(1),
    };
    assert.throws(() => openEnvelope(b, a.public, bad), key);
  }
  const nonces = new Set(
    Array.from(
      { length: 200 },
      () => sealEnvelope(a, b.public, { text: "hello" }).nonce,
    ),
  );
  assert.equal(nonces.size, 200);
});
test("expired, malformed and modified invitations fail; security code binds both key pairs", () => {
  const a = createIdentity("Alex");
  const b = createIdentity("Sam");
  const { text } = makeInvitation(a, "wss://relay.example.com/relay");
  assert.equal(parseInvitation(text).identity.id, a.public.id);
  assert.throws(() => parseInvitation(text, Date.now() + 26 * 60_000));
  assert.throws(() => parseInvitation("123-456"));
  assert.notEqual(
    securityCode(a.public, b.public),
    securityCode(a.public, createIdentity("Impostor").public),
  );
});
test("encrypted passphrase vault persists identities, rejects wrong password and wipes live keys", async () => {
  const { unlocked, vault } = await createVault(
    "Alex",
    "five long unrelated secret words",
  );
  assert.ok(!JSON.stringify(vault).includes("Alex"));
  assert.ok(
    !JSON.stringify(vault).includes(
      Buffer.from(unlocked.identity.boxSecret).toString("base64"),
    ),
  );
  const reopened = await unlockVault(vault, "five long unrelated secret words");
  assert.deepEqual(reopened.identity.public, unlocked.identity.public);
  assert.notEqual(sealVault(unlocked).data.nonce, vault.data.nonce);
  await assert.rejects(() => unlockVault(vault, "wrong password"));
  wipe(unlocked);
  assert.ok(unlocked.key.every((x) => x === 0));
  wipe(reopened);
});
test("encrypted archives bind their record identity and metadata", () => {
  const a = createIdentity("Alex");
  const peerId = "bc".repeat(32);
  const message = {
    id: "ab".repeat(16),
    peerId,
    from: "me" as const,
    text: "private message",
    sentAt: new Date().toISOString(),
  };
  const row = archiveMessage(a, peerId, message, false);
  assert.equal(openArchive(a, row).text, "private message");
  assert.throws(() => openArchive(a, { ...row, direction: "incoming" }));
  assert.throws(() => openArchive(createIdentity("Other"), row));
});
test("protocol rejects invalid fields, unsupported versions, extra plaintext and large input", () => {
  assert.throws(() => parseFrame("{"));
  assert.throws(() => parseFrame(" ".repeat(70000)));
  const a = createIdentity("Alex");
  const h = makeHello(a, "A".repeat(43));
  assert.throws(() => parseFrame(JSON.stringify({ ...h, text: "plaintext" })));
  assert.throws(() => parseFrame(JSON.stringify({ ...h, version: 2 })));
});

test("ciphertext-corrupted vault fails and an exact encrypted identity clone is the same cryptographic identity", async () => {
  const password = "clone test only long unrelated secret words";
  const original = await createVault("Synthetic clone", password);
  const cloned = await unlockVault(structuredClone(original.vault), password);
  try {
    assert.deepEqual(cloned.identity.public, original.unlocked.identity.public);
    const recipient = createIdentity("Synthetic recipient");
    const box = sealEnvelope(cloned.identity, recipient.public, {
      text: "clone boundary fixture",
    });
    assert.equal(
      (
        openEnvelope(recipient, original.unlocked.identity.public, box)
          .payload as { text: string }
      ).text,
      "clone boundary fixture",
    );
    const ciphertext = original.vault.data.ciphertext;
    await assert.rejects(() =>
      unlockVault(
        {
          ...original.vault,
          data: {
            ...original.vault.data,
            ciphertext:
              (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1),
          },
        },
        password,
      ),
    );
  } finally {
    wipe(original.unlocked);
    wipe(cloned);
  }
});
