import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";
import { parseStrictJson } from "../shared/json.js";
import {
  ArchiveSchema,
  EncryptedBlobSchema,
  EnvelopeSchema,
  HelloSchema,
  IdentitySchema,
  VaultSchema,
  type Archive,
  type EncryptedBlob,
  type Envelope,
  type Hello,
  type PublicIdentity,
  type Vault,
} from "../shared/protocol.js";

export const cryptoReady = sodium.ready;
export function bytes(value: string, length?: number): Uint8Array {
  const result = sodium.from_base64(
    value,
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );
  if (
    (length !== undefined && result.length !== length) ||
    base64(result) !== value
  )
    throw new Error("Invalid byte encoding");
  return result;
};
export function base64(value: Uint8Array): string {
  return sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}
const encode = (value: unknown): Uint8Array =>
  sodium.from_string(JSON.stringify(value));
const decode = (value: Uint8Array): unknown =>
  parseStrictJson(sodium.to_string(value));
export const randomId = (): string => sodium.to_hex(sodium.randombytes_buf(16));
export const randomChallenge = (): string => base64(sodium.randombytes_buf(32));
export interface SecretIdentity {
  public: PublicIdentity;
  displayName: string;
  boxSecret: Uint8Array;
  signSecret: Uint8Array;
  archiveKey: Uint8Array;
  sequence?: number;
}
export const FriendSchema = z
  .object({
    public: IdentitySchema,
    displayName: z.string().min(1).max(40),
    trustedSince: z.string().datetime(),
    verifiedAt: z.string().datetime(),
    receivedSequence: z.number().int().nonnegative().safe().optional(),
    lastSeen: z.string().datetime().optional(),
    pairId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
  })
  .strict();
export type Friend = z.infer<typeof FriendSchema>;
export interface UnlockedVault {
  identity: SecretIdentity;
  friend?: Friend;
  key: Uint8Array;
  salt: string;
}
export const PrivatePayloadSchema = z
  .object({
    identity: z
      .object({
        public: IdentitySchema,
        displayName: z.string().min(1).max(40),
        boxSecret: z.string(),
        signSecret: z.string(),
        archiveKey: z.string(),
        sequence: z.number().int().nonnegative().safe().optional(),
      })
      .strict(),
    friend: FriendSchema.optional(),
  })
  .strict();
export const ChatMessageSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{32}$/),
    peerId: z.string().regex(/^[a-f0-9]{64}$/),
    from: z.enum(["me", "friend"]),
    text: z.string().min(1).max(8000),
    sentAt: z.string().datetime({ offset: true }),
    receivedAt: z.string().datetime().optional(),
    sequence: z.number().int().positive().safe().optional(),
    wire: EnvelopeSchema.optional(),
    replyTo: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    replyPreview: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema> & {
  delivered: boolean;
  state?: "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
};

