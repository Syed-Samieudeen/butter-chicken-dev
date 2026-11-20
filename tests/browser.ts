import { createRelay } from "../relay/service.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { browserService } from "./browser-service.js";
import { applicationSchema, pageMetadata } from "../shared/pages.js";

// Disposable synthetic identities only. These tests never use the user's browser profile or data.
const temporary = await mkdtemp(join(tmpdir(), "butter-chicken-browser-"));
await mkdir("test-results", { recursive: true });
const relay = await createRelay({
  port: 0,
  dataFile: join(temporary, "relay", "relay.sqlite"),
  development: true,
});
const relayOptions = {
  relayUrl: `ws://127.0.0.1:${relay.port}/relay`,
  relayDevelopment: true,
};
const apps = [
  await browserService({
    dataFile: join(temporary, "a.sqlite"),
    uiPort: 0,
    ...relayOptions,
  }),
  await browserService({
    dataFile: join(temporary, "b.sqlite"),
    uiPort: 0,
    ...relayOptions,
  }),
];
const errors: string[] = [];
const wire: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const check = (message: string) => process.stdout.write(`PASS ${message}\n`);
const code = (page: import("playwright").Page) =>
  page.getByLabel("Your 6-digit pairing code").innerText();
try {
  browser = await chromium.launch({
    ...(process.env.BC_TEST_BROWSER_PATH
      ? { executablePath: process.env.BC_TEST_BROWSER_PATH }
      : {}),
    ...(process.env.BC_TEST_BROWSER_ARGS
      ? { args: JSON.parse(process.env.BC_TEST_BROWSER_ARGS) as string[] }
      : {}),
  });
  const contexts = [
    await browser.newContext({ viewport: { width: 1440, height: 950 } }),
    await browser.newContext({ viewport: { width: 1440, height: 950 } }),
  ];
  const pages = [await contexts[0].newPage(), await contexts[1].newPage()];
  const [a, b] = pages;
  for (let i = 0; i < 2; i++) {
    const page = pages[i];
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("websocket", (socket) =>
      socket.on("framesent", (frame) => wire.push(String(frame.payload))),
    );
    page.on("request", (request) =>
      assert.ok(!request.url().includes("BC1."), "Pairing data leaked into a URL"),
    );
    await page.goto(`http://127.0.0.1:${apps[i].uiPort}`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "Create your identity", exact: true })
      .or(page.getByRole("button", { name: "Create identity", exact: true }))
      .first()
      .waitFor();
  }
  await a.screenshot({ path: "test-results/first-run-desktop.png" });
  const passwords = [
    "browser test only five unrelated words",
    "different browser test only words",
  ];
  for (let i = 0; i < 2; i++) {
    const page = pages[i];
    await page.getByLabel("Your name", { exact: true }).fill(i ? "Sam" : "Alex");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill(passwords[i]);
    await page
      .getByLabel("Confirm passphrase", { exact: true })
      .fill(passwords[i]);
    await page
      .getByRole("button", { name: "Create identity", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Connect with your friend", exact: true })
      .waitFor();
  }
  check("Both browsers create identities and reach the pairing screen");
  for (const page of pages)
    assert.equal(
      await page.getByText(/LAN|Wi-Fi|QR|Nearby devices/).count(),
      0,
      "Removed LAN/QR wording is still visible",
    );
  check("No LAN, Wi-Fi or QR pairing wording remains on the pairing screen");

  await a.getByRole("button", { name: "Create a code", exact: true }).click();
  const pairingCode = await code(a);
  assert.match(pairingCode.replace(/\s/g, ""), /^\d{6}$/);
  await b.getByLabel("Friend’s 6-digit code", { exact: true }).fill(pairingCode.replace(/\s/g, ""));
  await b.getByRole("button", { name: "Connect", exact: true }).click();
  for (const page of pages)
    await page
      .getByRole("checkbox", { name: "The code matches what my friend sees." })
      .waitFor();
  assert.equal(
    await a.locator(".security-code").innerText(),
    await b.locator(".security-code").innerText(),
  );
  check("Six-digit code connects both devices and shows identical security codes");
  for (const page of pages) {
    await page
      .getByRole("checkbox", { name: "The code matches what my friend sees." })
      .check();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
  }
  await a.getByRole("heading", { name: "Trust saved on this device" }).waitFor();
  await b.getByRole("heading", { name: "Trust saved on this device" }).waitFor();
  check("Both people confirm the security code and save trust");

  for (const page of pages)
    await page.getByRole("button", { name: "Chat", exact: true }).click();
  await a.getByLabel("Message", { exact: true }).fill("Hello from Alex");
  await a.getByRole("button", { name: "Send message", exact: true }).click();
  await b.getByText("Hello from Alex").first().waitFor();
  await b.getByLabel("Message", { exact: true }).fill("Hello back from Sam");
  await b.getByRole("button", { name: "Send message", exact: true }).click();
  try {
    await a.getByText("Hello back from Sam").first().waitFor();
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        alexNotices: await a.locator(".notice, .form-error").allTextContents(),
        samNotices: await b.locator(".notice, .form-error").allTextContents(),
        samStatuses: await b.locator(".message-meta span").allTextContents(),
        alexStatuses: await a.locator(".message-meta span").allTextContents(),
        errors,
      }) + "\n",
    );
    throw error;
  }
  check("Messages are delivered through the relay in both directions");

  const lockButton = a.getByRole("button", { name: "Lock screen", exact: true });
  await lockButton.click();
  await a.getByRole("heading", { name: "Screen locked", exact: true }).waitFor();
  assert.equal(await a.getByText("Hello from Alex").count(), 0, "Messages visible while locked");
  await a.getByLabel("Passphrase", { exact: true }).fill("not the right passphrase");
  await a.getByRole("button", { name: "Unlock", exact: true }).click();
  await a.getByText("That passphrase is not correct.").waitFor();
  await a.getByLabel("Passphrase", { exact: true }).fill(passwords[0]);
  await a.getByRole("button", { name: "Unlock", exact: true }).click();
  try {
    await a.getByText("Hello back from Sam").first().waitFor();
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        afterUnlockBubbles: await a.locator(".message-bubble p").allTextContents(),
        alexNotices: await a.locator(".notice, .form-error").allTextContents(),
        lockVisible: await a.locator(".lock-overlay").count(),
        errors,
      }) + "\n",
    );
    throw error;
  }
  check("Screen lock hides messages, rejects a wrong passphrase, and unlocks with the right one");

  assert.ok(!wire.join("\n").includes("Hello from Alex"), "Plaintext crossed the WebSocket");
  assert.ok(!errors.some((e) => /Uncaught|TypeError/.test(e)), errors.join("\n"));
  assert.equal(pageMetadata["/"].title.includes("Butter Chicken"), true);
  assert.ok(applicationSchema.includes("Butter Chicken"));
  check("No plaintext on the wire and no uncaught page errors");
} finally {
  await browser?.close();
  for (const app of apps) await app.close();
  await relay.close();
  await rm(temporary, { recursive: true, force: true });
}
