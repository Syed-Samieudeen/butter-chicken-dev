import { resolve } from "node:path";
import { createApp } from "./app.js";
import { loadConfiguration } from "./config.js";
try {
  const development = process.argv.includes("--dev");
  const config = loadConfiguration(resolve("."), development);
  const app = await createApp({ ...config, development });
  console.log(
    `Butter Chicken\nLocal UI: http://localhost:${app.uiPort}\nInternet relay: ${config.relayUrl}\nData directory: ${config.dataDirectory}\nConfig file: ${config.configFile}\n\nOpen the local UI in your browser and keep this tab open. Pair with the 6-digit code.\nStop with Ctrl+C.`,
  );
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  console.error(
    "Unable to start Butter Chicken. Check the port, configuration and private data-directory permissions. If it is already running, open its existing localhost UI.",
  );
  process.exit(1);
}
