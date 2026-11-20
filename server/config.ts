import { RelayUrl } from "../shared/relay.js";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { chooseBind } from "./discovery.js";

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
      "BC_LAN_PORT",
      "BC_LAN_HOST",
      "BC_DISCOVERY",
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
  if (env.BC_DISCOVERY && !["true", "false"].includes(env.BC_DISCOVERY))
    throw new Error("BC_DISCOVERY must be true or false");
  const lanHost = env.BC_LAN_HOST || "auto";
  chooseBind(lanHost); // Reject invalid/public host configuration before starting listeners.
  let relaySource = env.BC_RELAY_URL;
  if (!relaySource && env.BC_CLOUDFLARE_RELAY) {
    const value = env.BC_CLOUDFLARE_RELAY.trim();
    if (value === "1" || value.toLowerCase() === "true") {
      relaySource =
        "wss://butterchickenworker.bakri-downtime-sub.workers.dev/relay";
    } else if (/^wss?:\/\//i.test(value)) {
      relaySource = value;
    } else {
      const host = value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      relaySource = `wss://${host}${host.endsWith("/relay") ? "" : "/relay"}`;
    }
  }
  const relayUrl = relaySource ? RelayUrl.parse(relaySource) : undefined;
  if (relayUrl?.startsWith("ws:") && !development)
    throw new Error("Production relay requires WSS");
  return {
    relayUrl,
    uiPort: port(env.BC_UI_PORT, 3000),
    lanPort: port(env.BC_LAN_PORT, 4455),
    lanHost,
    discovery: env.BC_DISCOVERY !== "false",
    dataDirectory: resolve(dataDirectory),
    dataFile: join(dataDirectory, "butter-chicken.sqlite"),
    configFile,
  };
}
