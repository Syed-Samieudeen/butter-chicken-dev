import { DEFAULT_RELAY_URL, RelayUrl } from "../shared/relay.js";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export const CLOUDFLARE_RELAY_HOST = "butterchickenworker.bakri-downtime-sub.workers.dev";

export function defaultDataDirectory(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string {
  if (platform === "win32")
    return join(
      env.LOCALAPPDATA || join(userHome, "AppData", "Local"),
      "ButterChicken",
    );
  if (platform === "darwin")
    return join(userHome, "Library", "Application Support", "ButterChicken");
  return join(
    env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : join(userHome, ".local", "share"),
    "butter-chicken",
  );
}
const port = (value: string | undefined, fallback: number) => {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535)
    throw new Error("Invalid port configuration");
  return number;
};
export function relayFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  if (env.BC_RELAY_URL) return env.BC_RELAY_URL.trim();
  const shortcut = env.BC_CLOUDFLARE_RELAY?.trim();
  if (!shortcut) return undefined;
  if (["1", "true", "cloudflare"].includes(shortcut.toLowerCase()))
    return DEFAULT_RELAY_URL;
  if (/^wss?:\/\//i.test(shortcut)) return shortcut;
  const host = shortcut.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `wss://${host}${host.endsWith("/relay") ? "" : "/relay"}`;
}
export function loadConfiguration(
  projectRoot: string,
  development = false,
  input: NodeJS.ProcessEnv = process.env,
) {
  const env = { ...input };
  const initialData =
    env.BC_DATA_DIR || defaultDataDirectory(process.platform, env);
  if (!isAbsolute(initialData))
    throw new Error("BC_DATA_DIR must be an absolute private directory");
  const configFile =
    env.BC_CONFIG_FILE ||
    (development ? join(projectRoot, ".env") : join(initialData, "config.env"));
  if (!isAbsolute(configFile))
    throw new Error("BC_CONFIG_FILE must be an absolute path");
  if (existsSync(configFile)) {
    const values = parseEnv(readFileSync(configFile, "utf8"));
    for (const key of [
      "BC_UI_PORT",
      "BC_DATA_DIR",
      "BC_RELAY_URL",
      "BC_CLOUDFLARE_RELAY",
    ])
      if (env[key] === undefined && values[key] !== undefined)
        env[key] = values[key];
  }
  const dataDirectory = env.BC_DATA_DIR || initialData;
  if (!isAbsolute(dataDirectory))
    throw new Error("BC_DATA_DIR must be an absolute private directory");
  const relayText = relayFromEnv(env) ?? DEFAULT_RELAY_URL;
  const relayUrl = RelayUrl.parse(relayText);
  if (relayUrl.startsWith("ws:") && !development)
    throw new Error("Production relay requires WSS");
  return {
    relayUrl,
    uiPort: port(env.BC_UI_PORT, 3000),
    dataDirectory: resolve(dataDirectory),
    dataFile: join(dataDirectory, "butter-chicken.sqlite"),
    configFile,
  };
}
