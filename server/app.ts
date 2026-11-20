import { RelayUrl, RelayCommand } from "../shared/relay.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { Store } from "./store.js";
import {
  ArchiveSchema,
  LocalCommandSchema,
  MAX_FRAME_BYTES,
  MessageId,
  type ServerEvent,
} from "../shared/protocol.js";
import {
  applicationSchema,
  metadataForPath,
  normalizePath,
  pageMetadata,
} from "../shared/pages.js";
import { parseStrictJson } from "../shared/json.js";

const schemaHash = createHash("sha256")
  .update(applicationSchema)
  .digest("base64");
const htmlEscape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
function pageHtml(html: string, path: string, origin: string): string {
  const metadata = metadataForPath(path);
  return html
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${htmlEscape(metadata.title)}</title>`,
    )
    .replace(
      /(<meta\s+(?:name|property)="(?:description|og:description|twitter:description)"\s+content=")[^"]*"/g,
      `$1${htmlEscape(metadata.description)}"`,
    )
    .replace(
      /(<meta\s+(?:name|property)="(?:og:title|twitter:title)"\s+content=")[^"]*"/g,
      `$1${htmlEscape(metadata.title)}"`,
    )
    .replace(
      /content="\/social-share.png"/g,
      `content="${origin}/social-share.png"`,
    )
    .replace(
      "<!--APP_SCHEMA-->",
      `<script type="application/ld+json">${applicationSchema}</script>`,
    );
}

export interface AppOptions {
  uiPort?: number;
  dataFile: string;
  development?: boolean;
  relayUrl: string;
  relayDevelopment?: boolean;
}
const listen = (
  server: ReturnType<typeof createServer>,
  port: number,
  host: string,
) =>
  new Promise<number>((res, rej) => {
    server.once("error", rej);
    server.listen(port, host, () => {
      server.removeListener("error", rej);
      res((server.address() as { port: number }).port);
    });
  });
const equal = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const json = (res: ServerResponse, code: number, value: unknown) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON required");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error("Body too large");
    chunks.push(chunk);
  }
  return parseStrictJson(Buffer.concat(chunks).toString("utf8"));
}

