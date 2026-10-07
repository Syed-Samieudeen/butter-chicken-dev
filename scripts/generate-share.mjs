import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

// Rasterize the editable, project-owned SVG artwork. No network or external fonts.
const browser = await chromium.launch({
  ...(process.env.BC_TEST_BROWSER_PATH
    ? { executablePath: process.env.BC_TEST_BROWSER_PATH }
    : {}),
  ...(process.env.BC_TEST_BROWSER_ARGS
    ? { args: JSON.parse(process.env.BC_TEST_BROWSER_ARGS) }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
  });
  await page.setContent(
    `<style>body{margin:0}</style>${await readFile("public/social-share.svg", "utf8")}`,
  );
  await page.screenshot({ path: "public/social-share.png" });
} finally {
  await browser.close();
}
