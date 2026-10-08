#!/usr/bin/env node
// Installer: copies statusline.mjs to ~/.claude and points statusLine in ~/.claude/settings.json at it.
// Usage: npx github:c0demite/claude_sub_limiter_mod [--budget 30]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const i = process.argv.indexOf("--budget");
const budget = i > 0 ? Number(process.argv[i + 1]) : null;
if (budget != null && !(budget > 0 && budget <= 100)) { console.error("--budget must be a number 1-100"); process.exit(1); }

const claudeDir = join(homedir(), ".claude");
const target = join(claudeDir, "sub-limiter-statusline.mjs");
const settingsFile = join(claudeDir, "settings.json");
mkdirSync(claudeDir, { recursive: true });
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "statusline.mjs"), target);

let settings = {};
if (existsSync(settingsFile)) {
  const raw = readFileSync(settingsFile, "utf8");
  try { settings = JSON.parse(raw); } catch {
    console.error(`Could not parse ${settingsFile} - fix it or add statusLine by hand:\n  "statusLine": { "type": "command", "command": "node ${target.replaceAll("\\", "/")}" }`);
    process.exit(1);
  }
  writeFileSync(settingsFile + ".bak", raw);
}
const prev = settings.statusLine;
settings.statusLine = { type: "command", command: `node "${target.replaceAll("\\", "/")}"` };
writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");

if (budget != null) {
  const cfgFile = join(claudeDir, "sub-limiter.json");
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(cfgFile, "utf8")); } catch {}
  writeFileSync(cfgFile, JSON.stringify({ ...cfg, budget }, null, 2));
}

console.log(`Installed ${target}`);
if (prev) console.log(`Replaced previous statusLine (backup: ${settingsFile}.bak): ${JSON.stringify(prev)}`);
console.log("Restart Claude Code to see it.");
