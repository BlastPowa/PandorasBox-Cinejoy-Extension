#!/usr/bin/env node

import fs from "node:fs";

const kind = (process.argv[2] || "patch").toLowerCase();
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("Usage: node scripts/bump-version.mjs [patch|minor|major]");
  process.exit(1);
}

const manifestPath = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const parts = String(manifest.version || "0.0.0").split(".").map((part) => Number.parseInt(part, 10));
while (parts.length < 3) parts.push(0);

if (kind === "major") {
  parts[0] += 1;
  parts[1] = 0;
  parts[2] = 0;
} else if (kind === "minor") {
  parts[1] += 1;
  parts[2] = 0;
} else {
  parts[2] += 1;
}

manifest.version = parts.slice(0, 3).join(".");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json -> v${manifest.version}`);
