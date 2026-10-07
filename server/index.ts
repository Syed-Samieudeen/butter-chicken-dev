import { resolve } from "node:path";
import { createApp } from "./app.js";
import { loadConfiguration } from "./config.js";
try {
  const development = process.argv.includes("--dev");
  const config = loadConfiguration(resolve("."), development);
  const app = await createApp({ ...config, development });
  console.log(
    `Butter Chicken\nLocal server: running\nLAN service: running\nEncrypted database: ready\n\nLocal UI: http://localhost:${app.uiPort}\nLAN transport: ${app.endpoint.host}:${app.endpoint.port}\nData directory: ${config.dataDirectory}\nConfig file: ${config.configFile}\n\nCreate or unlock your identity in the browser. Internet is not required for chat.\nKeep both apps unlocked to receive. Configure BC_RELAY_URL on both computers for internet chat. Stop with Ctrl+C.`,
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
    "Unable to start Butter Chicken. Check ports, LAN binding, configuration and private data-directory permissions. If it is already running, open its existing localhost UI.",
  );
  process.exit(1);
}
