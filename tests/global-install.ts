import assert from "node:assert/strict";
import { mkdtemp, rm, access, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { ClientApi } from "../client/api.js";
import {
  createVault,
  createIdentity,
  sealVault,
  archiveMessage,
  unlockVault,
  openArchive,
  wipe,
  cryptoReady,
} from "../client/crypto.js";

// A private npm prefix and synthetic data only. Never touches user-global packages or a real vault.
const root = await mkdtemp(join(tmpdir(), "bc-global-install-"));
const prefix = join(root, "prefix");
const data = join(root, "private-data");
const unrelated = join(root, "unrelated");
await mkdir(unrelated);
const bundle = resolve("butter-chicken-1.0.0.tgz");
await access(bundle);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = async (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {},
) => {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk) => (stdout += chunk.toString()));
  child.stderr!.on("data", (chunk) => (stderr += chunk.toString()));
  const timer = setTimeout(() => child.kill("SIGTERM"), 90000);
  try {
    const [code] = await once(child, "exit");
    if (code !== 0)
      throw new Error(
        `Isolated ${command} failed (exit ${code}). ${stderr.slice(-400)}`,
      );
    return stdout;
  } finally {
    clearTimeout(timer);
  }
};
const install = () =>
  run(
    npm,
    [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--no-audit",
      "--no-fund",
      bundle,
    ],
    { cwd: unrelated, shell: process.platform === "win32" },
  );
const installed =
  process.platform === "win32"
    ? join(prefix, "node_modules", "butter-chicken")
    : join(prefix, "lib", "node_modules", "butter-chicken");
const cli = join(installed, "bin", "butter-chicken.mjs");
const shim =
  process.platform === "win32"
    ? join(prefix, "butter-chicken.cmd")
    : join(prefix, "bin", "butter-chicken");
const free = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
};
const uiPort = await free();
const env = {
  ...process.env,
  BC_DATA_DIR: data,
  BC_UI_PORT: String(uiPort),
  BC_RELAY_URL: "wss://relay.example.test/relay",
  BC_CONFIG_FILE: join(data, "config.env"),
};
let server: ChildProcess | undefined;
const start = async () => {
  server = spawn(process.execPath, [cli], {
    cwd: unrelated,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let stderr = "";
  server.stdout!.on("data", (chunk) => (output += chunk.toString()));
  server.stderr!.on("data", (chunk) => (stderr += chunk.toString()));
  const deadline = Date.now() + 8000;
  while (!output.includes("Local UI:")) {
    if (server.exitCode !== null || Date.now() > deadline)
      throw new Error(`Installed global launcher failed: ${stderr.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.ok(output.includes(`http://localhost:${uiPort}`));
};
const stop = async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  server = undefined;
};
let live: Awaited<ReturnType<typeof unlockVault>> | undefined;
try {
  await install();
  assert.match(
    await run(shim, ["--version"], {
      cwd: unrelated,
      shell: process.platform === "win32",
    }),
    /Butter Chicken 1\.0\.0/,
  );
  await access(join(installed, "npm-shrinkwrap.json"));
  const shrinkwrap = JSON.parse(
    await readFile(join(installed, "npm-shrinkwrap.json"), "utf8"),
  );
  for (const name of ["ws", "zod"]) {
    const installedVersion = JSON.parse(
      await readFile(
        join(installed, "node_modules", name, "package.json"),
        "utf8",
      ),
    ).version;
    assert.equal(
      installedVersion,
      shrinkwrap.packages["node_modules/" + name].version,
    );
  }
  console.log(
    "PASS clean global npm installation, actual command shim, packaged dependency lock and launch from unrelated directory",
  );
  await start();
  assert.equal((await fetch(`http://127.0.0.1:${uiPort}/`)).status, 200);
  assert.match(
    await run(process.execPath, [cli, "status"], { cwd: unrelated, env }),
    /running/,
  );
  await cryptoReady;
  const password = "global reinstall test synthetic private words";
  const created = await createVault("Synthetic install fixture", password);
  live = created.unlocked;
  const peer = createIdentity("Synthetic pinned peer");
  const now = new Date().toISOString();
  live.friends = [{
    public: peer.public,
    displayName: peer.displayName,
    trustedSince: now,
    verifiedAt: now,
    lastSeen: now,
  }];
  const originalId = live.identity.public.id;
  const text = "Encrypted history must survive package reinstall";
  const api = new ClientApi(`http://127.0.0.1:${uiPort}`);
  await api.bootstrap();
  await api.saveVault(sealVault(live), true);
  await api.outgoing(
    archiveMessage(
      live.identity,
      peer.public.id,
      {
        id: "cd".repeat(16),
        peerId: peer.public.id,
        from: "me",
        text,
        sentAt: now,
      },
      false,
    ),
  );
  peer.boxSecret.fill(0);
  peer.signSecret.fill(0);
  await stop();
  wipe(live);
  live = undefined;
  await install();
  await start();
  const reopened = new ClientApi(`http://127.0.0.1:${uiPort}`);
  await reopened.bootstrap();
  live = await unlockVault(await reopened.vault(), password);
  assert.equal(live.identity.public.id, originalId);
  assert.equal(live.friends[0]!.public.id, peer.public.id);
  assert.equal(
    openArchive(live.identity, (await reopened.history())[0]).text,
    text,
  );
  console.log(
    "PASS global reinstall preserves original encrypted identity, pinned friend and encrypted history",
  );
  await stop();
  await run(
    npm,
    [
      "uninstall",
      "--global",
      "--prefix",
      prefix,
      "--no-audit",
      "--no-fund",
      "butter-chicken",
    ],
    { cwd: unrelated, shell: process.platform === "win32" },
  );
  await access(join(data, "butter-chicken.sqlite"));
  await assert.rejects(access(cli));
  console.log(
    "PASS global uninstall removes the command/package and retains the separate user-data database",
  );
} finally {
  if (live) wipe(live);
  await stop();
  await rm(root, { recursive: true, force: true });
}