/** Loopback UI and a relay bridge. Neither decrypts chat or vault data. */
export async function createApp(options: AppOptions) {
  RelayUrl.parse(options.relayUrl);
  if (
    options.relayUrl.startsWith("ws:") &&
    !options.development &&
    !options.relayDevelopment
  )
    throw new Error("WSS required");
  const store = new Store(options.dataFile);
  let relay: WebSocket | undefined;
  const cookie = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  let dataEpoch = randomBytes(16).toString("hex");
  const hosts = new Set<string>();
  const origins = new Set<string>();
  let local: WebSocket | undefined;
  const localWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES + 4096,
    perMessageDeflate: false,
  });
  const emit = (event: ServerEvent) => {
    if (
      local?.readyState === WebSocket.OPEN &&
      local.bufferedAmount < 1_048_576
    )
      local.send(JSON.stringify(event));
  };
  const disconnectAll = () => {
    if (relay) {
      relay.close();
      emit({ type: "relay-close" });
    }
    relay = undefined;
  };
  const authorized = (req: IncomingMessage) =>
    (req.headers.cookie ?? "")
      .split(";")
      .some(
        (x) =>
          x.trim().startsWith("bc-session=") &&
          equal(x.trim().slice(11), cookie),
      );
  const validLoopback = (req: IncomingMessage) =>
    ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(
      req.socket.remoteAddress ?? "",
    ) &&
    hosts.has(req.headers.host ?? "") &&
    (!req.headers.origin || origins.has(req.headers.origin)) &&
    req.headers["sec-fetch-site"] !== "cross-site";
  let vite:
    | Awaited<ReturnType<(typeof import("vite"))["createServer"]>>
    | undefined;
  const root = resolve("dist/client");
  const ui = createServer(async (req, res) => {
    // Explicit Host + socket + Origin checks protect against DNS rebinding and cross-site requests.
    if (!validLoopback(req))
      return json(res, 403, { error: "Local origin required" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader(
      "Permissions-Policy",
      "microphone=(), geolocation=(), camera=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${schemaHash}'; style-src 'self'${options.development ? " 'unsafe-inline'" : ""}; img-src 'self' data: blob:; connect-src 'self' ${[...origins].map((x) => x.replace("http:", "ws:")).join(" ")}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return json(res, 400, { error: "Invalid request target" });
    }
    if (
      ["/api/bootstrap", "/api/status"].includes(pathname) &&
      req.method === "GET"
    ) {
      let hasVault: boolean;
      try {
        hasVault = Boolean(store.vault());
      } catch {
        return json(res, 503, {
          error:
            "Local encrypted storage is damaged. Stop the service and restore a protected backup.",
        });
      }
      if (pathname === "/api/status")
        return json(res, 200, {
          application: "Butter Chicken",
          uiPort: options.uiPort,
          hasVault,
          relayUrl: options.relayUrl,
        });
      res.setHeader(
        "Set-Cookie",
        `bc-session=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return json(res, 200, {
        csrf,
        dataEpoch,
        hasVault,
        relayUrl: options.relayUrl,
      });
    }
    if (pathname.startsWith("/api/")) {
      if (!authorized(req))
        return json(res, 401, { error: "Session required" });
      if (
        req.method !== "GET" &&
        !equal(String(req.headers["x-bc-csrf"] ?? ""), csrf)
      )
        return json(res, 403, { error: "CSRF check failed" });
      if (
        req.method !== "GET" &&
        !equal(String(req.headers["x-bc-data-epoch"] ?? ""), dataEpoch)
      )
        return json(res, 409, {
          error: "Local identity was reset. Reload the app.",
        });
      try {
        if (pathname === "/api/vault" && req.method === "GET")
          return json(res, 200, { vault: store.vault() });
        if (pathname === "/api/vault" && req.method === "POST") {
          const input = z
            .object({ vault: z.unknown(), create: z.boolean().optional() })
            .strict()
            .parse(await body(req));
          store.saveVault(input.vault, input.create);
          return json(res, 200, { ok: true });
        }
        if (pathname === "/api/history" && req.method === "GET")
          return json(res, 200, { messages: store.history() });
        if (pathname === "/api/history" && req.method === "DELETE") {
          store.clearHistory();
          return json(res, 200, { ok: true });
        }
        if (pathname === "/api/outgoing" && req.method === "POST") {
          store.putOutgoing(await body(req));
          return json(res, 200, { ok: true });
        }
        if (pathname === "/api/receive" && req.method === "POST")
          return json(res, 200, {
            inserted: store.receive(ArchiveSchema.parse(await body(req))),
          });
        if (pathname === "/api/receipt" && req.method === "POST") {
          const v = z
            .object({
              messageId: MessageId,
              state: z.enum(["SENT", "DELIVERED", "READ"]),
            })
            .strict()
            .parse(await body(req));
          store.receipt(v.messageId, v.state);
          return json(res, 200, { ok: true });
        }
        if (pathname === "/api/delivered" && req.method === "POST") {
          const input = z
            .object({ messageId: MessageId })
            .strict()
            .parse(await body(req));
          store.delivered(input.messageId);
          return json(res, 200, { ok: true });
        }
        if (pathname === "/api/reset" && req.method === "POST") {
          disconnectAll();
          store.reset();
          dataEpoch = randomBytes(16).toString("hex");
          return json(res, 200, { ok: true, dataEpoch });
        }
        return json(res, 404, { error: "Unknown endpoint" });
      } catch {
        return json(res, 400, {
          error: "Invalid request or storage operation failed",
        });
      }
    }
    if (!["GET", "HEAD"].includes(req.method ?? ""))
      return json(res, 405, { error: "Method not allowed" });
    const pagePath = normalizePath(pathname);
    if (
      pageMetadata[pagePath] ||
      !extname(pagePath) ||
      pagePath.endsWith(".html")
    ) {
      try {
        let html = await readFile(
          resolve(
            options.development ? "index.html" : "dist/client/index.html",
          ),
          "utf8",
        );
        if (vite) html = await vite.transformIndexHtml(pathname, html);
        html = pageHtml(html, pagePath, `http://${req.headers.host}`);
        res.writeHead(pageMetadata[pagePath] ? 200 : 404, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
        });
        return res.end(req.method === "HEAD" ? undefined : html);
      } catch {
        return json(res, 503, { error: "Run npm run build before npm start" });
      }
    }
    if (vite)
      return vite.middlewares(req, res, () =>
        json(res, 404, { error: "Not found" }),
      );
    try {
      let file = resolve(root, `.${decodeURIComponent(pathname)}`);
      if (!file.startsWith(root + sep) && file !== root)
        return json(res, 403, { error: "Invalid path" });
      try {
        if ((await stat(file)).isDirectory())
          return json(res, 404, { error: "Not found" });
      } catch {
        return json(res, 404, { error: "Not found" });
      }
      const data = await readFile(file);
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".wasm": "application/wasm",
        ".png": "image/png",
      };
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Cache-Control":
          extname(file) === ".html" ? "no-store" : "private, max-age=3600",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      json(res, 503, { error: "Run npm run build before npm start" });
    }
  });
  ui.maxConnections = 64;
  ui.maxHeadersCount = 32;
  ui.headersTimeout = 10_000;
  ui.requestTimeout = 15_000;
  ui.keepAliveTimeout = 5000;
  ui.setTimeout(15_000, (socket) => socket.destroy());
  const uiPort = await listen(ui, options.uiPort ?? 3000, "127.0.0.1");
  for (const host of [`localhost:${uiPort}`, `127.0.0.1:${uiPort}`]) {
    hosts.add(host);
    origins.add(`http://${host}`);
  }
  if (options.development) {
    const { createServer: createVite } = await import("vite");
    vite = await createVite({
      server: {
        middlewareMode: true,
        ws: { server: ui },
        host: "127.0.0.1",
        allowedHosts: ["localhost"],
      },
      appType: "spa",
    });
  }
  const openRelay = () => {
    if (!options.relayUrl || (relay && [0, 1].includes(relay.readyState)))
      return;
    const link = new WebSocket(options.relayUrl, {
      handshakeTimeout: 5000,
      maxPayload: MAX_FRAME_BYTES + 4096,
      perMessageDeflate: false,
      followRedirects: false,
    });
    relay = link;
    link.on("message", (raw, binary) => {
      try {
        if (binary || !local || local.bufferedAmount > 1_048_576)
          throw Error();
        const packet = parseStrictJson(raw.toString());
        emit({ type: "relay", packet });
      } catch {
        link.close(1008);
      }
    });
    link.on("close", () => {
      if (relay === link) {
        relay = undefined;
        emit({ type: "relay-close" });
      }
    });
    link.on("error", () => {});
  };
  localWss.on("connection", (ws) => {
    if (local?.readyState === WebSocket.OPEN) {
      ws.close(4009, "Already open in another tab");
      return;
    }
    local = ws;
    emit({ type: "relay-close" });
    ws.on("message", (raw) => {
      try {
        const command = LocalCommandSchema.parse(
          parseStrictJson(raw.toString()),
        );
        if (command.type === "relay-open") openRelay();
        else if (command.type === "relay-send") {
          const packet = RelayCommand.parse(command.packet);
          if (relay?.readyState === 1 && relay.bufferedAmount < 1_048_576)
            relay.send(JSON.stringify(packet));
        } else if (command.type === "disconnect-all") disconnectAll();
      } catch {
        emit({ type: "error", code: "INVALID_LOCAL_COMMAND" });
      }
    });
    ws.on("close", () => {
      if (local === ws) {
        local = undefined;
        disconnectAll();
      }
    });
    ws.on("error", () => {});
  });
  ui.on("upgrade", (req, socket, head) => {
    if (req.url !== "/local") {
      if (!options.development) socket.destroy();
      return;
    }
    if (!validLoopback(req) || !req.headers.origin || !authorized(req)) {
      socket.destroy();
      return;
    }
    localWss.handleUpgrade(req, socket, head, (ws) =>
      localWss.emit("connection", ws, req),
    );
  });
  return {
    uiPort,
    store,
    async close() {
      relay?.terminate();
      relay = undefined;
      local?.terminate();
      local = undefined;
      localWss.close();
      await vite?.close();
      await new Promise<void>((r) => ui.close(() => r()));
      store.close();
    },
  };
}
