import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import {
  ArchiveSchema,
  VaultSchema,
  type Archive,
  type Vault,
} from "../shared/protocol.js";

/** This module accepts ciphertext only. It has no cryptography keys or message text. */
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") {
        const directory = statSync(dirname(path));
        if (
          (directory.mode & 0o077) !== 0 ||
          (process.getuid && directory.uid !== process.getuid())
        )
          throw new Error(
            "Data directory must belong to this user and be private (chmod 700 the dedicated data directory)",
          );
      }
    }
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, peer TEXT NOT NULL, direction TEXT NOT NULL, delivered INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seen (sender TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(sender,id));`);
  }
  nodeId(): string {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get("nodeId");
    if (row) return String(row.value);
    const id = randomBytes(16).toString("hex");
    this.db.prepare("INSERT INTO metadata VALUES (?,?)").run("nodeId", id);
    return id;
  }
  vault(): Vault | null {
    const row = this.db.prepare("SELECT json FROM vault WHERE id=1").get();
    return row ? VaultSchema.parse(JSON.parse(String(row.json))) : null;
  }
  saveVault(vault: unknown, create = false): void {
    const data = VaultSchema.parse(vault);
    if (create)
      this.db
        .prepare("INSERT INTO vault VALUES (1,?)")
        .run(JSON.stringify(data));
    else
      this.db
        .prepare(
          "INSERT INTO vault VALUES (1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
        )
        .run(JSON.stringify(data));
  }
  receipt(id: string, state: "SENT" | "DELIVERED" | "READ"): void {
    const raw = this.db
      .prepare("SELECT json FROM messages WHERE id=? AND direction='outgoing'")
      .get(id);
    if (!raw) return;
    const row = ArchiveSchema.parse(JSON.parse(String(raw.json)));
    const rank = {
      QUEUED: 0,
      SENDING: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
      FAILED: -1,
    };
    if (rank[state] <= rank[row.state ?? "QUEUED"]) return;
    row.state = state;
    this.db
      .prepare(
        "UPDATE messages SET json=?,delivered=MAX(delivered,?) WHERE id=?",
      )
      .run(
        JSON.stringify(row),
        Number(state === "DELIVERED" || state === "READ"),
        id,
      );
  }
  history(): Archive[] {
    return this.db
      .prepare("SELECT json,delivered FROM messages ORDER BY seq")
      .all()
      .map((row) => ({
        ...ArchiveSchema.parse(JSON.parse(String(row.json))),
        delivered: Boolean(row.delivered),
      }));
  }
  putOutgoing(value: unknown): void {
    const row = ArchiveSchema.parse(value);
    if (row.direction !== "outgoing") throw new Error("Wrong direction");
    this.db
      .prepare(
        "INSERT INTO messages(id,peer,direction,delivered,json) VALUES (?,?,?,?,?)",
      )
      .run(
        row.messageId,
        row.peerId,
        row.direction,
        Number(row.delivered),
        JSON.stringify(row),
      );
  }
  /** Atomic archive + persistent replay tombstone. Never clear tombstones when clearing history. */
  receive(value: unknown): boolean {
    const row = ArchiveSchema.parse(value);
    if (row.direction !== "incoming") throw new Error("Wrong direction");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare("INSERT OR IGNORE INTO seen(sender,id) VALUES (?,?)")
        .run(row.peerId, row.messageId);
      if (!result.changes) {
        this.db.exec("COMMIT");
        return false;
      }
      this.db
        .prepare(
          "INSERT INTO messages(id,peer,direction,delivered,json) VALUES (?,?,?,?,?)",
        )
        .run(row.messageId, row.peerId, row.direction, 1, JSON.stringify(row));
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  delivered(id: string): void {
    this.db
      .prepare(
        "UPDATE messages SET delivered=1 WHERE id=? AND direction='outgoing'",
      )
      .run(id);
  }
  clearHistory(): void {
    this.db.exec("DELETE FROM messages; VACUUM;");
  }
  reset(): void {
    this.db.exec(
      "DELETE FROM vault; DELETE FROM messages; DELETE FROM seen; VACUUM;",
    );
  }
  close(): void {
    this.db.close();
  }
}
