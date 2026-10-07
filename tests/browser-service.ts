import { createApp, type AppOptions } from "../server/app.js";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { basename, dirname, join } from "node:path";
const free = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
};
export async function browserService(options: AppOptions) {
  if (!process.env.BC_TEST_GLOBAL_CLI) {
    const app = await createApp(options);
    return { ...app, dataFile: options.dataFile };
  }
  const uiPort = await free(),
    port = await free();
  const dataDirectory = join(
    dirname(options.dataFile),
    basename(options.dataFile, ".sqlite"),
  );
  const child = spawn(process.execPath, [process.env.BC_TEST_GLOBAL_CLI], {
    cwd: dirname(options.dataFile),
    env: {
      ...process.env,
      BC_UI_PORT: String(uiPort),
      BC_LAN_PORT: String(port),
      BC_LAN_HOST: "127.0.0.1",
      BC_DISCOVERY: "false",
      BC_DATA_DIR: dataDirectory,
      BC_CONFIG_FILE: join(dataDirectory, "config.env"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout!.on("data", (value) => {
    output = (output + value.toString()).slice(-65536);
  });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  };
  try {
    const deadline = Date.now() + 8000;
    while (!output.includes("Local UI:")) {
      if (
        child.exitCode !== null ||
        child.signalCode !== null ||
        Date.now() > deadline
      )
        throw new Error("Installed global CLI failed to start");
      await new Promise((r) => setTimeout(r, 15));
    }
    return {
      uiPort,
      endpoint: { host: "127.0.0.1", port },
      dataFile: join(dataDirectory, "butter-chicken.sqlite"),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
