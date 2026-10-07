import { createRelay } from "../relay/service.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { browserService } from "./browser-service.js";
import { applicationSchema, pageMetadata } from "../shared/pages.js";

// Disposable synthetic identities only. These tests never use the user's browser profile or data.
const temporary = await mkdtemp(join(tmpdir(), "butter-chicken-browser-"));
await mkdir("test-results", { recursive: true });
const relay = process.env.BC_TEST_RELAY
  ? await createRelay({
      port: 0,
      dataFile: join(temporary, "relay", "relay.sqlite"),
      development: true,
    })
  : undefined;
const relayOptions = relay
  ? { relayUrl: `ws://127.0.0.1:${relay.port}/relay`, relayDevelopment: true }
  : {};
const apps = [
  await browserService({
    dataFile: join(temporary, "a.sqlite"),
    uiPort: 0,
    lanPort: 0,
    lanHost: "127.0.0.1",
    discovery: false,
    ...relayOptions,
  }),
  await browserService({
    dataFile: join(temporary, "b.sqlite"),
    uiPort: 0,
    lanPort: 0,
    lanHost: "127.0.0.1",
    discovery: false,
    ...relayOptions,
  }),
];
const errors: string[] = [];
const wire: string[] = [];
const requests: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const check = (message: string) => process.stdout.write(`PASS ${message}\n`);
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
    page.on("request", (request) => {
      if (request.postData()) requests.push(request.postData()!);
      assert.ok(
        !request.url().includes("BC1."),
        "Invitation leaked into a URL",
      );
    });
    await page.goto(`http://127.0.0.1:${apps[i].uiPort}`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "Create identity", exact: true })
      .waitFor();
  }
  await a.screenshot({ path: "test-results/first-run-desktop.png" });
  check("First-run UI renders without a framework error");
  const passwords = [
    "browser test only five unrelated words",
    "different browser test only words",
  ];
  for (let i = 0; i < 2; i++) {
    const page = pages[i];
    await page
      .getByLabel("Your name", { exact: true })
      .fill(i ? "Sam" : "Alex");
    await page
      .getByLabel("Vault passphrase", { exact: true })
      .fill(passwords[i]);
    await page
      .getByLabel("Confirm passphrase", { exact: true })
      .fill(passwords[i]);
    await page
      .getByRole("button", { name: "Create identity", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Pair with your friend", exact: true })
      .waitFor();
  }
  check(
    "Browser generates identities and encrypts vaults in the Argon2 worker",
  );
  for (let sample = 0; sample < 5; sample++) {
    await a
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    const image = a.getByRole("img", {
      name: "One-time pairing invitation QR code",
    });
    await image.waitFor();
    const source = await image.getAttribute("src");
    const expected = await a
      .getByRole("textbox", { name: "Your invitation", exact: true })
      .inputValue();
    const qrPath = resolve("test-results/qr-test.png");
    await writeFile(qrPath, Buffer.from(source!.split(",")[1], "base64"));
    await b
      .getByRole("textbox", { name: "Friend’s invitation", exact: true })
      .fill("");
    await b.getByLabel("QR code image", { exact: true }).setInputFiles(qrPath);
    try {
      await b.waitForFunction(
        (expected) =>
          (
            document.querySelector(
              'textarea[placeholder^="Paste the complete"]',
            ) as HTMLTextAreaElement
          )?.value === expected,
        expected,
      );
    } catch (error) {
      await b.screenshot({ path: "test-results/qr-scan-failure.png" });
      process.stderr.write(
        JSON.stringify({
          sample,
          scannerErrors: await b.locator(".form-error").allTextContents(),
          browserErrors: errors,
        }) + "\n",
      );
      throw error;
    }
    if (sample < 4)
      await a
        .getByRole("button", { name: "Cancel invitation", exact: true })
        .click();
  }
  check("Five independently generated invitation QR images decode correctly");
  await b
    .getByRole("button", { name: "Connect to friend", exact: true })
    .click();
  for (const page of pages)
    await page
      .getByRole("checkbox", {
        name: "I compared this code with my friend and it matches.",
      })
      .waitFor();
  assert.equal(
    await a.locator(".security-code").innerText(),
    await b.locator(".security-code").innerText(),
  );
  assert.equal(
    await a
      .getByRole("button", { name: "I verified the code", exact: true })
      .isEnabled(),
    false,
  );
  await a.screenshot({ path: "test-results/pairing-verification.png" });
  await a.getByRole("checkbox").check();
  await a
    .getByRole("button", { name: "I verified the code", exact: true })
    .click();
  await a
    .getByRole("button", { name: "Waiting for your friend to verify" })
    .waitFor();
  await b.getByRole("checkbox").check();
  await b
    .getByRole("button", { name: "I verified the code", exact: true })
    .click();
  for (const page of pages)
    await page
      .getByRole("button", { name: "Connected securely", exact: true })
      .waitFor();
  for (const page of pages) {
    await page
      .getByRole("heading", {
        name: "You’re paired. Thank you for checking.",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("link", { name: "Start chatting", exact: true })
      .click();
  }
  check(
    "QR image scan, matching security code, two-sided trust confirmation and success page work",
  );
  const message = "Hey, it’s just us on the Wi-Fi";
  await a.getByRole("textbox", { name: "Message", exact: true }).fill(message);
  await a.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
  await b.getByText(message, { exact: true }).waitFor();
  await a
    .getByLabel(/Delivered to device|Read in active conversation/)
    .waitFor();
  await b
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("A little space. Just for us.");
  await b.getByRole("button", { name: "Send message", exact: true }).click();
  await a.getByText("A little space. Just for us.", { exact: true }).waitFor();
  await b.locator(".toast").waitFor({ state: "hidden" });
  await a.screenshot({ path: "test-results/chat-desktop.png" });
  await b.setViewportSize({ width: 390, height: 844 });
  await b.screenshot({ path: "test-results/chat-mobile.png" });
  assert.equal(
    await b.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await b
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await b.screenshot({ path: "test-results/chat-mobile-light.png" });
  for (const page of pages)
    await page.getByRole("button", { name: "Security", exact: true }).click();
  assert.equal(
    await a.locator(".security-code").innerText(),
    await b.locator(".security-code").innerText(),
  );
  await a.screenshot({ path: "test-results/security-desktop.png" });
  check(
    "Encrypted chat, delivery receipts, responsive themes and saved security code work",
  );
  assert.ok(!wire.join("").includes(message));
  assert.ok(!requests.join("").includes(message));
  assert.ok(!requests.join("").includes(passwords[0]));
  assert.ok(!(await readFile(apps[0].dataFile)).includes(Buffer.from(message)));
  check(
    "WebSockets, HTTP requests and SQLite do not contain message plaintext or vault passphrase",
  );
  if (relay) {
    assert.ok((await a.locator("body").innerText()).includes("INTERNET"));
    await b
      .getByRole("button", { name: "Lock this device", exact: true })
      .click();
    await b
      .getByRole("button", { name: "Unlock your space", exact: true })
      .waitFor();
    await a.getByRole("button", { name: "Chat", exact: true }).click();
    await a
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Browser offline internet message");
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await a.getByText("SENT", { exact: true }).last().waitFor();
    assert.ok(
      !JSON.stringify(relay.db.prepare("SELECT * FROM mail").all()).includes(
        "Browser offline internet message",
      ),
    );
    await b.getByLabel("Vault passphrase", { exact: true }).fill(passwords[1]);
    await b
      .getByRole("button", { name: "Unlock your space", exact: true })
      .click();
    await b.getByRole("button", { name: "Chat", exact: true }).click();
    await b
      .getByText("Browser offline internet message", { exact: true })
      .waitFor();
    check(
      "Internet indicator, offline send, temporary ciphertext mailbox and browser reconnect delivery work",
    );
  }
  // Harmless injection fixtures must render as text in the actual browser.
  await a.getByRole("button", { name: "Chat", exact: true }).click();
  await b.getByRole("button", { name: "Chat", exact: true }).click();
  const injection =
    '<img src=x onerror="window.__bcXss=1"><script>window.__bcXss=1</script> \'; DROP TABLE messages;-- $(printf harmless)';
  await a
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(injection);
  await a.getByRole("button", { name: "Send message", exact: true }).click();
  await b.getByText(injection, { exact: true }).waitFor();
  assert.equal(
    await b.evaluate(
      () => (window as typeof window & { __bcXss?: number }).__bcXss,
    ),
    undefined,
  );
  assert.equal(
    await b.locator(".message-bubble img,.message-bubble script").count(),
    0,
  );
  check(
    "HTML, JavaScript, SQL and shell-like message payloads render as inert text",
  );
  // Releasing a pending write after lock must not restore plaintext UI state.
  await a.getByRole("button", { name: "Chat", exact: true }).click();
  let release!: () => void;
  let outgoingStarted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    outgoingStarted = resolve;
  });
  await a.route("**/api/outgoing", async (route) => {
    outgoingStarted();
    await held;
    await route.continue();
  });
  await a
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("This pending message must stay hidden while locked");
  await a.getByRole("button", { name: "Send message", exact: true }).click();
  await started;
  await a
    .getByRole("button", { name: "Lock this device", exact: true })
    .click();
  release();
  await a
    .getByRole("button", { name: "Unlock your space", exact: true })
    .waitFor();
  assert.ok(
    !(await a.locator("body").innerText()).includes(
      "This pending message must stay hidden",
    ),
  );
  await a.unrouteAll({ behavior: "wait" });
  await a.getByLabel("Vault passphrase", { exact: true }).fill(passwords[0]);
  await a
    .getByRole("button", { name: "Unlock your space", exact: true })
    .click();
  await a
    .getByRole("button", { name: "Connected securely", exact: true })
    .waitFor();
  await b.getByRole("button", { name: "Chat", exact: true }).click();
  await b
    .getByText("This pending message must stay hidden while locked", {
      exact: true,
    })
    .waitFor();
  check(
    "Lock clears UI state; unlock restores pinned trust and retries the encrypted pending message",
  );
  await a.getByRole("button", { name: "Settings", exact: true }).click();
  await a.getByRole("button", { name: "Delete history", exact: true }).click();
  await a
    .getByRole("dialog")
    .getByRole("button", { name: "Delete history", exact: true })
    .click();
  await a.getByRole("button", { name: "Chat", exact: true }).click();
  await a.getByText("Your first hello starts here", { exact: true }).waitFor();
  check("History deletion preserves pairing");
  await a.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await a.getByRole("button", { name: "Security", exact: true }).click();
  assert.equal(
    await a.evaluate(() =>
      [...document.querySelectorAll(".sidebar,.main-panel")].some(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ),
    ),
    false,
  );
  await a.screenshot({ path: "test-results/security-text-200.png" });
  const guest = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guide = await guest.newPage();
  guide.setDefaultTimeout(20000);
  guide.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${apps[0].uiPort}`;
  let bootstrapRelease!: () => void;
  const bootstrapHeld = new Promise<void>((resolve) => {
    bootstrapRelease = resolve;
  });
  await guide.route("**/api/bootstrap", async (route) => {
    await bootstrapHeld;
    await route.continue();
  });
  await guide.goto(origin, { waitUntil: "domcontentloaded" });
  await guide
    .getByRole("status", { name: "Opening your local space" })
    .waitFor();
  await guide.screenshot({ path: "test-results/loading-skeleton-mobile.png" });
  bootstrapRelease();
  await guide.unrouteAll({ behavior: "wait" });
  await guide
    .getByRole("button", { name: "Unlock your space", exact: true })
    .waitFor();
  const cta = guide.locator(".mobile-cta");
  assert.equal(await cta.isVisible(), true);
  assert.ok((await cta.boundingBox())!.y < 844);
  await guide.screenshot({ path: "test-results/locked-mobile.png" });
  await guide.goto(origin + "/help/faq");
  assert.equal(await guide.locator(".faq-list details").count(), 5);
  await guide.locator(".faq-list summary").first().click();
  assert.ok(
    (
      await guide.getByRole("navigation", { name: "Breadcrumb" }).innerText()
    ).includes("Help"),
  );
  await guide.screenshot({ path: "test-results/faq-mobile.png" });
  await guide.getByRole("link", { name: "Privacy", exact: true }).click();
  await guide
    .getByRole("heading", { name: "Privacy policy", exact: true })
    .waitFor();
  await guide
    .getByRole("link", { name: "Read the terms of use", exact: true })
    .click();
  await guide
    .getByRole("heading", { name: "Terms of use", exact: true })
    .waitFor();
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const [path, meta] of Object.entries(pageMetadata)) {
    const response = await guest.request.get(origin + path);
    assert.equal(response.status(), 200);
    const html = await response.text();
    assert.ok(html.includes(`<title>${meta.title}</title>`));
    assert.ok(html.includes(meta.description));
    assert.ok(html.includes("noindex"));
    assert.ok(html.includes(applicationSchema));
    assert.ok(
      !response
        .headers()
        ["content-security-policy"].includes("'unsafe-inline'"),
    );
    titles.add(meta.title);
    descriptions.add(meta.description);
  }
  assert.equal(titles.size, Object.keys(pageMetadata).length);
  assert.equal(descriptions.size, Object.keys(pageMetadata).length);
  assert.ok(
    (await (await guest.request.get(origin + "/robots.txt")).text()).includes(
      "Disallow: /",
    ),
  );
  await guide.goto(origin + "/help/demo");
  await guide
    .getByRole("img", { name: /The running Butter Chicken chat/ })
    .waitFor();
  assert.equal(
    await guide
      .locator(".demo-image")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    true,
  );
  assert.equal(
    (await guest.request.get(origin + "/social-share.png")).status(),
    200,
  );
  const missing = await guide.goto(origin + "/missing-page");
  assert.equal(missing?.status(), 404);
  await guide
    .getByRole("heading", { name: "This page wandered off.", exact: true })
    .waitFor();
  await guide.screenshot({ path: "test-results/not-found-mobile.png" });
  await guide
    .locator(".recovery-card")
    .getByRole("link", { name: "getting-started guide" })
    .click();
  await guide
    .getByRole("heading", { name: "A good place to start.", exact: true })
    .waitFor();
  assert.equal(
    await guide.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  check(
    "Loading skeleton, sticky mobile CTA, five FAQs, policies, breadcrumbs, metadata, schema, demo image and real 404 work",
  );
  await guide.goto(origin + "/help/two-computers");
  assert.ok(
    (await guide.locator("body").innerText()).includes("npm install --global"),
  );
  assert.equal(
    await guide.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const nameApp = await browserService({
    dataFile: join(temporary, "name.sqlite"),
    uiPort: 0,
    lanPort: 0,
    lanHost: "127.0.0.1",
    discovery: false,
    ...relayOptions,
  });
  apps.push(nameApp);
  await guide.setViewportSize({ width: 1440, height: 950 });
  await guide.goto(`http://127.0.0.1:${nameApp.uiPort}`);
  const maliciousName = '<img src=x onerror="window.x=1">';
  await guide.getByLabel("Your name", { exact: true }).fill(maliciousName);
  await guide
    .getByLabel("Vault passphrase", { exact: true })
    .fill("display name test only secret words");
  await guide
    .getByLabel("Confirm passphrase", { exact: true })
    .fill("display name test only secret words");
  await guide
    .getByRole("button", { name: "Create identity", exact: true })
    .click();
  await guide.getByText(maliciousName, { exact: true }).first().waitFor();
  assert.equal(await guide.locator('img[src="x"]').count(), 0);
  assert.equal(
    await guide.evaluate(() => (window as typeof window & { x?: number }).x),
    undefined,
  );
  check(
    "Malicious display-name markup is rendered as text, with no injected image or event execution",
  );
  assert.deepEqual(errors, [], "Browser console/page errors");
  check("No browser errors; 200% text layout is usable");
  process.stdout.write(
    `Browser flow complete (${browser.version()}). Screenshots are in test-results/.\n`,
  );
} finally {
  await browser?.close();
  for (const app of apps) await app.close();
  await relay?.close();
  await rm(temporary, { recursive: true, force: true });
}
