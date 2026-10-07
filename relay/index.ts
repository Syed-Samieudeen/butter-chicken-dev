import { createRelay } from "./service.js";
const development = process.argv.includes("--dev");
const app = await createRelay({
  port: Number(process.env.RELAY_PORT ?? 8787),
  host: process.env.RELAY_HOST ?? "127.0.0.1",
  publicUrl: process.env.RELAY_PUBLIC_URL,
  dataFile: process.env.RELAY_DATA_FILE ?? "/data/relay.sqlite",
  development,
  log: (record) => console.log(JSON.stringify(record)),
});
console.log(JSON.stringify({ event: "started", port: app.port, development }));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