function identityId(boxKey: string, signKey: string): string {
  return sodium.to_hex(
    sodium.crypto_generichash(
      32,
      encode(["ButterChicken/identity/v1", boxKey, signKey]),
      null,
    ),
  );
}
export function validateIdentity(input: unknown): PublicIdentity {
  const identity = IdentitySchema.parse(input);
  bytes(identity.boxKey, 32);
  bytes(identity.signKey, 32);
  if (identity.id !== identityId(identity.boxKey, identity.signKey))
    throw new Error("Invalid identity fingerprint");
  return identity;
}
export function sameIdentity(a: PublicIdentity, b: PublicIdentity): boolean {
  return a.id === b.id && a.boxKey === b.boxKey && a.signKey === b.signKey;
}
export function createIdentity(displayName: string): SecretIdentity {
  const name = displayName.trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/u.test(name))
    throw new Error("Use a name between 1 and 40 characters");
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  const boxKey = base64(box.publicKey);
  const signKey = base64(sign.publicKey);
  return {
    public: { id: identityId(boxKey, signKey), boxKey, signKey },
    displayName: name,
    boxSecret: box.privateKey,
    signSecret: sign.privateKey,
    archiveKey: sodium.randombytes_buf(32),
  };
}
export function fingerprint(identity: PublicIdentity): string {
  return identity.id
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join(" ");
}
export function securityCode(a: PublicIdentity, b: PublicIdentity): string {
  const pair = [validateIdentity(a), validateIdentity(b)].sort((x, y) =>
    x.id.localeCompare(y.id),
  );
  return sodium
    .to_hex(
      sodium.crypto_generichash(
        16,
        encode([
          "ButterChicken/security-code/v1",
          pair.map((x) => [x.id, x.boxKey, x.signKey]),
        ]),
        null,
      ),
    )
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join(" ");
}
export function sealLocal(
  key: Uint8Array,
  value: unknown,
  associatedData: unknown,
): EncryptedBlob {
  const nonce = sodium.randombytes_buf(24);
  const plaintext = encode(value);
  try {
    return {
      version: 1,
      nonce: base64(nonce),
      ciphertext: base64(
        sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
          plaintext,
          encode(associatedData),
          null,
          nonce,
          key,
        ),
      ),
    };
  } finally {
    sodium.memzero(plaintext);
  }
}
export function openLocal(
  key: Uint8Array,
  blob: EncryptedBlob,
  associatedData: unknown,
): unknown {
  EncryptedBlobSchema.parse(blob);
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    bytes(blob.ciphertext),
    encode(associatedData),
    bytes(blob.nonce, 24),
    key,
  );
  try {
    return decode(plaintext);
  } finally {
    sodium.memzero(plaintext);
  }
}
export function derivePasswordKey(
  passphrase: string,
  salt: string,
): Uint8Array {
  const password = sodium.from_string(passphrase);
  try {
    return sodium.crypto_pwhash(
      32,
      password,
      bytes(salt, 16),
      2,
      67_108_864,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  } finally {
    sodium.memzero(password);
  }
}
async function derive(passphrase: string, salt: string): Promise<Uint8Array> {
  // Heavy Argon2 work stays off the UI thread. Node tests use exactly the same library function.
  if (typeof window === "undefined" || typeof Worker === "undefined")
    return derivePasswordKey(passphrase, salt);
  const worker = new Worker(new URL("./kdf.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.key) resolve(new Uint8Array(event.data.key));
      else reject(new Error("Key derivation failed"));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Key derivation failed"));
    };
    worker.postMessage({ passphrase, salt });
  });
}
export function vaultAAD(salt: string) {
  return [
    "ButterChicken/vault/v1",
    salt,
    "argon2id13",
    2,
    67_108_864,
  ];
}
export function sealVault(unlocked: UnlockedVault): Vault {
  const i = unlocked.identity;
  return {
    version: 1,
    kdf: "argon2id13",
    salt: unlocked.salt,
    ops: 2,
    memory: 67_108_864,
    data: sealLocal(
      unlocked.key,
      {
        identity: {
          public: i.public,
          displayName: i.displayName,
          boxSecret: base64(i.boxSecret),
          signSecret: base64(i.signSecret),
          archiveKey: base64(i.archiveKey),
          sequence: i.sequence ?? 0,
        },
        ...(unlocked.friend ? { friend: unlocked.friend } : {}),
      },
      vaultAAD(unlocked.salt),
    ),
  };
}
export async function createVault(
  name: string,
  passphrase: string,
): Promise<{ unlocked: UnlockedVault; vault: Vault }> {
  await cryptoReady;
  if (passphrase.length < 12 || passphrase.length > 512)
    throw new Error("Choose a passphrase of 12 to 512 characters");
  const salt = base64(sodium.randombytes_buf(16));
  const key = await derive(passphrase, salt);
  const unlocked: UnlockedVault = { identity: createIdentity(name), key, salt };
  return { unlocked, vault: sealVault(unlocked) };
}
export async function unlockVault(
  value: unknown,
  passphrase: string,
): Promise<UnlockedVault> {
  await cryptoReady;
  const vault = VaultSchema.parse(value);
  const key = await derive(passphrase, vault.salt);
  try {
    const payload = PrivatePayloadSchema.parse(
      openLocal(key, vault.data, vaultAAD(vault.salt)),
    );
    const publicIdentity = validateIdentity(payload.identity.public);
    const boxSecret = bytes(payload.identity.boxSecret, 32);
    const signSecret = bytes(payload.identity.signSecret, 64);
    const archiveKey = bytes(payload.identity.archiveKey, 32);
    if (
      base64(sodium.crypto_scalarmult_base(boxSecret)) !==
        publicIdentity.boxKey ||
      base64(sodium.crypto_sign_ed25519_sk_to_pk(signSecret)) !==
        publicIdentity.signKey
    )
      throw new Error("Invalid identity keys");
    if (payload.friend) validateIdentity(payload.friend.public);
    return {
      identity: {
        public: publicIdentity,
        displayName: payload.identity.displayName,
        boxSecret,
        signSecret,
        archiveKey,
        sequence: payload.identity.sequence ?? 0,
      },
      key,
      salt: vault.salt,
      friend: payload.friend,
    };
  } catch {
    sodium.memzero(key);
    throw new Error(
      "Could not unlock. Check your passphrase or restore your original data.",
    );
  }
}
/** Checks the passphrase against the derived vault key kept in memory. */
export async function verifyPassphrase(
  unlocked: UnlockedVault,
  passphrase: string,
): Promise<boolean> {
  const key = await derive(passphrase, unlocked.salt);
  try {
    return sodium.memcmp(key, unlocked.key);
  } finally {
    sodium.memzero(key);
  }
}
export function wipe(unlocked: UnlockedVault): void {
  for (const key of [
    unlocked.key,
    unlocked.identity.boxSecret,
    unlocked.identity.signSecret,
    unlocked.identity.archiveKey,
  ])
    sodium.memzero(key);
}
export function archiveMessage(
  identity: SecretIdentity,
  peerId: string,
  message: Omit<ChatMessage, "delivered">,
  delivered: boolean,
): Archive {
  const direction = message.from === "me" ? "outgoing" : "incoming";
  return ArchiveSchema.parse({
    messageId: message.id,
    peerId,
    direction,
    delivered,
    state: delivered ? "DELIVERED" : "QUEUED",
    data: sealLocal(identity.archiveKey, message, [
      "ButterChicken/history/v1",
      message.id,
      peerId,
      direction,
    ]),
  });
}
export function openArchive(
  identity: SecretIdentity,
  value: unknown,
): ChatMessage {
  const row = ArchiveSchema.parse(value);
  const message = ChatMessageSchema.parse(
    openLocal(identity.archiveKey, row.data, [
      "ButterChicken/history/v1",
      row.messageId,
      row.peerId,
      row.direction,
    ]),
  );
  if (
    message.id !== row.messageId ||
    message.peerId !== row.peerId ||
    message.from !== (row.direction === "outgoing" ? "me" : "friend")
  )
    throw new Error("Archive metadata changed");
  return {
    ...message,
    delivered: row.delivered,
    state: row.state ?? (row.delivered ? "DELIVERED" : "QUEUED"),
  };
}

