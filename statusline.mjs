#!/usr/bin/env node
// Claude Code status line: model · context · 5h limit · this machine's share of the 5h window · weekly limit · folder · git branch.
// Set it in ~/.claude/settings.json as statusLine. No network, no git binary (reads .git/HEAD).
//
// "PC" bar: your own subscription used on several computers, this one gets a budget (% of the 5h window).
// Local usage = tokens from this machine's transcripts (~/.claude/projects) in the current window, weighted by price.
// The factor converting that to "% of the account" calibrates itself once the window reaches 20%
// (assumes only this machine used the account so far) and is stored in ~/.claude/sub-limiter.json.
// Delete that file to recalibrate (e.g. after changing plans).
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));
const bar = (ratio, col) => {
  const full = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return c(col, "█".repeat(full)) + c(90, "░".repeat(10 - full));
};
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const model = input.model?.display_name ?? input.model?.id ?? "?";
const cw = input.context_window ?? {};
const pct = cw.used_percentage ?? (cw.total_input_tokens && cw.context_window_size ? Math.round((cw.total_input_tokens / cw.context_window_size) * 100) : null);
const ctxCol = pct == null ? 90 : pct < 40 ? 32 : pct < 70 ? 33 : pct < 85 ? 35 : 31;
const ctx = pct == null ? c(90, "ctx –") : c(ctxCol, `ctx ${pct}%`) + (cw.total_input_tokens ? c(90, ` ${short(cw.total_input_tokens)}/${short(cw.context_window_size ?? 0)}`) : "");

const dir = input.workspace?.current_dir ?? input.cwd ?? process.cwd();
let branch = "";
for (let d = dir; d && d !== dirname(d); d = dirname(d)) {
  const head = join(d, ".git", "HEAD");
  if (existsSync(head)) { branch = readFileSync(head, "utf8").trim().replace(/^ref: refs\/heads\//, ""); break; }
}

// Subscription limits (rate_limits from Claude Code): bar + % + reset time.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const limit = (label, rl, withDay) => {
  if (rl?.used_percentage == null) return null;
  const p = Math.max(0, Math.min(100, Math.round(rl.used_percentage)));
  const col = p < 50 ? 32 : p < 75 ? 33 : p < 90 ? 35 : 31;
  let reset = "";
  if (rl.resets_at) {
    const d = new Date(rl.resets_at * 1000);
    reset = c(90, ` ↻${withDay ? DAYS[d.getDay()] + " " : ""}${hhmm(d)}`);
  }
  return c(90, `${label} `) + bar(p / 100, col) + c(col, ` ${p}%`) + reset;
};
const rl = input.rate_limits ?? {};
const limits = [limit("5h", rl.five_hour, false), limit("week", rl.seven_day, true)].filter(Boolean);

// Relative prices (USD/Mtok input/output) - only the ratios between models matter.
const PRICE = { opus: [5, 25], sonnet: [3, 15], haiku: [1, 5] };
const weightOf = (model, u) => {
  const [inp, out] = PRICE[Object.keys(PRICE).find((k) => String(model).includes(k)) ?? "sonnet"];
  const c1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const c5m = (u.cache_creation_input_tokens ?? 0) - c1h;
  return (inp * ((u.input_tokens ?? 0) + 1.25 * c5m + 2 * c1h + 0.1 * (u.cache_read_input_tokens ?? 0)) + out * (u.output_tokens ?? 0)) / 1e6;
};
const claudeDir = join(homedir(), ".claude");
const readJson = (f) => { try { return JSON.parse(readFileSync(join(claudeDir, f), "utf8")); } catch { return {}; } };
const writeJson = (f, v) => { try { writeFileSync(join(claudeDir, f), JSON.stringify(v, null, 2)); } catch {} };

function localUsage(windowStart) {
  const cached = readJson("sub-limiter-cache.json");
  if (cached.windowStart === windowStart && Date.now() - cached.ts < 60_000) return cached.weight;
  const seen = new Set();
  let weight = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl") && statSync(p).mtimeMs >= windowStart) {
        for (const line of readFileSync(p, "utf8").split("\n")) {
          if (!line.includes('"usage"')) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          const u = j.message?.usage, id = j.message?.id ?? j.requestId;
          if (!u || Date.parse(j.timestamp) < windowStart || (id && seen.has(id))) continue;
          if (id) seen.add(id);
          weight += weightOf(j.message.model, u);
        }
      }
    }
  };
  try { walk(join(claudeDir, "projects")); } catch {}
  writeJson("sub-limiter-cache.json", { windowStart, ts: Date.now(), weight });
  return weight;
}

function notify(title, msg) {
  const os = platform();
  let cmd, args;
  if (os === "win32") {
    cmd = "powershell.exe";
    args = ["-NoProfile", "-WindowStyle", "Hidden", "-Command",
      `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;`
      + `$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);`
      + `$t=$x.GetElementsByTagName('text');$t.Item(0).AppendChild($x.CreateTextNode('${title}'))|Out-Null;$t.Item(1).AppendChild($x.CreateTextNode('${msg}'))|Out-Null;`
      + `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))`];
  } else if (os === "darwin") {
    cmd = "osascript";
    args = ["-e", `display notification "${msg}" with title "${title}"`];
  } else {
    cmd = "notify-send";
    args = [title, msg];
  }
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref(); } catch {}
}

const fh = rl.five_hour;
if (fh?.resets_at && fh.used_percentage != null) {
  const windowStart = fh.resets_at * 1000 - 5 * 3600_000;
  let cfg = readJson("sub-limiter.json");
  const weight = localUsage(windowStart);
  // Calibrate late: used_percentage is rounded, so at 5% the factor could be off by ±10%.
  if (!cfg.factor && weight > 0 && fh.used_percentage >= 20) {
    cfg = { budget: cfg.budget ?? 30, factor: fh.used_percentage / weight, calibratedAt: new Date().toISOString() };
    writeJson("sub-limiter.json", cfg);
  }
  if (cfg.factor) {
    const budget = cfg.budget ?? 30;
    const mine = Math.round(weight * cfg.factor);
    const ratio = mine / budget;
    const col = ratio < 0.6 ? 32 : ratio < 0.85 ? 33 : ratio < 1 ? 35 : 31;
    limits.splice(1, 0, c(90, "PC ") + bar(ratio, col) + c(col, ` ${mine}%/${budget}%`));
    // Desktop notification at 80% and 100% of the budget, each once per 5h window (state shared by all sessions).
    let st = readJson("sub-limiter-alert.json");
    if (st.windowStart !== windowStart) st = { windowStart, fired: [] };
    const hit = [1, 0.8].find((t) => ratio >= t && !st.fired.includes(t));
    if (hit != null) {
      st.fired.push(...[1, 0.8].filter((t) => t <= hit && !st.fired.includes(t)));
      writeJson("sub-limiter-alert.json", st);
      const reset = hhmm(new Date(fh.resets_at * 1000));
      notify("Claude - machine budget", hit >= 1
        ? `This machine is over budget: ${mine}% of ${budget}% of the 5h window. Resets ${reset}.`
        : `This machine used ${mine}% of its ${budget}% budget for the 5h window. Resets ${reset}.`);
    }
  }
}

const parts = [c(36, model), ctx, ...limits, c(90, basename(dir))];
if (branch) parts.push(c(90, `⎇ ${branch.length > 30 ? branch.slice(0, 7) : branch}`));
process.stdout.write(parts.join(c(90, " · ")));
