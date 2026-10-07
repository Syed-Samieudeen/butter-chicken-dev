import { fork } from "node:child_process";
import { connect } from "node:net";
const child = fork("tests/security-server.ts", {
  execArgv: ["--import", "tsx"],
  stdio: ["ignore", "ignore", "pipe", "ipc"],
});
let output = "";
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const ports = await new Promise((resolve, reject) => {
  child.once("message", resolve);
  child.once("error", reject);
  child.once("exit", (code) => reject(new Error(`Child exited ${code}`)));
});
const response = await new Promise((resolve) => {
  const socket = connect({ host: "127.0.0.1", port: ports.uiPort }, () =>
    socket.end(
      `GET //[ HTTP/1.1\r\nHost: 127.0.0.1:${ports.uiPort}\r\nConnection: close\r\n\r\n`,
    ),
  );
  let result = "";
  socket.on("data", (chunk) => {
    result += chunk;
  });
  socket.once("close", () => resolve(result.split("\r\n")[0]));
  socket.once("error", () => resolve("connection reset"));
  socket.setTimeout(3000, () => socket.destroy());
});
await new Promise((resolve) => setTimeout(resolve, 100));
console.log(
  JSON.stringify({
    response,
    childAlive: child.exitCode === null && child.signalCode === null,
    diagnostic: output.includes("Invalid URL")
      ? "Invalid URL exception"
      : output
        ? "child diagnostic present"
        : "none",
  }),
);
if (child.exitCode === null) {
  child.send("stop");
  await new Promise((resolve) => child.once("exit", resolve));
}
