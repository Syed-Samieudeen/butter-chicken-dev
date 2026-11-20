import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { once } from "node:events";
import { timingSafeEqual } from "node:crypto";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { parseStrictJson } from "../shared/json.js";
import { parseFrame, type ServerEvent } from "../shared/protocol.js";
import {
  createIdentity,
  makeHello,
  randomChallenge,
  sealEnvelope,
  openEnvelope,
  makeInvitation,
  parseInvitation,
  cryptoReady,
} from "../client/crypto.js";
import { ClientApi, type LocalSocket } from "../client/api.js";
import { ChatEngine } from "../client/engine.js";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const options = {
  dataFile: ":memory:",
  uiPort: 0,
  relayUrl: "ws://127.0.0.1:9/relay",
  relayDevelopment: true,
};
async function raw(port: number, input: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port }, () =>
      socket.end(input, "latin1"),
    );
    let output = "";
    socket.on("data", (b) => (output += b.toString()));
    socket.once("close", () => resolve(output));
    socket.once("error", () => resolve(output));
    socket.setTimeout(2000, () => socket.destroy());
  });
}
async function session(port: number) {
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base + "/api/bootstrap");
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const info = (await response.json()) as { csrf: string; dataEpoch: string };
  return {
    base,
    cookie,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-BC-CSRF": info.csrf,
      "X-BC-DATA-EPOCH": info.dataEpoch,
    },
  };
}
async function local(port: number, cookie: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/local`, {
    headers: { Cookie: cookie, Origin: `http://127.0.0.1:${port}` },
  });
  await once(ws, "open");
  return ws;
}
async function rejected(url: string, headers?: Record<string, string>) {
  const ws = new WebSocket(url, { headers, handshakeTimeout: 1500 });
  return new Promise<boolean>((resolve) => {
    ws.once("error", () => resolve(true));
    ws.once("open", () => {
      ws.terminate();
      resolve(false);
    });
  });
}

