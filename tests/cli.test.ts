import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { defaultDataDirectory, loadConfiguration } from "../server/config.js";
const free = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
};

test("persistent data paths do not depend on installation or current working directory", () => {
  const userHome = join(tmpdir(), "synthetic-user");
  assert.equal(
    defaultDataDirectory("linux", {}, userHome),
    join(userHome, ".local", "share", "butter-chicken"),
  );
  assert.equal(
    defaultDataDirectory(
      "linux",
      { XDG_DATA_HOME: join(tmpdir(), "synthetic-xdg") },
      userHome,
    ),
    join(tmpdir(), "synthetic-xdg", "butter-chicken"),
  );
  assert.equal(
    defaultDataDirectory(
      "linux",
      { XDG_DATA_HOME: "relative-is-not-trusted" },
      userHome,
    ),
    join(userHome, ".local", "share", "butter-chicken"),
  );
  assert.equal(
    defaultDataDirectory("darwin", {}, userHome),
    join(userHome, "Library", "Application Support", "ButterChicken"),
  );
  assert.equal(
    defaultDataDirectory("win32", {}, userHome),
    join(userHome, "AppData", "Local", "ButterChicken"),
  );
});

test("configuration is bounded to known fields, keeps environment precedence and rejects invalid ports/paths/public binds", async () => {
  const folder = await mkdtemp(join(tmpdir(), "bc-config-"));
  try {
    await writeFile(
      join(folder, "config.env"),
      "BC_UI_PORT=3100\nBC_LAN_PORT=4555\nBC_DISCOVERY=false\nBC_RELAY_URL=wss://relay.example.com/relay\nUNRELATED=ignored\n",
      { mode: 0o600 },
    );
    const config = loadConfiguration(resolve("."), false, {
      BC_DATA_DIR: folder,
      BC_UI_PORT: "3200",
      BC_LAN_HOST: "127.0.0.1",
    });
    assert.equal(config.uiPort, 3200);
    assert.equal(config.lanPort, 4555);
    assert.equal(config.discovery, false);
    assert.equal(config.relayUrl, "wss://relay.example.com/relay");
    assert.equal(config.dataFile, join(folder, "butter-chicken.sqlite"));
    assert.equal(process.env.UNRELATED, undefined);
    await writeFile(join(folder, ".env"), "BC_UI_PORT=3999\n", { mode: 0o600 });
    assert.equal(
      loadConfiguration(folder, false, {
        BC_DATA_DIR: join(folder, "other"),
        BC_LAN_HOST: "127.0.0.1",
      }).uiPort,
      3000,
      "Global configuration read an unrelated project .env",
    );
    assert.equal(
      loadConfiguration(folder, true, {
        BC_DATA_DIR: join(folder, "other"),
        BC_LAN_HOST: "127.0.0.1",
      }).uiPort,
      3999,
    );

    for (const extra of [
      { BC_UI_PORT: "0" },
      { BC_LAN_PORT: "65536" },
      { BC_DATA_DIR: "relative" },
      { BC_CONFIG_FILE: "relative.env" },
      { BC_LAN_HOST: "8.8.8.8" },
      { BC_DISCOVERY: "maybe" },
      { BC_RELAY_URL: "ws://127.0.0.1:8787/relay" },
      { BC_RELAY_URL: "ws://public.example.com/relay" },
      { BC_RELAY_URL: "wss://user:secret@relay.example.com/relay" },
    ])
      assert.throws(() =>
        loadConfiguration(resolve("."), false, {
          BC_DATA_DIR: folder,
          ...extra,
        }),
      );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("CLI help/version work from another directory; unknown commands fail safely", async () => {
  const folder = await mkdtemp(join(tmpdir(), "bc-launch-help-"));
  const cli = resolve("bin/butter-chicken.mjs");
  try {
    const version = spawnSync(process.execPath, [cli, "--version"], {
      cwd: folder,
      encoding: "utf8",
    });
    assert.equal(version.status, 0);
    assert.match(version.stdout, /Butter Chicken 1\.0\.0/);
    const help = spawnSync(process.execPath, [cli, "--help"], {
      cwd: folder,
      encoding: "utf8",
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Ctrl\+C/);
    const unknown = spawnSync(process.execPath, [cli, "stop"], {
      cwd: folder,
      encoding: "utf8",
    });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown command/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test(
  "production CLI launches UI/LAN from any directory and status is metadata-only",
  { timeout: 10000 },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "bc-cli-"));
    const cli = resolve("bin/butter-chicken.mjs");
    const uiPort = await free(),
      lanPort = await free();
    const env = {
      ...process.env,
      BC_DATA_DIR: join(folder, "data"),
      BC_UI_PORT: String(uiPort),
      BC_LAN_PORT: String(lanPort),
      BC_LAN_HOST: "127.0.0.1",
      BC_DISCOVERY: "false",
      BC_CONFIG_FILE: join(folder, "missing.env"),
    };
    const child = spawn(process.execPath, [cli], {
      cwd: folder,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout!.on("data", (raw) => (output += raw.toString()));
    try {
      const deadline = Date.now() + 5000;
      while (!output.includes("Local UI:")) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error("CLI failed to start");
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.match(output, new RegExp(`localhost:${uiPort}`));
      assert.equal((await fetch(`http://127.0.0.1:${uiPort}/`)).status, 200);
      const response = await fetch(`http://127.0.0.1:${uiPort}/api/status`);
      const info = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(info).sort(), [
        "application",
        "endpoint",
        "hasVault",
        "uiPort",
      ]);
      assert.equal(info.hasVault, false);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(
        (
          await fetch(`http://127.0.0.1:${uiPort}/api/status`, {
            headers: { Origin: "https://evil.invalid" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await fetch(`http://127.0.0.1:${lanPort}/api/status`)).status,
        404,
      );
      const status = await new Promise<{ code: number | null; output: string }>(
        (resolve) => {
          const process = spawn(globalThis.process.execPath, [cli, "status"], {
            cwd: folder,
            env,
          });
          let output = "";
          process.stdout.on("data", (raw) => (output += raw.toString()));
          process.once("exit", (code) => resolve({ code, output }));
        },
      );
      assert.equal(status.code, 0);
      assert.match(status.output, /running/);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await rm(folder, { recursive: true, force: true });
    }
  },
);
