import { z } from "zod";
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";

// Workers cannot compile libsodium's embedded WebAssembly, so the relay uses pure-JavaScript Ed25519 and BLAKE2b.
// Outputs match libsodium byte for byte, so clients and the Node relay verify the same signatures and identities.
const cryptoReady = async () => {};
const enc = new TextEncoder();
const dec = new TextDecoder();

const MAX_FRAME_BYTES = 65_536;
const PAIR_CODE_TTL_MS = 10 * 60_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_CONNECTIONS = 64;
const MAX_TOTAL_PINS = 10_000;
const MAX_MAIL_PER_RECIPIENT = 256;
const MAX_TOTAL_MAIL = 4096;

const Id = z.string().regex(/^[a-f0-9]{64}$/);
const MessageId = z.string().regex(/^[a-f0-9]{32}$/);
const b64len = (length: number) =>
  z
    .string()
    .length(length)
    .regex(/^[A-Za-z0-9_-]+$/);
const IdentitySchema = z
  .object({ id: Id, boxKey: b64len(43), signKey: b64len(43) })
  .strict();
type PublicIdentity = z.infer<typeof IdentitySchema>;
const HelloSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("hello"),
    identity: IdentitySchema,
    challenge: b64len(43),
    signature: b64len(86),
  })
  .strict();
const EnvelopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("box"),
    senderId: Id,
    recipientId: Id,
    messageId: MessageId,
    timestamp: z.string().datetime({ offset: true }),
    nonce: b64len(32),
    ciphertext: z
      .string()
      .min(22)
      .max(60_000)
      .regex(/^[A-Za-z0-9_-]+$/),
    signature: b64len(86),
  })
  .strict();
type Envelope = z.infer<typeof EnvelopeSchema>;
const FrameSchema = z.discriminatedUnion("kind", [HelloSchema, EnvelopeSchema]);
const Sig = b64len(86);
const RelayCommand = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("auth"), identity: IdentitySchema, signature: Sig })
    .strict(),
  z
    .object({
      type: z.literal("pin"),
      peer: IdentitySchema,
      pairId: MessageId,
      signature: Sig,
    })
    .strict(),
  z
    .object({ type: z.literal("unpin"), peerId: Id.optional() })
    .strict(),
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
    .object({ type: z.literal("mail"), envelope: EnvelopeSchema, pairId: MessageId })
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