test("strict JSON rejects duplicate members, alternate encodings and prototype field attacks", () => {
  assert.deepEqual(
    parseStrictJson(
      ' \n { "value" : "a b\\n\\\"c", "nested" : [1,true,null] } ',
    ),
    { value: 'a b\n"c', nested: [1, true, null] },
  );
  for (const input of [
    '{"x":1,"x":2}',
    '{"x":{"y":1,"y":1}}',
    '{"v":"\\u0061"}',
    '{"v":1e0}',
    '{"v":-0}',
    "{",
    "NaN",
  ])
    assert.throws(() => parseStrictJson(input), input);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  const parsed = parseStrictJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(parsed!), Object.prototype);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("mutation corpus rejects malformed frames, tampering, malicious invitations and key substitution", async () => {
  await cryptoReady;
  const a = createIdentity("Alice"),
    b = createIdentity("Bob");
  const hello = makeHello(a, randomChallenge());
  const envelope = sealEnvelope(a, b.public, { text: "synthetic secret" });
  let mutations = 0;
  for (const seed of [hello, envelope])
    for (const key of Object.keys(seed)) {
      const missing = { ...seed } as Record<string, unknown>;
      delete missing[key];
      assert.throws(() => parseFrame(JSON.stringify(missing)));
      mutations++;
      for (const value of [null, [], {}, 17, "", "💥", "x".repeat(70000)]) {
        assert.throws(() =>
          parseFrame(JSON.stringify({ ...seed, [key]: value })),
        );
        mutations++;
      }
    }
  for (const key of Object.keys(envelope)) {
    const value = envelope[key as keyof typeof envelope];
    const changed =
      typeof value === "string"
        ? (value[0] === "A" ? "B" : "A") + value.slice(1)
        : 2;
    assert.throws(() =>
      openEnvelope(b, a.public, { ...envelope, [key]: changed }),
    );
    mutations++;
  }
  assert.throws(() =>
    parseFrame(
      JSON.stringify(hello).replace('"version":1', '"version":1,"version":1'),
    ),
  );
  assert.throws(() =>
    parseFrame(JSON.stringify({ ...hello, __protoField: { polluted: true } })),
  );
  const relayUrl = "wss://relay.example.com/relay";
  const { text } = makeInvitation(a, relayUrl);
  const original = JSON.parse(
    Buffer.from(text.slice(4), "base64url").toString(),
  );
  for (const changed of [
    { ...original, identity: b.public },
    { ...original, relayUrl: "wss://evil.invalid/relay" },
    { ...original, expires: 0 },
    { ...original, token: "A".repeat(43) },
  ]) {
    assert.throws(() =>
      parseInvitation(
        "BC1." + Buffer.from(JSON.stringify(changed)).toString("base64url"),
      ),
    );
  }
  for (const bad of ["BC1.", "BC1.!!!", "BC1." + "A".repeat(40), "NOPE"])
    assert.throws(() => parseInvitation(bad));
  assert.ok(mutations >= 120);
});

test(
  "forked service survives malformed request targets, Unicode credentials, invalid headers and traversal",
  { timeout: 15000 },
  async () => {
    const child: ChildProcess = fork("tests/security-server.ts", {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let diagnostic = "";
    child.stderr!.on("data", (b) => (diagnostic += b.toString()));
    const ports = (await once(child, "message"))[0] as {
      uiPort: number;
    };
    try {
      const host = `127.0.0.1:${ports.uiPort}`;
      const bad = await raw(
        ports.uiPort,
        `GET //[ HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      );
      assert.match(bad, /^HTTP\/1.1 400/);
      // The former string-length comparison passes this check, then timingSafeEqual throws on byte lengths.
      assert.throws(() =>
        timingSafeEqual(
          Buffer.from("é".repeat(64)),
          Buffer.from("a".repeat(64)),
        ),
      );
      const targets = [
        "//[",
        "http://[",
        "/%ZZ.png",
        "/..%2f..%2fserver%2fapp.ts",
        "/%00.png",
        "/.env",
        "/data.sqlite",
        "/api/not-found",
      ];
      for (const target of targets) {
        const response = await raw(
          ports.uiPort,
          `GET ${target} HTTP/1.1\r\nHost: ${host}\r\nCookie: bc-session=${"é".repeat(64)}\r\nConnection: close\r\n\r\n`,
        );
        assert.ok(!/^HTTP\/1.1 200/.test(response), target);
        assert.ok(
          !response.includes("randomBytes") && !response.includes("BC_UI_PORT"),
        );
      }
      const s = await session(ports.uiPort);
      for (const [key, version] of [
        ["not-base64", "13"],
        ["dGhlIHNhbXBsZSBub25jZQ==", "2"],
      ]) {
        const response = await raw(
          ports.uiPort,
          `GET /local HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${s.base}\r\nCookie: ${s.cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: ${version}\r\n\r\n`,
        );
        assert.ok(/^HTTP\/1.1 (400|426)/.test(response));
      }
      assert.match(
        await raw(
          ports.uiPort,
          `TRACE / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
        ),
        /^HTTP\/1.1 405/,
      );
      const csrfBad = await raw(
        ports.uiPort,
        `POST /api/reset HTTP/1.1\r\nHost: ${host}\r\nCookie: ${s.cookie}\r\nX-BC-CSRF: ${"é".repeat(64)}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
      );
      assert.match(csrfBad, /^HTTP\/1.1 403/);
      for (const request of [
        `GET / HTTP/1.1\r\nHost: evil.invalid\r\n\r\n`,
        `GET / HTTP/1.1\r\nHost: ${host}\r\nBad Header: x\r\n\r\n`,
        `POST /api/reset HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n{}`,
        `GET / HTTP/1.1\r\nHost: ${host}\r\nX-Long: ${"a".repeat(20000)}\r\n\r\n`,
      ])
        assert.ok(!/^HTTP\/1.1 200/.test(await raw(ports.uiPort, request)));
      assert.equal((await fetch(s.base + "/api/bootstrap")).status, 200);
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
      assert.ok(
        !diagnostic.includes("Invalid URL") &&
          !diagnostic.includes("RangeError"),
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.send("stop");
        await once(child, "exit");
      }
    }
  },
);

test("API validation rejects duplicate JSON, oversized input, SQL and prototype payloads; local-process boundary is explicit", async () => {
  const app = await createApp(options);
  try {
    const s = await session(app.uiPort);
    for (const body of [
      '{"messageId":"ab","messageId":"cd"}',
      '{"messageId":"\u0027; DROP TABLE messages;--"}',
      '{"__proto__":{"polluted":true}}',
      "{",
      '{"messageId":null}',
      '"' + "a".repeat(1_048_577) + '"',
    ]) {
      const response = await fetch(s.base + "/api/delivered", {
        method: "POST",
        headers: s.headers,
        body,
      });
      assert.equal(response.status, 400);
      assert.ok(!(await response.text()).includes("DROP TABLE"));
    }
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    assert.equal(app.store.history().length, 0);
    const burst = await Promise.all(
      Array.from({ length: 32 }, (_, n) =>
        fetch(s.base + "/api/receive", {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify({
            messageId: n.toString(16).padStart(32, "0"),
            peerId: "ab".repeat(32),
            direction: "incoming",
            delivered: true,
            data: {
              version: 1,
              nonce: "A".repeat(32),
              ciphertext: "B".repeat(40),
            },
          }),
        }),
      ),
    );
    assert.ok(burst.every((response) => response.status === 200));
    assert.equal(app.store.history().length, 32);
    // A native process on this computer can bootstrap. This is NOT OS-user/process authentication.
    const native = await session(app.uiPort);
    assert.equal(
      (await fetch(native.base + "/api/history", { headers: native.headers }))
        .status,
      200,
    );
    assert.equal(
      (
        await fetch(native.base + "/api/history", {
          method: "DELETE",
          headers: native.headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(native.base + "/api/bootstrap", {
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(native.base + "/api/bootstrap", {
          headers: { Origin: "null" },
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test(
  "WebSocket authorization, malformed local commands and simultaneous-session limits",
  { timeout: 20000 },
  async () => {
    await cryptoReady;
    const app = await createApp(options);
    const sockets: WebSocket[] = [];
    try {
      const s = await session(app.uiPort);
      const ui = `ws://127.0.0.1:${app.uiPort}/local`;
      assert.equal(await rejected(ui), true);
      assert.equal(
        await rejected(ui, {
          Cookie: s.cookie,
          Origin: "https://evil.invalid",
        }),
        true,
      );
      assert.equal(
        await rejected(ui, { Cookie: "bc-session=bad", Origin: s.base }),
        true,
      );
      assert.equal(
        await rejected(`ws://127.0.0.1:${app.uiPort}/lan`, {
          Cookie: s.cookie,
          Origin: s.base,
        }),
        true,
        "The removed LAN endpoint must not accept connections",
      );
      const client = await local(app.uiPort, s.cookie);
      sockets.push(client);
      const second = new WebSocket(ui, {
        headers: { Cookie: s.cookie, Origin: s.base },
      });
      const secondClosed = once(second, "close");
      await once(second, "open");
      assert.equal((await secondClosed)[0], 4009);
      assert.equal(client.extensions, "");
      const events: unknown[] = [];
      client.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      client.send('{"type":"disconnect-all","type":"disconnect-all"}');
      client.send('{"type":"relay-send","packet":{"type":"poll","extra":1}}');
      await pause(60);
      assert.ok(
        events.filter(
          (x) => (x as { code?: string }).code === "INVALID_LOCAL_COMMAND",
        ).length >= 2,
      );
      assert.equal((await fetch(s.base + "/api/bootstrap")).status, 200);
    } finally {
      for (const ws of sockets) ws.terminate();
      await app.close();
    }
  },
);

test(
  "browser event queue is bounded, locks safely on overload, and discards stale events",
  async () => {
    const app = await createApp(options);
    const api = new ClientApi(`http://127.0.0.1:${app.uiPort}`);
    let event!: (value: ServerEvent) => void;
    api.socket = async (callback) => {
      event = callback;
      return {
        readyState: 1,
        send() {},
        close() {},
        addEventListener() {},
      } as LocalSocket;
    };
    const engine = new ChatEngine(api);
    try {
      await engine.init();
      await engine.create("Synthetic", "queue test only long private passphrase");
      for (let n = 0; n < 300; n++)
        event({ type: "error", code: "FLOOD" });
      assert.equal(engine.getSnapshot().mode, "locked");
      assert.equal(engine.getSnapshot().self, undefined);
      await pause(10);
      assert.equal(engine.getSnapshot().mode, "locked");
      await engine.unlock("queue test only long private passphrase");
      assert.equal(engine.getSnapshot().mode, "ready");
    } finally {
      engine.dispose();
      await app.close();
    }
  },
);

test("corrupted vault record returns a safe storage error without terminating the service", async () => {
  const app = await createApp(options);
  try {
    app.store.db
      .prepare("INSERT INTO vault VALUES (1,?)")
      .run('{"corrupted":true}');
    const response = await fetch(
      `http://127.0.0.1:${app.uiPort}/api/bootstrap`,
    );
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("corrupted"));
    app.store.db.exec("DELETE FROM vault");
    assert.equal(
      (await fetch(`http://127.0.0.1:${app.uiPort}/api/bootstrap`)).status,
      200,
    );
  } finally {
    await app.close();
  }
});
