# claude_sub_limiter_mod

A Claude Code status line for when you use **your own subscription on more than one computer** (e.g. work and home) and want to keep one of them from eating the whole 5h window.
Besides the usual 5h and weekly limits it shows how much of the 5h window **this computer** has used, against a budget you set.

```
Opus · ctx 41% 82k/200k · 5h ███░░░░░░░ 35% ↻17:00 · PC ███████░░░ 21%/30% · week █░░░░░░░░░ 12% ↻Sat 11:00 · my-project · ⎇ main
```

At 80% and 100% of the budget you get a desktop notification (Windows toast, macOS `osascript`, Linux `notify-send`), each once per 5h window.

## How it works

- `5h` / `week` come straight from `rate_limits` that Claude Code passes to the status line (subscription plans only).
- `PC` = tokens from this machine's transcripts (`~/.claude/projects/**/*.jsonl`) since the start of the current 5h window, weighted by relative model prices, times a conversion factor.
- The factor calibrates itself the first time the 5h window reaches 20%. **At that moment only this machine should have used the account.** It is saved in `~/.claude/sub-limiter.json`.
- Everything is local: no network calls, no telemetry.

## Install

Requires Node.js 18+.

```sh
npx github:c0demite/claude_sub_limiter_mod
```

Optionally set this computer's budget right away:

```sh
npx github:c0demite/claude_sub_limiter_mod --budget 30
```

This copies `statusline.mjs` to `~/.claude/sub-limiter-statusline.mjs` and sets `statusLine` in `~/.claude/settings.json` (the old file is kept as `settings.json.bak`). Restart Claude Code.

<details><summary>Manual install</summary>

Copy `statusline.mjs` anywhere and add to `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "node /path/to/statusline.mjs" }
}
```

</details>

## Configure

`~/.claude/sub-limiter.json` (created on calibration):

```json
{ "budget": 30, "factor": 0.49, "calibratedAt": "..." }
```

- `budget` - this computer's share of the 5h window in % (or use `--budget` when installing).
- Remove `factor` from the file to recalibrate, e.g. after switching plans - a bigger plan means each token is a smaller % of the window.

The `PC` value is an estimate; expect a few % of drift.

## License

MIT