const helloInput = (h: Omit<Hello, "signature">) => [
  "ButterChicken/hello/v1",
  h.version,
  h.identity.id,
  h.identity.boxKey,
  h.identity.signKey,
  h.challenge,
];
export function makeHello(identity: SecretIdentity, challenge: string): Hello {
  const hello = {
    version: 1 as const,
    kind: "hello" as const,
    identity: identity.public,
    challenge,
  };
  return {
    ...hello,
    signature: base64(
      sodium.crypto_sign_detached(
        encode(helloInput(hello)),
        identity.signSecret,
      ),
    ),
  };
}
export function verifyHello(input: unknown): Hello {
  const hello = HelloSchema.parse(input);
  validateIdentity(hello.identity);
  bytes(hello.challenge, 32);
  if (
    !sodium.crypto_sign_verify_detached(
      bytes(hello.signature, 64),
      encode(helloInput(hello)),
      bytes(hello.identity.signKey, 32),
    )
  )
    throw new Error("Invalid identity signature");
  return hello;
}
const envelopeInput = (e: Omit<Envelope, "signature">) => [
  "ButterChicken/message/v1",
  e.version,
  e.senderId,
  e.recipientId,
  e.messageId,
  e.timestamp,
  e.nonce,
  e.ciphertext,
];
export function sealEnvelope(
  identity: SecretIdentity,
  peer: PublicIdentity,
  payload: unknown,
  messageId = randomId(),
  timestamp = new Date().toISOString(),
): Envelope {
  const nonce = sodium.randombytes_buf(24);
  const plaintext = encode(payload);
  try {
    const envelope = {
      version: 1 as const,
      kind: "box" as const,
      senderId: identity.public.id,
      recipientId: peer.id,
      messageId,
      timestamp,
      nonce: base64(nonce),
      ciphertext: base64(
        sodium.crypto_box_easy(
          plaintext,
          nonce,
          bytes(peer.boxKey, 32),
          identity.boxSecret,
        ),
      ),
    };
    return EnvelopeSchema.parse({
      ...envelope,
      signature: base64(
        sodium.crypto_sign_detached(
          encode(envelopeInput(envelope)),
          identity.signSecret,
        ),
      ),
    });
  } finally {
    sodium.memzero(plaintext);
  }
}
export function openEnvelope(
  identity: SecretIdentity,
  expected: PublicIdentity,
  value: unknown,
): { envelope: Envelope; payload: unknown } {
  const e = EnvelopeSchema.parse(value);
  validateIdentity(expected);
  if (e.senderId !== expected.id || e.recipientId !== identity.public.id)
    throw new Error("Wrong sender or recipient");
  if (
    !sodium.crypto_sign_verify_detached(
      bytes(e.signature, 64),
      encode(envelopeInput(e)),
      bytes(expected.signKey, 32),
    )
  )
    throw new Error("Invalid message signature");
  const plaintext = sodium.crypto_box_open_easy(
    bytes(e.ciphertext),
    bytes(e.nonce, 24),
    bytes(expected.boxKey, 32),
    identity.boxSecret,
  );
  try {
    return { envelope: e, payload: decode(plaintext) };
  } finally {
    sodium.memzero(plaintext);
  }
}

