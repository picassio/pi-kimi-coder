# pi-kimi-coder

A [pi](https://github.com/badlogic/pi-mono) extension that adds the **Kimi K2 Coding Plan** as a provider. Use Moonshot AI's `kimi-for-coding` model directly inside pi with full tool use, extended thinking, and image support.

> **What is the K2 Coding Plan?** Moonshot AI offers a [subscription plan](https://kimi.com) that gives unlimited (fair-use) access to their flagship coding model through `api.kimi.com/coding/v1`. This is different from the pay-per-token Open Platform at `api.moonshot.ai`.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Authentication](#authentication)
  - [Option A: Already using kimi-cli (recommended)](#option-a-already-using-kimi-cli-recommended)
  - [Option B: Login through pi](#option-b-login-through-pi)
  - [Option C: Environment variable](#option-c-environment-variable)
- [Usage](#usage)
- [Models](#models)
- [How It Works](#how-it-works)
  - [Architecture](#architecture)
  - [Token Lifecycle](#token-lifecycle)
  - [Credential Sharing](#credential-sharing)
- [Configuration](#configuration)
- [Comparison with pi-moonshot](#comparison-with-pi-moonshot)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

- **Zero-config if you use kimi-cli** — existing credentials are automatically imported
- **OAuth device flow** — browser-based login via `/login kimi-coder`, no API keys to copy
- **Automatic token refresh** — tokens are refreshed on session start and every 10 minutes during long sessions
- **Bidirectional credential sharing** — tokens stay in sync between pi and kimi-cli
- **Extended thinking** — full reasoning/chain-of-thought support via the `zai` thinking format
- **Image input** — send images to the model for analysis
- **262K context window** — large context for working with entire codebases
- **$0 cost tracking** — subscription plan, so no per-token costs to track

## Prerequisites

- **[pi](https://github.com/badlogic/pi-mono)** (v0.50.0+)
- **A Kimi K2 Coding Plan subscription** — sign up at [kimi.com](https://kimi.com)
- **kimi-cli** (optional but recommended) — `uv tool install kimi-cli` or `pip install kimi-cli`

## Installation

### From local path

```bash
git clone https://github.com/YOUR_USERNAME/pi-kimi-coder.git
pi install /path/to/pi-kimi-coder
```

### Try without installing

```bash
pi -e /path/to/pi-kimi-coder
```

### Install to a specific project only

```bash
pi install -l /path/to/pi-kimi-coder
```

## Authentication

The extension supports three authentication methods, in order of convenience.

### Option A: Already using kimi-cli (recommended)

If you have [kimi-cli](https://github.com/nicepkg/kimi-cli) installed and logged in, **no extra setup is needed**. The extension reads your credentials directly from `~/.kimi/credentials/kimi-code.json`.

```bash
# If you haven't logged in yet:
kimi-cli login

# Then just start pi — credentials are picked up automatically
pi --provider kimi-coder --model kimi-for-coding
```

You'll see a notification: *"Kimi Coder: using kimi-cli credentials"*.

### Option B: Login through pi

Use pi's built-in OAuth device flow. No kimi-cli required.

```bash
pi
/login kimi-coder
```

This will:
1. Open your browser to Kimi's authorization page
2. Show a device code in the terminal
3. After you approve, tokens are saved for both pi and kimi-cli

### Option C: Environment variable

If you have an API access token (e.g. from the Moonshot Open Platform), set it directly:

```bash
export KIMI_CODER_API_KEY="your-token-here"
pi --provider kimi-coder --model kimi-for-coding
```

Or add it to `~/.pi/agent/settings.json`:

```json
{
  "apiKeys": {
    "KIMI_CODER_API_KEY": "your-token-here"
  }
}
```

> **Note:** Tokens from the Coding Plan are short-lived OAuth tokens. For persistent access without kimi-cli, use Option B.

## Usage

### Start pi with Kimi Coder

```bash
pi --provider kimi-coder --model kimi-for-coding
```

### Switch to Kimi Coder inside an existing session

```
/model kimi-coder/kimi-for-coding
```

### Set as default model

Add to `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "kimi-coder",
  "defaultModel": "kimi-for-coding"
}
```

### One-shot (print mode)

```bash
pi --provider kimi-coder --model kimi-for-coding -p "explain this error" < error.log
```

### Control thinking level

```bash
# Inside pi
/thinking high

# Or via CLI
pi --provider kimi-coder --model kimi-for-coding --thinking high -p "refactor this function"
```

## Models

| Model ID | Display Name | Context | Reasoning | Image | Description |
|----------|-------------|---------|-----------|-------|-------------|
| `kimi-for-coding` | Kimi for Coding (K2.5) | 262K | ✅ | ✅ | Coding-optimized, default for Coding Plan |
| `kimi-k2.5` | Kimi K2.5 | 262K | ✅ | ✅ | Flagship K2.5 model |

Both models:
- Use the **`zai` thinking format** (extended reasoning via `reasoning_content` in streamed responses)
- Support **text and image inputs**
- Have a **262,144 token** context window
- Output up to **32,768 tokens** per response
- Costs show as $0 (subscription plan — unlimited fair-use)

## How It Works

### Architecture

```
┌──────────────────────────────────────────────┐
│  pi                                          │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  pi-kimi-coder extension               │  │
│  │                                        │  │
│  │  • Registers "kimi-coder" provider     │  │
│  │  • Auto-imports kimi-cli tokens        │  │
│  │  • Handles OAuth device flow           │  │
│  │  • Refreshes tokens in background      │  │
│  └──────────────┬─────────────────────────┘  │
│                 │                             │
│  ┌──────────────▼─────────────────────────┐  │
│  │  openai-completions API adapter        │  │
│  │  (built into pi)                       │  │
│  └──────────────┬─────────────────────────┘  │
│                 │                             │
└─────────────────┼─────────────────────────────┘
                  │  HTTPS + SSE streaming
                  │  Authorization: Bearer <token>
                  │  User-Agent: KimiCLI/1.5
                  ▼
┌──────────────────────────────────────────────┐
│  https://api.kimi.com/coding/v1              │
│  (Kimi K2 Coding Plan API)                   │
└──────────────────────────────────────────────┘
```

### Token Lifecycle

```
Extension loads
  │
  ├─ Read ~/.kimi/credentials/kimi-code.json
  │   └─ Found? → Set KIMI_CODER_API_KEY env var
  │
  ├─ Seed ~/.pi/agent/auth.json (for OAuth refresh)
  │
  ├─ Register "kimi-coder" provider with pi
  │
  └─ Session starts
      │
      ├─ Token < 5 min remaining?
      │   └─ Yes → Refresh via https://auth.kimi.com
      │            Save to ~/.kimi/credentials/
      │            Update env var
      │
      └─ Start 10-minute refresh interval
          │
          └─ Every 10 min: check token, refresh if < 5 min left
```

### Credential Sharing

Credentials are stored in two locations and kept in sync:

| Location | Format | Used by |
|----------|--------|---------|
| `~/.kimi/credentials/kimi-code.json` | `{ access_token, refresh_token, expires_at, ... }` | kimi-cli, pi-kimi-coder |
| `~/.pi/agent/auth.json` | `{ type: "oauth", access, refresh, expires }` | pi OAuth system |

- When the extension starts, it reads from `~/.kimi/credentials/` → writes to `~/.pi/agent/auth.json`
- When tokens are refreshed (by either tool), both files are updated
- kimi-cli and pi can run simultaneously without conflicts

## Configuration

### Extension settings in `~/.pi/agent/settings.json`

The extension is listed under `packages` after installation:

```json
{
  "packages": [
    "/path/to/pi-kimi-coder"
  ]
}
```

### Custom API endpoint

If you're using a self-hosted or proxied Kimi API, set the base URL via environment variable:

```bash
export KIMI_CODE_BASE_URL="https://your-proxy.example.com/v1"
```

The extension uses `https://api.kimi.com/coding/v1` by default.

## Comparison with pi-moonshot

[pi-moonshot](https://github.com/default-anton/pi-moonshot) is a separate extension for the Moonshot **Open Platform** (pay-per-token). Here's how they differ:

| | pi-kimi-coder | pi-moonshot |
|---|---|---|
| **API endpoint** | `api.kimi.com/coding/v1` | `api.moonshot.ai/v1` |
| **Authentication** | OAuth device flow | API key (`MOONSHOT_API_KEY`) |
| **Billing** | Subscription (K2 Coding Plan) | Pay-per-token |
| **Primary model** | `kimi-for-coding` | `kimi-k2.5` |
| **kimi-cli interop** | ✅ Shared credentials | ❌ |
| **Token refresh** | ✅ Automatic | N/A (static key) |
| **User-Agent header** | ✅ Required by API | Not needed |
| **All Moonshot models** | ❌ Only coding models | ✅ Legacy + new models |

**Which one should I use?**
- **K2 Coding Plan subscriber** → `pi-kimi-coder` (this extension)
- **Moonshot Open Platform user** → `pi-moonshot`

You can install both simultaneously — they register different provider names (`kimi-coder` vs `moonshot`).

## Troubleshooting

### "401 The API Key appears to be invalid"

Your OAuth token has expired. Fix:

```bash
# If you have kimi-cli:
kimi-cli login

# Or via pi:
/login kimi-coder
```

### "403 Kimi For Coding is currently only available for Coding Agents"

The API checks the `User-Agent` header. This extension sets it to `KimiCLI/1.5` automatically. If you're seeing this error, ensure you're using the extension (not raw API calls).

### "No API key found for kimi-coder"

No credentials were found anywhere. Solutions:

1. Login with kimi-cli first: `kimi-cli login`
2. Or login through pi: `/login kimi-coder`
3. Or set the env var: `export KIMI_CODER_API_KEY="..."`

### Token expires during a long session

The extension automatically refreshes tokens every 10 minutes. If you see auth errors after a very long session:

```
/login kimi-coder
```

### kimi-cli and pi show different login states

Delete stale credentials and re-login:

```bash
rm ~/.kimi/credentials/kimi-code.json
kimi-cli login
# pi will pick up the new credentials automatically on next start
```

### Model not showing in `/model` selector

Ensure the extension is installed:

```bash
pi list
```

If `pi-kimi-coder` is not listed:

```bash
pi install /path/to/pi-kimi-coder
```

## Development

### Project structure

```
pi-kimi-coder/
├── extensions/
│   └── index.ts          # Extension entry point
├── package.json           # Pi package manifest
├── README.md
└── LICENSE
```

### Key technical details

- **API compatibility:** Kimi's Coding API is OpenAI Chat Completions compatible, so this extension uses pi's built-in `openai-completions` adapter
- **Thinking format:** Uses `"zai"` — the API streams reasoning in `reasoning_content` delta fields (same format as DeepSeek/Qwen thinking)
- **Auth flow:** OAuth 2.0 Device Authorization Grant ([RFC 8628](https://tools.ietf.org/html/rfc8628)) via `https://auth.kimi.com`
- **Client ID:** `17e5f671-d194-4dfb-9706-5516cb48c098` (Kimi Code's official client ID, shared with kimi-cli)
- **User-Agent gating:** The Coding API returns 403 unless `User-Agent` matches a known coding agent pattern

### Testing locally

```bash
# Run pi with the extension from source (no install needed)
pi -e ./pi-kimi-coder

# Test in print mode
pi -e ./pi-kimi-coder --provider kimi-coder --model kimi-for-coding -p "hello"
```

### Making changes

Edit `extensions/index.ts` directly — pi loads TypeScript via [jiti](https://github.com/unjs/jiti), no build step needed. If installed, use `/reload` in pi to pick up changes.

## License

MIT
