import { createApp } from "../server/app.js";
// This child is used only by the local adversarial harness. No real vault or LAN devices.
const app = await createApp({
  dataFile: ":memory:",
  uiPort: 0,
  lanPort: 0,
  lanHost: "127.0.0.1",
  discovery: false,
});
process.send?.({ uiPort: app.uiPort, lanPort: app.endpoint.port });
process.on("message", async (message) => {
  if (message === "stop") {
    await app.close();
    process.exit(0);
  }
});
