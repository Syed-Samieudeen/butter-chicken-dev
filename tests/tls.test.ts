import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { connect as tcpConnect } from "node:net";
import type { Duplex } from "node:stream";
import * as tls from "node:tls";
import { WebSocket } from "ws";
import { createRelay } from "../relay/service.js";
import { cryptoReady, createIdentity } from "../client/crypto.js";
import { authInput, signed } from "../shared/relay.js";
const wait = async (p: () => boolean) => {
  const start = Date.now();
  while (!p()) {
    if (Date.now() - start > 5000) throw Error("Timeout");
    await new Promise((r) => setTimeout(r, 15));
  }
};
test(
  "production WSS validates certificates, refuses an untrusted endpoint and authenticates over a trusted TLS proxy",
  { timeout: 15000 },
  async () => {
    await cryptoReady;
    const dir = await mkdtemp(join(tmpdir(), "bc-tls-"));
    const cert = join(dir, "cert.pem"),
      key = join(dir, "key.pem");
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        { stdio: "ignore" },
      );
    } catch {
      await rm(dir, { recursive: true, force: true });
      throw Error("Install OpenSSL for the isolated TLS regression test");
    }
    let relayPort = 0;
    const sockets = new Set<Duplex>();
    const proxy = createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (_req, res) => {
        res.writeHead(404);
        res.end();
      },
    );
    proxy.on("upgrade", (req, socket, head) => {
      const upstream = tcpConnect(relayPort, "127.0.0.1");
      sockets.add(socket);
      sockets.add(upstream);
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
      socket.once("close", () => {
        sockets.delete(socket);
        upstream.destroy();
      });
      upstream.once("close", () => sockets.delete(upstream));
      upstream.once("connect", () => {
        const headers = Object.entries(req.headers)
          .filter(([k]) => k !== "x-forwarded-proto")
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n");
        upstream.write(
          `GET /relay HTTP/1.1\r\n${headers}\r\nX-Forwarded-Proto: https\r\n\r\n`,
        );
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const url = `wss://127.0.0.1:${(proxy.address() as { port: number }).port}/relay`;
    const relay = await createRelay({
      port: 0,
      dataFile: ":memory:",
      publicUrl: url,
    });
    relayPort = relay.port;
    const old = tls.getCACertificates("default");
    let good: WebSocket | undefined;
    try {
      const bad = new WebSocket(url);
      let reason = "";
      bad.on("error", (e) => {
        reason = e.message;
      });
      await wait(() => bad.readyState === 3);
      assert.match(reason, /certificate|self.signed/i);
      assert.equal(
        relay.db.prepare("SELECT COUNT(*) AS n FROM pins").get()!.n,
        0,
      );
      // Trust this disposable local certificate, keeping ordinary TLS verification enabled.
      tls.setDefaultCACertificates([...old, await readFile(cert, "utf8")]);
      good = new WebSocket(url);
      const packets: any[] = [];
      good.on("error", () => {});
      good.on("message", (raw) => packets.push(JSON.parse(raw.toString())));
      await wait(() => packets.some((p) => p.type === "challenge"));
      const identity = createIdentity("TLS test");
      good.send(
        JSON.stringify({
          type: "auth",
          identity: identity.public,
          signature: signed(
            authInput(packets[0].challenge, identity.public, url),
            identity.signSecret,
          ),
        }),
      );
      await wait(() => packets.some((p) => p.type === "ready"));
      assert.equal(good.readyState, 1);
    } finally {
      good?.terminate();
      tls.setDefaultCACertificates(old);
      for (const s of sockets) s.destroy();
      await relay.close();
      await new Promise<void>((r) => proxy.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
