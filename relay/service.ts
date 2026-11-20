import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import sodium from "libsodium-wrappers-sumo";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, statSync } from "node:fs";
import { dirname } from "node:path";
import {
  RelayUrl,
  RelayCommand,
  authInput,
  pinInput,
  checkIdentity,
  checkEnvelope,
  verifySigned,
  invitationOwner,
  PAIR_CODE_TTL_MS,
} from "../shared/relay.js";
import { randomInt } from "node:crypto";
import { parseStrictJson } from "../shared/json.js";
import { MAX_FRAME_BYTES, type PublicIdentity } from "../shared/protocol.js";
export const RETENTION_MS = 24 * 60 * 60 * 1000;
export interface RelayOptions {
  port?: number;
  host?: string;
  publicUrl?: string;
  dataFile: string;
  development?: boolean;
  maxConnections?: number;
  retentionMs?: number;
  sessionMs?: number;
  log?: (record: object) => void;
}
export async function createRelay(options: RelayOptions) {
  await sodium.ready;
  if (
    !options.development &&
    (!options.publicUrl ||
      !RelayUrl.parse(options.publicUrl).startsWith("wss:"))
  )
    throw Error("Set a production WSS public URL");
  if (options.dataFile !== ":memory:") {
    mkdirSync(dirname(options.dataFile), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      const d = statSync(dirname(options.dataFile));
      if (
        (d.mode & 0o077) !== 0 ||
        (process.getuid && d.uid !== process.getuid())
      )
        throw Error("Relay data directory must be owned and private (0700)");
    }
  }
  const db = new DatabaseSync(options.dataFile);
  if (options.dataFile !== ":memory:") chmodSync(options.dataFile, 0o600);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS pins(owner TEXT PRIMARY KEY,peer TEXT NOT NULL,pair TEXT NOT NULL,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mail(sender TEXT,recipient TEXT,id TEXT,pair TEXT,json TEXT,expires INTEGER,PRIMARY KEY(sender,id));
 CREATE TABLE IF NOT EXISTS offers(code TEXT PRIMARY KEY,owner TEXT NOT NULL,invitation TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const retention = Math.min(options.retentionMs ?? RETENTION_MS, RETENTION_MS);
  const cleanup = () => {
    db.prepare("DELETE FROM mail WHERE expires<=?").run(Date.now());
    db.prepare("DELETE FROM offers WHERE expires<=?").run(Date.now());
  };
  cleanup();
  // Failed 6-digit guesses across all connections. Identities are free to create, so the limit is global.
  const failedJoins: number[] = [];
  const newCode = () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      if (!db.prepare("SELECT 1 FROM offers WHERE code=?").get(code)) return code;
    }
    throw Error("Pairing capacity");
  };
  const sessions = new Map<string, Client>();
  const all = new Set<Client>();
  const links = new Map<string, { a: Client; b: Client }>();
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
  };
  const log = (event: string) =>
    options.log?.({ event, time: new Date().toISOString() });
  const send = (c: Client, v: unknown) => {
    if (c.ws.readyState === 1) {
      if (c.ws.bufferedAmount > 1_048_576) {
        c.ws.close(1008, "Backpressure");
        return;
      }
      c.ws.send(JSON.stringify(v));
    }
  };
  const pinned = (id: string) =>
    db.prepare("SELECT peer,pair,json FROM pins WHERE owner=?").get(id);
  const mutual = (a: string, b: string, pair: string) => {
    const x = pinned(a),
      y = pinned(b);
    return x?.peer === b && y?.peer === a && x.pair === pair && y.pair === pair;
  };
  const deliver = (c: Client) => {
    cleanup();
    if (!c.identity) return;
    for (const row of db
      .prepare(
        "SELECT sender,pair,json FROM mail WHERE recipient=? ORDER BY rowid LIMIT 8",
      )
      .all(c.identity.id)) {
      if (mutual(String(row.sender), c.identity.id, String(row.pair)))
        send(c, {
          type: "mail",
          envelope: JSON.parse(String(row.json)),
          pairId: row.pair,
        });
    }
  };
  const removeLinks = (c: Client) => {
    for (const [id, l] of links) {
      if (l.a === c || l.b === c) {
        links.delete(id);
        send(l.a === c ? l.b : l.a, { type: "peer-close", connectionId: id });
      }
    }
  };
  const http = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          service: "Butter Chicken relay",
          status: "ok",
          protocol: 1,
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  http.maxConnections = options.maxConnections ?? 64;
  http.maxHeadersCount = 24;
  http.headersTimeout = 5000;
  http.requestTimeout = 10000;
  http.setTimeout(10000, (s) => s.destroy());
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES + 2048,
    perMessageDeflate: false,
  });
  http.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/relay" ||
      req.headers.origin ||
      all.size >= (options.maxConnections ?? 64) ||
      (!options.development && req.headers["x-forwarded-proto"] !== "https")
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  wss.on("connection", (ws: WebSocket) => {
    const c: Client = {
      ws,
      challenge: randomBytes(32).toString("base64url"),
      authed: false,
      window: Date.now(),
      count: 0,
      bytes: 0,
      alive: true,
      expires: Date.now() + (options.sessionMs ?? 3600000),
    };
    all.add(c);
    const authTimer = setTimeout(() => {
      if (!c.authed) ws.close(1008, "Authentication timeout");
    }, 5000);
    authTimer.unref();
    send(c, { type: "challenge", challenge: c.challenge });
    ws.on("pong", () => {
      c.alive = true;
    });
    ws.on("message", (raw, binary) => {
      try {
        if (Date.now() >= c.expires) throw Error("Session expired");
        if (Date.now() - c.window >= 1000) {
          c.window = Date.now();
          c.count = 0;
          c.bytes = 0;
        }
        c.bytes += Buffer.byteLength(raw.toString());
        if (binary || ++c.count > 60 || c.bytes > 524288)
          throw Error("Rate limit");
        const v = RelayCommand.parse(parseStrictJson(raw.toString()));
        if (v.type === "auth") {
          if (c.authed) throw Error("Repeated authentication");
          checkIdentity(v.identity);
          if (
            !verifySigned(
              authInput(
                c.challenge,
                v.identity,
                options.publicUrl ?? `ws://127.0.0.1:${port}/relay`,
              ),
              v.signature,
              v.identity,
            )
          )
            throw Error("Authentication failed");
          if (sessions.has(v.identity.id))
            throw Error("Identity already connected");
          c.identity = v.identity;
          c.authed = true;
          sessions.set(v.identity.id, c);
          clearTimeout(authTimer);
          send(c, { type: "ready" });
          log("authenticated");
          return;
        }
        if (!c.authed || !c.identity) throw Error("Authentication required");
        const own = c.identity;
        if (v.type === "pin") {
          checkIdentity(v.peer);
          if (
            v.peer.id === own.id ||
            !verifySigned(pinInput(own, v.peer, v.pairId), v.signature, own)
          )
            throw Error("Invalid pin");
          const old = pinned(own.id);
          if (old && (old.peer !== v.peer.id || old.pair !== v.pairId))
            throw Error("Unpin first");
          const count = db.prepare("SELECT COUNT(*) AS n FROM pins").get()!;
          if (!old && Number(count.n) >= 10000)
            throw Error("Registration capacity");
          db.prepare(
            "INSERT INTO pins VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET json=excluded.json",
          ).run(own.id, v.peer.id, v.pairId, JSON.stringify(v.peer));
          send(c, { type: "pinned" });
          const peer = sessions.get(v.peer.id);
          if (mutual(own.id, v.peer.id, v.pairId)) {
            send(c, { type: "paired", pairId: v.pairId });
            if (peer) send(peer, { type: "paired", pairId: v.pairId });
          }
          deliver(c);
          if (peer) deliver(peer);
        } else if (v.type === "unpin") {
          removeLinks(c);
          db.prepare("DELETE FROM pins WHERE owner=?").run(own.id);
          db.prepare("DELETE FROM mail WHERE sender=? OR recipient=?").run(
            own.id,
            own.id,
          );
          send(c, { type: "unpinned" });
        } else if (v.type === "link") {
          const peer = sessions.get(v.peerId);
          if (!peer || peer === c) {
            send(c, {
              type: "error",
              code: "PEER_OFFLINE",
              requestId: v.requestId,
            });
            return;
          }
          if (
            [...links.values()].filter((l) => l.a === c || l.b === c).length >=
            4
          )
            throw Error("Link limit");
          const pin = pinned(own.id),
            other = pinned(v.peerId);
          if (
            (pin && pin.peer !== v.peerId) ||
            (other && other.peer !== own.id)
          )
            throw Error("Not authorized");
          const id = randomUUID();
          links.set(id, { a: c, b: peer });
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
          const l = links.get(v.connectionId);
          if (!l || (l.a !== c && l.b !== c)) throw Error("Wrong link");
          const peer = l.a === c ? l.b : l.a;
          if (v.frame.kind === "hello") {
            if (v.frame.identity.id !== own.id) throw Error("Wrong hello");
          } else {
            checkEnvelope(v.frame, own);
            if (v.frame.recipientId !== peer.identity!.id)
              throw Error("Wrong recipient");
          }
          send(peer, {
            type: "frame",
            connectionId: v.connectionId,
            frame: v.frame,
          });
        } else if (v.type === "drop") {
          const l = links.get(v.connectionId);
          if (!l || (l.a !== c && l.b !== c)) throw Error("Wrong link");
          links.delete(v.connectionId);
          send(l.a === c ? l.b : l.a, {
            type: "peer-close",
            connectionId: v.connectionId,
          });
        } else if (v.type === "mail") {
          checkEnvelope(v.envelope, own);
          const e = v.envelope;
          if (!mutual(own.id, e.recipientId, v.pairId))
            throw Error("Both identity pins required");
          cleanup();
          const old = db
            .prepare("SELECT json FROM mail WHERE sender=? AND id=?")
            .get(own.id, e.messageId);
          if (old && String(old.json) !== JSON.stringify(e))
            throw Error("Conflicting duplicate");
          const n = db
            .prepare("SELECT COUNT(*) AS n FROM mail WHERE recipient=?")
            .get(e.recipientId)!;
          const total = db.prepare("SELECT COUNT(*) AS n FROM mail").get()!;
          if (!old && (Number(n.n) >= 256 || Number(total.n) >= 4096)) {
            send(c, {
              type: "rejected",
              messageId: e.messageId,
              code: "QUEUE_FULL",
            });
            return;
          }
          db.prepare("INSERT OR IGNORE INTO mail VALUES (?,?,?,?,?,?)").run(
            own.id,
            e.recipientId,
            e.messageId,
            v.pairId,
            JSON.stringify(e),
            Date.now() + retention,
          );
          send(c, { type: "accepted", messageId: e.messageId });
          const peer = sessions.get(e.recipientId);
          if (peer) send(peer, { type: "mail", envelope: e, pairId: v.pairId });
        } else if (v.type === "consume") {
          db.prepare(
            "DELETE FROM mail WHERE sender=? AND recipient=? AND id=?",
          ).run(v.senderId, own.id, v.messageId);
        } else if (v.type === "poll") deliver(c);
        else if (v.type === "pair-create") {
          if (invitationOwner(v.invitation) !== own.id)
            throw Error("Invitation belongs to another identity");
          cleanup();
          db.prepare("DELETE FROM offers WHERE owner=?").run(own.id);
          const code = newCode();
          const expires = Date.now() + PAIR_CODE_TTL_MS;
          db.prepare("INSERT INTO offers VALUES (?,?,?,?)").run(
            code,
            own.id,
            v.invitation,
            expires,
          );
          send(c, { type: "pair-code", code, expires });
        } else if (v.type === "pair-cancel") {
          db.prepare("DELETE FROM offers WHERE owner=?").run(own.id);
          send(c, { type: "pair-cancelled" });
        } else if (v.type === "pair-join") {
          cleanup();
          const recent = failedJoins.filter((t) => Date.now() - t < 60_000);
          failedJoins.splice(0, failedJoins.length, ...recent);
          if (recent.length >= 50) {
            send(c, { type: "error", code: "PAIR_RATE_LIMITED" });
            return;
          }
          const row = db
            .prepare("SELECT owner,invitation FROM offers WHERE code=?")
            .get(v.code);
          if (!row || row.owner === own.id) {
            failedJoins.push(Date.now());
            send(c, { type: "error", code: "PAIR_NOT_FOUND" });
            return;
          }
          // A code is single use: remove it before replying.
          db.prepare("DELETE FROM offers WHERE code=?").run(v.code);
          send(c, { type: "pair-offer", invitation: String(row.invitation) });
        }
      } catch {
        log("rejected");
        ws.close(1008, "Invalid or unauthorized relay command");
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(authTimer);
      all.delete(c);
      if (c.identity && sessions.get(c.identity.id) === c)
        sessions.delete(c.identity.id);
      removeLinks(c);
      log("disconnected");
    });
  });
  const maintenance = setInterval(() => {
    cleanup();
    for (const c of all) {
      if (Date.now() >= c.expires) c.ws.close(1008, "Session expired");
      else if (c.authed) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
        deliver(c);
      }
    }
  }, 15000);
  maintenance.unref();
  const port = await new Promise<number>((res, rej) => {
    http.once("error", rej);
    http.listen(options.port ?? 8787, options.host ?? "127.0.0.1", () =>
      res((http.address() as { port: number }).port),
    );
  });
  return {
    port,
    db,
    async close() {
      clearInterval(maintenance);
      for (const c of all) c.ws.terminate();
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
      db.close();
    },
  };
}
