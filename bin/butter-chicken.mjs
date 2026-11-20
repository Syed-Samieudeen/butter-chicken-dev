#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const command = process.argv[2] || "start";
if (["--version", "-v", "version"].includes(command)) {
  console.log(`Butter Chicken ${manifest.version}`);
} else if (["--help", "-h", "help"].includes(command)) {
  console.log(
    `Butter Chicken ${manifest.version}\n\nUsage: butter-chicken [start|status|--version|--help]\n\nstart       Run the local UI and relay connection in this terminal (default).\nstatus      Check whether the local service is running.\n--version   Show this installed package version.\n--help      Show these commands.\n\nOpen the displayed localhost URL and keep this terminal open. Stop with Ctrl+C.\nData is stored in your OS user-data directory, outside the installation.\nThe Cloudflare relay is preconfigured; no config file is needed for internet chat.\nOverride with BC_DATA_DIR (absolute), BC_CONFIG_FILE, BC_UI_PORT, BC_RELAY_URL or BC_CLOUDFLARE_RELAY.`,
  );
} else if (!["start", "status"].includes(command) || process.argv.length > 3) {
  console.error("Unknown command. Run butter-chicken --help.");
  process.exitCode = 1;
} else if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error("Butter Chicken requires Node.js 24.x.");
  process.exitCode = 1;
} else {
  try {
    const { loadConfiguration } = await import("../dist/server/config.js");
    const config = loadConfiguration(root);
    if (command === "status") {
      try {
        const response = await fetch(
          `http://127.0.0.1:${config.uiPort}/api/status`,
          { signal: AbortSignal.timeout(2000) },
        );
        const status = await response.json();
        if (!response.ok || status.application !== "Butter Chicken")
          throw new Error("Unavailable");
        console.log(
          `Butter Chicken: running\nLocal UI: http://localhost:${status.uiPort}\nRelay: ${status.relayUrl}\nVault: ${status.hasVault ? "present; unlock in the UI" : "not created yet"}\nData directory: ${config.dataDirectory}`,
        );
      } catch {
        console.log(
          `Butter Chicken: not running or unavailable at http://localhost:${config.uiPort}`,
        );
        process.exitCode = 1;
      }
    } else {
      process.chdir(root);
      await import("../dist/server/index.js");
    }
  } catch {
    console.error(
      "Unable to load Butter Chicken. Check Node 24, the installed production build, configuration and private data-directory permissions.",
    );
    process.exitCode = 1;
  }
}
