import { z } from "zod";
import sodium from "libsodium-wrappers-sumo";
import {
  IdentitySchema,
  EnvelopeSchema,
  Id,
  MessageId,
  FrameSchema,
  type PublicIdentity,
  type Envelope,
} from "./protocol.js";

/** Public relay address used when no BC_RELAY_URL or BC_CLOUDFLARE_RELAY is configured. It is not a secret. */
export const DEFAULT_RELAY_URL =
  "wss://butterchickenworker.bakri-downtime-sub.workers.dev/relay";
export const PAIR_CODE_TTL_MS = 10 * 60_000;

export const RelayUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname === "/relay" &&
        (u.protocol === "wss:" ||
          (u.protocol === "ws:" &&
            ["127.0.0.1", "localhost"].includes(u.hostname)))
      );
    } catch {
      return false;
    }
  }, "Use wss://your-relay-domain/relay (ws loopback only for development)");
const Sig = z
  .string()
  .length(86)
  .regex(/^[A-Za-z0-9_-]+$/);
export const RelayCommand = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("auth"),
      identity: IdentitySchema,
      signature: Sig,
    })
    .strict(),
  z
    .object({
      type: z.literal("pin"),
      peer: IdentitySchema,
      pairId: MessageId,
      signature: Sig,
    })
    .strict(),
  z.object({ type: z.literal("unpin") }).strict(),
  z
    .object({ type: z.literal("link"), peerId: Id, requestId: MessageId })
    .strict(),
  z
    .object({
      type: z.literal("frame"),
      connectionId: z.string().uuid(),
      frame: FrameSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("drop"), connectionId: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("mail"),
      envelope: EnvelopeSchema,
      pairId: MessageId,
    })
    .strict(),
  z
    .object({ type: z.literal("consume"), senderId: Id, messageId: MessageId })
    .strict(),
  z.object({ type: z.literal("poll") }).strict(),
  z
    .object({
      type: z.literal("pair-create"),
      invitation: z.string().min(40).max(3000),
    })
    .strict(),
  z
    .object({
      type: z.literal("pair-join"),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict(),
  z.object({ type: z.literal("pair-cancel") }).strict(),
]);

/** Identity id named inside a BC1 invitation, without verifying its signature. Relays use this only to bind codes to their owner. */
export function invitationOwner(text: string): string | undefined {
  try {
    if (!text.startsWith("BC1.")) return undefined;
    const value = JSON.parse(
      sodium.to_string(
        sodium.from_base64(
          text.slice(4),
          sodium.base64_variants.URLSAFE_NO_PADDING,
        ),
      ),
    );
    const id = value?.identity?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

export function authInput(
  challenge: string,
  identity: PublicIdentity,
  audience: string,
) {
  return [
    "ButterChicken/relay-auth/v1",
    audience,
    challenge,
    identity.id,
    identity.boxKey,
    identity.signKey,
  ];
}
export function pinInput(
  identity: PublicIdentity,
  peer: PublicIdentity,
  pairId: string,
) {
  return [
    "ButterChicken/relay-pin/v1",
    identity.id,
    peer.id,
    peer.boxKey,
    peer.signKey,
    pairId,
  ];
}
export function b64(bytes: Uint8Array) {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}
export function un64(value: string) {
  const b = sodium.from_base64(
    value,
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );
  if (b64(b) !== value) throw Error("Noncanonical encoding");
  return b;
}
export function signed(value: unknown, key: Uint8Array) {
  return b64(
    sodium.crypto_sign_detached(sodium.from_string(JSON.stringify(value)), key),
  );
}
export function verifySigned(
  value: unknown,
  signature: string,
  identity: PublicIdentity,
) {
  return sodium.crypto_sign_verify_detached(
    un64(signature),
    sodium.from_string(JSON.stringify(value)),
    un64(identity.signKey),
  );
}
export function checkIdentity(identity: PublicIdentity) {
  IdentitySchema.parse(identity);
  const id = sodium.to_hex(
    sodium.crypto_generichash(
      32,
      sodium.from_string(
        JSON.stringify([
          "ButterChicken/identity/v1",
          identity.boxKey,
          identity.signKey,
        ]),
      ),
      null,
    ),
  );
  if (
    id !== identity.id ||
    un64(identity.boxKey).length !== 32 ||
    un64(identity.signKey).length !== 32
  )
    throw Error("Invalid identity");
}
export function checkEnvelope(e: Envelope, identity: PublicIdentity) {
  if (
    e.senderId !== identity.id ||
    !verifySigned(
      [
        "ButterChicken/message/v1",
        e.version,
        e.senderId,
        e.recipientId,
        e.messageId,
        e.timestamp,
        e.nonce,
        e.ciphertext,
      ],
      e.signature,
      identity,
    )
  )
    throw Error("Invalid envelope signature");
}