import { RelayUrl } from "../shared/relay.js";
const InviteSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("invite"),
    relayUrl: RelayUrl.optional(),
    identity: IdentitySchema,
    token: z.string().length(43),
    inviteId: z.string().regex(/^[a-f0-9]{32}$/),
    expires: z.number().int().positive(),
    signature: z.string().length(86),
  })
  .strict();
export type Invitation = z.infer<typeof InviteSchema>;
const inviteInput = (i: Omit<Invitation, "signature">) => [
  "ButterChicken/invitation/v1",
  i.version,
  i.identity.id,
  i.identity.boxKey,
  i.identity.signKey,
  i.token,
  i.inviteId,
  i.expires,
  ...(i.relayUrl ? ["relay", i.relayUrl] : []),
];
/** Signed invitation. People never see its text: it is stored on the relay behind a 6-digit code. */
export function makeInvitation(
  identity: SecretIdentity,
  relayUrl: string,
  now = Date.now(),
): { invitation: Invitation; text: string } {
  const input = {
    version: 1 as const,
    kind: "invite" as const,
    identity: identity.public,
    relayUrl: RelayUrl.parse(relayUrl),
    token: randomChallenge(),
    inviteId: randomId(),
    expires: now + 10 * 60_000,
  };
  const invitation = {
    ...input,
    signature: base64(
      sodium.crypto_sign_detached(
        encode(inviteInput(input)),
        identity.signSecret,
      ),
    ),
  };
  return { invitation, text: `BC1.${base64(encode(invitation))}` };
}
export function parseInvitation(text: string, now = Date.now()): Invitation {
  if (!text.startsWith("BC1.") || text.length > 3000)
    throw new Error("The pairing data is not valid.");
  const invitation = InviteSchema.parse(decode(bytes(text.slice(4))));
  validateIdentity(invitation.identity);
  bytes(invitation.token, 32);
  const maxClockSkew = 15 * 60_000;
  if (invitation.expires < now - maxClockSkew)
    throw new Error("This code has expired. Ask your friend for a new code.");
  if (invitation.expires > now + 11 * 60_000 + maxClockSkew)
    throw new Error(
      "Device clocks differ significantly. Adjust system clocks and try again.",
    );
  if (
    !sodium.crypto_sign_verify_detached(
      bytes(invitation.signature, 64),
      encode(inviteInput(invitation)),
      bytes(invitation.identity.signKey, 32),
    )
  )
    throw new Error(
      "The pairing data was changed. Ask your friend for a new code.",
    );
  return invitation;
}
export function tokenMatches(a: string, b: string): boolean {
  try {
    return sodium.memcmp(bytes(a, 32), bytes(b, 32));
  } catch {
    return false;
  }
}
