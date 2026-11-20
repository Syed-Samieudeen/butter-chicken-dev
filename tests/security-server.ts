import { createApp } from "../server/app.js";
// This child is used only by the local adversarial harness. It uses an in-memory store and an unreachable test relay.
const app = await createApp({
  dataFile: ":memory:",
  uiPort: 0,
  relayUrl: "ws://127.0.0.1:9/relay",
  relayDevelopment: true,
});
process.send?.({ uiPort: app.uiPort });
process.on("message", async (message) => {
  if (message === "stop") {
    await app.close();
    process.exit(0);
  }
});
