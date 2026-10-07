import { z } from "zod";
import { parseStrictJson } from "./json.js";

export const VERSION = 1 as const;
export const MAX_FRAME_BYTES = 65_536;
export const Id = z.string().regex(/^[a-f0-9]{64}$/);
export const MessageId = z.string().regex(/^[a-f0-9]{32}$/);
const b64 = (length: number) =>
  z
    .string()
    .length(length)
    .regex(/^[A-Za-z0-9_-]+$/);
export const IdentitySchema = z
  .object({ id: Id, boxKey: b64(43), signKey: b64(43) })
  .strict();
export type PublicIdentity = z.infer<typeof IdentitySchema>;
export const EndpointSchema = z
  .object({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535),
    nodeId: MessageId,
  })
  .strict();
export type Endpoint = z.infer<typeof EndpointSchema>;
export const HelloSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("hello"),
    identity: IdentitySchema,
    challenge: b64(43),
    signature: b64(86),
  })
  .strict();
export type Hello = z.infer<typeof HelloSchema>;
export const EnvelopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("box"),
    senderId: Id,
    recipientId: Id,
    messageId: MessageId,
    timestamp: z.string().datetime({ offset: true }),
    nonce: b64(32),
    ciphertext: z
      .string()
      .min(22)
      .max(60_000)
      .regex(/^[A-Za-z0-9_-]+$/),
    signature: b64(86),
  })
  .strict();
export type Envelope = z.infer<typeof EnvelopeSchema>;
export const FrameSchema = z.discriminatedUnion("kind", [
  HelloSchema,
  EnvelopeSchema,
]);
export type Frame = z.infer<typeof FrameSchema>;
export function parseFrame(raw: string): Frame {
  if (new TextEncoder().encode(raw).length > MAX_FRAME_BYTES)
    throw new Error("Frame too large");
  return FrameSchema.parse(parseStrictJson(raw));
}

export const EncryptedBlobSchema = z
  .object({
    version: z.literal(1),
    nonce: b64(32),
    ciphertext: z
      .string()
      .min(22)
      .max(1_000_000)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type EncryptedBlob = z.infer<typeof EncryptedBlobSchema>;
export const VaultSchema = z
  .object({
    version: z.literal(1),
    kdf: z.literal("argon2id13"),
    salt: b64(22),
    ops: z.literal(2),
    memory: z.literal(67_108_864),
    data: EncryptedBlobSchema,
  })
  .strict();
export type Vault = z.infer<typeof VaultSchema>;
export const ArchiveSchema = z
  .object({
    messageId: MessageId,
    peerId: Id,
    direction: z.enum(["incoming", "outgoing"]),
    delivered: z.boolean(),
    state: z
      .enum(["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED"])
      .optional(),
    data: EncryptedBlobSchema,
  })
  .strict();
export type Archive = z.infer<typeof ArchiveSchema>;
export const LocalCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("connect"),
      host: z.string().min(1).max(253),
      port: z.number().int().min(1).max(65535),
      requestId: MessageId,
    })
    .strict(),
  z
    .object({
      type: z.literal("send"),
      connectionId: z.string().uuid(),
      frame: FrameSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("disconnect"), connectionId: z.string().uuid() })
    .strict(),
  z.object({ type: z.literal("disconnect-all") }).strict(),
  z.object({ type: z.literal("relay-open") }).strict(),
  z.object({ type: z.literal("relay-send"), packet: z.unknown() }).strict(),
]);
export type DiscoveryDevice = Endpoint & { label: string };
export type ServerEvent =
  | { type: "relay"; packet: unknown }
  | { type: "relay-close" }
  | { type: "network"; endpoint: Endpoint; devices: DiscoveryDevice[] }
  | {
      type: "peer-open";
      connectionId: string;
      outbound: boolean;
      requestId?: string;
      address: string;
      port: number;
    }
  | { type: "peer-close"; connectionId: string }
  | { type: "frame"; connectionId: string; frame: Frame }
  | { type: "error"; code: string; requestId?: string };
export type ConnectionState =
  | "DISCOVERING"
  | "CONNECTING"
  | "AUTHENTICATING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "PAIRING_REQUIRED"
  | "IDENTITY_CHANGED";
