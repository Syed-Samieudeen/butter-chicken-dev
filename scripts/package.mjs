import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

// ZIP is a packaging format, not a security mechanism. The explicit allowlist prevents data leaks.
const root = resolve(".");
const name = "butter-chicken";
const allowed = [
  "bin",
  "butter-chicken-1.0.0.tgz",
  "client",
  "server",
  "relay",
  "shared",
  "tests",
  "docs",
  "scripts",
  "public",
  "dist",
  "cloudflare",
  "README.md",
  "SECURITY.md",
  "THREAT_MODEL.md",
  "PRIVACY.md",
  "SECURITY_AUDIT.md",
  "TROUBLESHOOTING.md",
  "package.json",
  "npm-shrinkwrap.json",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.server.json",
  ".env.example",
  ".gitignore",
  ".dockerignore",
];
const table = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const files = [];
async function collect(path) {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (
        ["node_modules", ".git", "test-results", ".cache", ".wrangler"].includes(
          entry.name,
        ) ||
        (entry.name.startsWith(".env") && entry.name !== ".env.example") ||
        /\.(sqlite|db)(?:[-.].*)?$|\.(pem|key|p12|pfx|log)$/i.test(
          entry.name,
        ) ||
        entry.name === "config.env"
      )
        continue;
      if (entry.isSymbolicLink())
        throw new Error("Do not package symbolic links");
      await collect(join(path, entry.name));
    }
  } else if (info.isFile()) files.push(path);
}
for (const item of allowed) await collect(join(root, item));
if (
  !files.some(
    (file) => relative(root, file) === join("dist", "server", "index.js"),
  )
)
  throw new Error("Run npm run build first");
const chunks = [];
const central = [];
let offset = 0;
for (const path of files) {
  const filename = Buffer.from(
    `${name}/${relative(root, path).split(sep).join("/")}`,
  );
  const original = await readFile(path);
  const compressed = deflateRawSync(original);
  const checksum = crc32(original);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x5d46, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(original.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0x5d46, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(original.length, 24);
  header.writeUInt16LE(filename.length, 28);
  header.writeUInt32LE(offset, 42);
  chunks.push(local, filename, compressed);
  central.push(header, filename);
  offset += local.length + filename.length + compressed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const output = resolve("..", "ButterChicken-Final.zip");
await writeFile(output, Buffer.concat([...chunks, directory, end]));
console.log(
  `Created ${output} with ${files.length} source, build and guide files. Local databases and real environment files are excluded.`,
);
