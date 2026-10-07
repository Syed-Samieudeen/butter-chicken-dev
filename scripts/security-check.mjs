import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Project-only checks. No port scan, public probes or user-data access.
const failures = [];
const sourceFiles = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(?:tsx?|js|mjs|html|css|json)$/.test(entry.name))
      sourceFiles.push(path);
  }
}
for (const directory of [
  "client",
  "server",
  "relay",
  "shared",
  "scripts",
  "bin",
  "public",
  "dist",
])
  await walk(directory);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/,
];
for (const path of sourceFiles) {
  const text = await readFile(path, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(text)))
    failures.push(`Potential credential in ${path}`);
  if (
    /^(?:client|server|shared|relay)\//.test(path) &&
    /\b(?:eval|execSync|execFileSync)\s*\(|dangerouslySetInnerHTML|Access-Control-Allow-Origin/.test(
      text,
    )
  )
    failures.push(`Review dangerous sink or CORS change in ${path}`);
}
const vite = await readFile("vite.config.ts", "utf8");
if (/sourcemap\s*:\s*true|host\s*:\s*true/.test(vite))
  failures.push("Review exposed development host or production source maps");
const lock = JSON.parse(await readFile("npm-shrinkwrap.json", "utf8"));
const scripts = [];
for (const [path, dependency] of Object.entries(lock.packages)) {
  if (!path) continue;
  if (
    !dependency.integrity ||
    !dependency.resolved?.startsWith("https://registry.npmjs.org/")
  )
    failures.push(`Unpinned or unexpected dependency origin: ${path}`);
  if (dependency.hasInstallScript)
    scripts.push({ path, version: dependency.version });
}
const production = JSON.parse(await readFile("package.json", "utf8"));
for (const [name, version] of Object.entries({
  ...production.dependencies,
  ...production.devDependencies,
}))
  if (!/^\d+\.\d+\.\d+$/.test(version))
    failures.push(`Direct dependency is not exact: ${name}`);
console.log(
  JSON.stringify(
    {
      scannedProjectFiles: sourceFiles.length,
      heuristicScanFailures: failures,
      installScriptPackages: scripts,
    },
    null,
    2,
  ),
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const args of [
  ["audit", "--json"],
  ["outdated", "--json"],
]) {
  const result = spawnSync(npm, args, {
    encoding: "utf8",
    timeout: 60000,
    shell: process.platform === "win32",
  });
  if (result.error) {
    failures.push(`Could not run npm ${args[0]}: ${result.error.message}`);
    continue;
  }
  try {
    const report = JSON.parse(result.stdout);
    if (args[0] === "audit") {
      console.log(
        JSON.stringify(
          { dependencyVulnerabilities: report.metadata?.vulnerabilities },
          null,
          2,
        ),
      );
      if (!report.metadata || report.metadata.vulnerabilities.total > 0)
        failures.push(
          "Dependency audit failed or reported an advisory; evaluate and fix before release",
        );
    } else
      console.log(
        JSON.stringify(
          {
            outdatedDirectDependencies: Object.fromEntries(
              Object.entries(report).map(([name, item]) => [
                name,
                { current: item.current, latest: item.latest },
              ]),
            ),
          },
          null,
          2,
        ),
      );
  } catch {
    failures.push(`npm ${args[0]} did not return a usable report`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "PASS project configuration, heuristic secret/sink scan and known dependency advisory checks. Run npm run check and npm run test:browser for behavioral verification.",
  );