/** Identity id named inside a BC1 invitation, without verifying its signature. Codes are bound to their owner. */
function invitationOwner(text: string): string | undefined {
  try {
    if (!text.startsWith("BC1.")) return undefined;
    const value = JSON.parse(dec.decode(un64(text.slice(4))));
    const id = value?.identity?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Reject duplicate members and ambiguous value encodings; permit insignificant JSON whitespace. */
function parseStrictJson(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  const compact = raw.replace(/"(?:\\.|[^"\\])*"|[\t\n\r ]+/g, (token) =>
    token.startsWith('"') ? token : "",
  );
  if (JSON.stringify(value) !== compact)
    throw new Error("Noncanonical or duplicate JSON fields");
  return value;
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function un64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw Error("Noncanonical encoding");
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  if (b64(bytes) !== value) throw Error("Noncanonical encoding");
  return bytes;
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function authInput(challenge: string, identity: PublicIdentity, audience: string) {
  return [
    "ButterChicken/relay-auth/v1",
    audience,
    challenge,
    identity.id,
    identity.boxKey,
    identity.signKey,
  ];
}
function pinInput(identity: PublicIdentity, peer: PublicIdentity, pairId: string) {
  return [
    "ButterChicken/relay-pin/v1",
    identity.id,
    peer.id,
    peer.boxKey,
    peer.signKey,
    pairId,
  ];
}
function verifySigned(value: unknown, signature: string, identity: PublicIdentity) {
  return ed25519.verify(
    un64(signature),
    enc.encode(JSON.stringify(value)),
    un64(identity.signKey),
    { zip215: false },
  );
}
function checkIdentity(identity: PublicIdentity) {
  IdentitySchema.parse(identity);
  const id = hex(
    blake2b(
      enc.encode(
        JSON.stringify(["ButterChicken/identity/v1", identity.boxKey, identity.signKey]),
      ),
      { dkLen: 32 },
    ),
  );
  if (id !== identity.id || un64(identity.boxKey).length !== 32 || un64(identity.signKey).length !== 32)
    throw Error("Invalid identity");
}
function checkEnvelope(e: Envelope, identity: PublicIdentity) {
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

type Client = {
  ws: WebSocket;
  identity?: PublicIdentity;
  challenge: string;
  authed: boolean;
  window: number;
  count: number;
  bytes: number;
  expires: number;
  alive: boolean;
  authTimer?: ReturnType<typeof setTimeout>;
};

function log(event: string) {
  console.log(JSON.stringify({ event, time: new Date().toISOString() }));
}

function send(c: Client, v: unknown) {
  try {
    if (c.ws.readyState === WebSocket.OPEN) {
      // WebSocket in Workers doesn't expose bufferedAmount; rely on platform limits.
      c.ws.send(JSON.stringify(v));
    }
  } catch {}
}

export interface Env {
  RELAY: DurableObjectNamespace;
  RELAY_PUBLIC_URL: string;
}

export class RelayDurableObject {
  private sessions = new Map<string, Client>();
  private all = new Set<Client>();
  private links = new Map<string, { a: Client; b: Client }>();
  private initialized = false;
  // Failed 6-digit guesses across all connections. Identities are free to create, so the limit is global.
  private failedJoins: number[] = [];
  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const value = new Uint32Array(1);
      crypto.getRandomValues(value);
      if (value[0] >= 4_294_000_000) continue;
      const code = String(value[0] % 1_000_000).padStart(6, "0");
      const taken = [
        ...this.state.storage.sql.exec("SELECT 1 FROM offers WHERE code=?", code),
      ];
      if (!taken.length) return code;
    }
    throw Error("Pairing capacity");
  }
  private maintenance?: ReturnType<typeof setInterval>;

  constructor(private state: DurableObjectState, private env: Env) {}

  private init() {
    if (this.initialized) return;
    this.state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS pins(owner TEXT,peer TEXT NOT NULL,pair TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(owner,peer));
CREATE TABLE IF NOT EXISTS offers(code TEXT PRIMARY KEY,owner TEXT NOT NULL,invitation TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mail(sender TEXT,recipient TEXT,id TEXT,pair TEXT,json TEXT,expires INTEGER,PRIMARY KEY(sender,id));
CREATE TABLE IF NOT EXISTS allowances(a TEXT NOT NULL,b TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(a,b));`);
    // Migrate the legacy single-pin table (owner PRIMARY KEY) to multi-pin (owner,peer).
    // Durable Object SQL rejects BEGIN/COMMIT, so each step is a single statement.
    // A leftover pins_legacy table from an interrupted run is merged and removed.
    const columns = [
      ...this.state.storage.sql.exec("PRAGMA table_info(pins)"),
    ] as any[];
    const ownerPk = Number(columns.find((c: any) => c.name === "owner")?.pk ?? 0);
    const peerPk = Number(columns.find((c: any) => c.name === "peer")?.pk ?? 0);
    if (ownerPk === 1 && peerPk === 0) {
      this.state.storage.sql.exec("ALTER TABLE pins RENAME TO pins_legacy");
      this.state.storage.sql.exec(
        "CREATE TABLE pins(owner TEXT,peer TEXT NOT NULL,pair TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(owner,peer))",
      );
    }
    const legacy = [
      ...this.state.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pins_legacy'",
      ),
    ];
    if (legacy.length) {
      this.state.storage.sql.exec(
        "INSERT OR IGNORE INTO pins(owner,peer,pair,json) SELECT owner,peer,pair,json FROM pins_legacy",
      );
      this.state.storage.sql.exec("DROP TABLE pins_legacy");
    }
    this.initialized = true;
  }

  private cleanup() {
    const now = Date.now();
    this.state.storage.sql.exec("DELETE FROM mail WHERE expires<=?", now);
    this.state.storage.sql.exec("DELETE FROM offers WHERE expires<=?", now);
    this.state.storage.sql.exec("DELETE FROM allowances WHERE expires<=?", now);
  }

  private pinFor(
    owner: string,
    peer: string,
  ): { peer: string; pair: string; json: string } | undefined {
    const rows = [
      ...this.state.storage.sql.exec(
        "SELECT peer,pair,json FROM pins WHERE owner=? AND peer=?",
        owner,
        peer,
      ),
    ] as any[];
    return rows[0] as any;
  }

  private allPins(owner: string): Array<{ peer: string; pair: string; json: string }> {
    return [
      ...this.state.storage.sql.exec(
        "SELECT peer,pair,json FROM pins WHERE owner=?",
        owner,
      ),
    ] as any[];
  }

  private mutual(a: string, b: string, pair: string): boolean {
    const x = this.pinFor(a, b);
    const y = this.pinFor(b, a);
    return x?.pair === pair && y?.pair === pair;
  }

  private allowLink(a: string, b: string): boolean {
    this.cleanup();
    const rows = [
      ...this.state.storage.sql.exec(
        "SELECT 1 FROM allowances WHERE ((a=? AND b=?) OR (a=? AND b=?)) AND expires>?",
        a,
        b,
        b,
        a,
        Date.now(),
      ),
    ] as any[];
    return rows.length > 0;
  }

  private deliver(c: Client) {
    this.cleanup();
    if (!c.identity) return;
    const rows = [
      ...this.state.storage.sql.exec(
        "SELECT sender,pair,json FROM mail WHERE recipient=? ORDER BY rowid LIMIT 8",
        c.identity.id,
      ),
    ] as any[];
    for (const row of rows) {
      if (this.mutual(String(row.sender), c.identity!.id, String(row.pair)))
        send(c, {
          type: "mail",
          envelope: JSON.parse(String(row.json)),
          pairId: row.pair,
        });
    }
  }

  private removeLinks(c: Client) {
    for (const [id, l] of this.links) {
      if (l.a === c || l.b === c) {
        this.links.delete(id);
        send(l.a === c ? l.b : l.a, { type: "peer-close", connectionId: id });
      }
    }
  }

  private ensureMaintenance() {
    if (this.maintenance) return;
    this.maintenance = setInterval(() => {
      try {
        this.cleanup();
        for (const c of [...this.all]) {
          if (Date.now() >= c.expires) {
            try {
              c.ws.close(1008, "Session expired");
            } catch {}
          } else if (c.authed) {
            if (!c.alive) {
              try {
                c.ws.close(1011, "Ping timeout");
              } catch {}
              continue;
            }
            c.alive = false;
            try {
              c.ws.send(JSON.stringify({ type: "ping" } as any));
            } catch {}
            // Standard ping frames aren't directly available via server.send in Workers web sockets;
            // rely on activity/session expiry and periodic delivery. Mark alive on any message.
            c.alive = true;
            this.deliver(c);
          }
        }
        if (this.all.size === 0 && this.maintenance) {
          clearInterval(this.maintenance);
          this.maintenance = undefined;
        }
      } catch {}
    }, 15000);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({ service: "Butter Chicken relay", status: "ok", protocol: 1 }),
        { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
      );
    }
    if (url.pathname !== "/relay") {
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    if (request.headers.get("Origin")) return new Response("Forbidden", { status: 403 });
    // Cloudflare terminates TLS; the public URL is wss and clients verify certificates normally.
    if (this.all.size >= MAX_CONNECTIONS) return new Response("Full", { status: 503 });

    this.init();
    await cryptoReady();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSession(server as unknown as WebSocket);
    return new Response(null, { status: 101, webSocket: client });
  }

  private handleSession(ws: WebSocket) {
    const c: Client = {
      ws,
      challenge: b64(crypto.getRandomValues(new Uint8Array(32))),
      authed: false,
      window: Date.now(),
      count: 0,
      bytes: 0,
      alive: true,
      expires: Date.now() + 3600000,
    };
    this.all.add(c);
    this.ensureMaintenance();
    // @ts-ignore Workers WebSocket
    ws.accept();
    c.authTimer = setTimeout(() => {
      if (!c.authed) try { ws.close(1008, "Authentication timeout"); } catch {}
    }, 5000);

    send(c, { type: "challenge", challenge: c.challenge });

    ws.addEventListener("message", (evt: MessageEvent) => {
      try {
        if (Date.now() >= c.expires) throw Error("Session expired");
        if (Date.now() - c.window >= 1000) {
          c.window = Date.now();
          c.count = 0;
          c.bytes = 0;
        }
        const raw = evt.data;
        if (typeof raw !== "string") throw Error("Binary");
        c.bytes += new TextEncoder().encode(raw).length;
        if (++c.count > 60 || c.bytes > 524288) throw Error("Rate limit");
        c.alive = true;
        const v = RelayCommand.parse(parseStrictJson(raw));

        if (v.type === "auth") {
          if (c.authed) throw Error("Repeated authentication");
          checkIdentity(v.identity);
          const audience = this.env.RELAY_PUBLIC_URL;
          if (!verifySigned(authInput(c.challenge, v.identity, audience), v.signature, v.identity))
            throw Error("Authentication failed");
          if (this.sessions.has(v.identity.id)) throw Error("Identity already connected");
          c.identity = v.identity;
          c.authed = true;
          this.sessions.set(v.identity.id, c);
          if (c.authTimer) clearTimeout(c.authTimer);
          send(c, { type: "ready" });
          log("authenticated");
          return;
        }
        if (!c.authed || !c.identity) throw Error("Authentication required");
        const own = c.identity;

        if (v.type === "pin") {
          checkIdentity(v.peer);
          if (v.peer.id === own.id || !verifySigned(pinInput(own, v.peer, v.pairId), v.signature, own))
            throw Error("Invalid pin");
          const old = this.pinFor(own.id, v.peer.id);
          if (old && old.pair !== v.pairId) throw Error("Unpin first");
          const countRow = [...this.state.storage.sql.exec("SELECT COUNT(*) AS n FROM pins")][0] as any;
          if (!old && Number(countRow?.n ?? 0) >= MAX_TOTAL_PINS) throw Error("Registration capacity");
          this.state.storage.sql.exec(
            "INSERT INTO pins VALUES (?,?,?,?) ON CONFLICT(owner,peer) DO UPDATE SET pair=excluded.pair,json=excluded.json",
            own.id,
            v.peer.id,
            v.pairId,
            JSON.stringify(v.peer),
          );
          send(c, { type: "pinned" });
          const peer = this.sessions.get(v.peer.id);
          if (this.mutual(own.id, v.peer.id, v.pairId)) {
            send(c, { type: "paired", pairId: v.pairId });
            if (peer) send(peer, { type: "paired", pairId: v.pairId });
          }
          this.deliver(c);
          if (peer) this.deliver(peer);
        } else if (v.type === "unpin") {
          if (v.peerId) {
            for (const [id, l] of this.links) {
              if (
                (l.a === c && l.b.identity?.id === v.peerId) ||
                (l.b === c && l.a.identity?.id === v.peerId)
              ) {
                this.links.delete(id);
                send(l.a === c ? l.b : l.a, { type: "peer-close", connectionId: id });
              }
            }
            this.state.storage.sql.exec(
              "DELETE FROM pins WHERE owner=? AND peer=?",
              own.id,
              v.peerId,
            );
            this.state.storage.sql.exec(
              "DELETE FROM mail WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)",
              own.id,
              v.peerId,
              v.peerId,
              own.id,
            );
          } else {
            this.removeLinks(c);
            this.state.storage.sql.exec("DELETE FROM pins WHERE owner=?", own.id);
            this.state.storage.sql.exec(
              "DELETE FROM mail WHERE sender=? OR recipient=?",
              own.id,
              own.id,
            );
          }
          send(c, { type: "unpinned" });
        } else if (v.type === "link") {
          const peer = this.sessions.get(v.peerId);
          if (!peer || peer === c) {
            send(c, { type: "error", code: "PEER_OFFLINE", requestId: v.requestId });
            return;
          }
          if ([...this.links.values()].filter((l) => l.a === c || l.b === c).length >= 4)
            throw Error("Link limit");
          // Allow linking to a trusted contact or to an actively pairing peer.
          const pin = this.pinFor(own.id, v.peerId);
          const other = this.pinFor(v.peerId, own.id);
          if (!pin && !other && !this.allowLink(own.id, v.peerId))
            throw Error("Not authorized");
          const id = crypto.randomUUID();
          this.links.set(id, { a: c, b: peer });
          send(c, {
            type: "peer-open",
            connectionId: id,
            outbound: true,
            requestId: v.requestId,
            address: "relay",
            port: 0,
          });
          send(peer, {
            type: "peer-open",
            connectionId: id,
            outbound: false,
            address: "relay",
            port: 0,
          });
        } else if (v.type === "frame") {
          const l = this.links.get(v.connectionId);
          if (!l || (l.a !== c && l.b !== c)) return;
          const peer = l.a === c ? l.b : l.a;
          if (v.frame.kind === "hello") {
            if (v.frame.identity.id !== own.id) throw Error("Wrong hello");
          } else {
            checkEnvelope(v.frame as Envelope, own);
            if (v.frame.recipientId !== peer.identity!.id) throw Error("Wrong recipient");
          }
          send(peer, { type: "frame", connectionId: v.connectionId, frame: v.frame });
        } else if (v.type === "drop") {
          const l = this.links.get(v.connectionId);
          if (!l || (l.a !== c && l.b !== c)) return;
          this.links.delete(v.connectionId);
          send(l.a === c ? l.b : l.a, { type: "peer-close", connectionId: v.connectionId });
        } else if (v.type === "mail") {
          checkEnvelope(v.envelope, own);
          const e = v.envelope;
          if (!this.mutual(own.id, e.recipientId, v.pairId)) throw Error("Both identity pins required");
          this.cleanup();
          const oldRows = [
            ...this.state.storage.sql.exec(
              "SELECT json FROM mail WHERE sender=? AND id=?",
              own.id,
              e.messageId,
            ),
          ] as any[];
          const old = oldRows[0];
          if (old && String(old.json) !== JSON.stringify(e)) throw Error("Conflicting duplicate");
          const nRow = [
            ...this.state.storage.sql.exec(
              "SELECT COUNT(*) AS n FROM mail WHERE recipient=?",
              e.recipientId,
            ),
          ][0] as any;
          const totalRow = [...this.state.storage.sql.exec("SELECT COUNT(*) AS n FROM mail")][0] as any;
          if (!old && (Number(nRow?.n ?? 0) >= MAX_MAIL_PER_RECIPIENT || Number(totalRow?.n ?? 0) >= MAX_TOTAL_MAIL)) {
            send(c, { type: "rejected", messageId: e.messageId, code: "QUEUE_FULL" });
            return;
          }
          this.state.storage.sql.exec(
            "INSERT OR IGNORE INTO mail VALUES (?,?,?,?,?,?)",
            own.id,
            e.recipientId,
            e.messageId,
            v.pairId,
            JSON.stringify(e),
            Date.now() + RETENTION_MS,
          );
          send(c, { type: "accepted", messageId: e.messageId });
          const peer = this.sessions.get(e.recipientId);
          if (peer) send(peer, { type: "mail", envelope: e, pairId: v.pairId });
        } else if (v.type === "consume") {
          this.state.storage.sql.exec(
            "DELETE FROM mail WHERE sender=? AND recipient=? AND id=?",
            v.senderId,
            own.id,
            v.messageId,
          );
        } else if (v.type === "poll") {
          this.deliver(c);
        } else if (v.type === "pair-create") {
          if (invitationOwner(v.invitation) !== own.id)
            throw Error("Invitation belongs to another identity");
          this.cleanup();
          this.state.storage.sql.exec("DELETE FROM offers WHERE owner=?", own.id);
          const code = this.newCode();
          const expires = Date.now() + PAIR_CODE_TTL_MS;
          this.state.storage.sql.exec(
            "INSERT INTO offers VALUES (?,?,?,?)",
            code,
            own.id,
            v.invitation,
            expires,
          );
          send(c, { type: "pair-code", code, expires });
        } else if (v.type === "pair-cancel") {
          this.state.storage.sql.exec("DELETE FROM offers WHERE owner=?", own.id);
          send(c, { type: "pair-cancelled" });
        } else if (v.type === "pair-join") {
          this.cleanup();
          const now = Date.now();
          this.failedJoins = this.failedJoins.filter((t) => now - t < 60_000);
          if (this.failedJoins.length >= 50) {
            send(c, { type: "error", code: "PAIR_RATE_LIMITED" });
            return;
          }
          const row = [
            ...this.state.storage.sql.exec(
              "SELECT owner,invitation FROM offers WHERE code=?",
              v.code,
            ),
          ][0] as { owner: string; invitation: string } | undefined;
          if (!row || row.owner === own.id) {
            this.failedJoins.push(now);
            send(c, { type: "error", code: "PAIR_NOT_FOUND" });
            return;
          }
          // A code is single use: remove it before replying.
          this.state.storage.sql.exec("DELETE FROM offers WHERE code=?", v.code);
          this.state.storage.sql.exec(
            "INSERT INTO allowances(a,b,expires) VALUES (?,?,?) ON CONFLICT(a,b) DO UPDATE SET expires=excluded.expires",
            String(row.owner),
            own.id,
            Date.now() + 120000,
          );
          send(c, { type: "pair-offer", invitation: String(row.invitation) });
        }
      } catch {
        log("rejected");
        try { ws.close(1008, "Invalid or unauthorized relay command"); } catch {}
      }
    });

    const onClose = () => {
      try { if (c.authTimer) clearTimeout(c.authTimer); } catch {}
      this.all.delete(c);
      if (c.identity && this.sessions.get(c.identity.id) === c) this.sessions.delete(c.identity.id);
      this.removeLinks(c);
      log("disconnected");
      if (this.all.size === 0 && this.maintenance) {
        clearInterval(this.maintenance);
        this.maintenance = undefined;
      }
    };
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onClose);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" || url.pathname === "/relay") {
      const id = env.RELAY.idFromName("global");
      const stub = env.RELAY.get(id);
      return stub.fetch(request);
    }
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  },
};
