# 🤖 Discord Bot

A cool Discord bot built with discord.js.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and paste your bot token from https://discord.com/developers/applications

3. Run the bot:
   ```bash
   npm start
   ```

## Commands (prefix: `!`, plus `!!` also works — so `!!connect` works)

- `!help` - Show all commands
- `!ping` - Check latency
- `!8ball <question>` - Magic 8-ball
- `!roll [number]` - Roll a dice
- `!joke` - Random joke
- `!ai <question>` - Ask the AI
- `!say <text>` - Bot echoes text (blocks @everyone)
- `!avatar [@user]` - Get avatar
- `!userinfo [@user]` - User info
- `!serverinfo` - Server info
- `!clear <amount>` - Bulk delete messages (mods, 1-100, <14 days)
- `!tier show` - Show the tier list
- `!tier create <NAME>` - Create a new tier (e.g. `!tier create SS`) (mods)
- `!tier delete <NAME>` - Delete a tier (mods)
- `!tier emoji <TIER> <emoji>` - Set custom emoji for a tier (e.g. `!tier emoji S 👑`) (mods)
- `!tier add <TIER> <player>` - Add player to a tier (mods)
- `!tier remove <TIER> <player>` - Remove player from a tier (mods)
- `!tier setname <name>` - Rename the tier list (mods)
- `!tier reset` - Clear everyone from the tier list (mods)

## 🔌 AI Connect (no API key needed!)

```bash
!!connect login                        # OpenRouter: link -> log in -> copy code
!!connect login google                 # Google: sign in -> auto-connected (Gemini)
!!connect login huggingface            # HF: enter the shown code on the site, auto-connects
!!connect code <CODE>                  # paste the OpenRouter code -> connected, no key
!!connect status                       # see your login + server mode
!!connect logout                       # logout
```
- Keyless browser logins: **OpenRouter** (PKCE, works out of the box), **Google** (Gemini, needs `GOOGLE_CLIENT_ID/SECRET` + redirect URI once) and **Hugging Face** (device flow, needs `HF_CLIENT_ID` once).
- After login you can use 400+ models including Gemini with `!ai`, each user on their own login.
- Server-wide key instead (mods): `!!connect gemini <KEY>`, `!!connect openai/groq/openrouter/huggingface/xai/cerebras/fireworks <KEY>`, `!!connect api <URL> <KEY>`.

## 🔐 Dashboard Login

Set `ADMIN_USER` + `ADMIN_PASS` in `.env` to require login — without login you cannot enter: all pages except `/` (home) + all APIs need login. Enter user/pass on the `/login` page (7-day cookie, HttpOnly, HMAC-signed), or use **Continue with Discord** (server owners/admins) or **Continue with Google** (emails in `GOOGLE_ALLOWED_EMAILS`). When logged in, `DASHBOARD_KEY` is not needed separately. Without `ADMIN_USER/PASS` the dashboard is public.

## 🔌 MCP Servers

`/mcp` enter → panel: **➕ Add** (baseUrl required, header optional, auth optional) | 🔑 Login (OAuth, no token) | 📋 List | 🧪 Test | 🛠️ Tools | 📞 Call | 🗑️ Remove. Prefix `!mcp panel/add/login/list/test/tools/call/remove` also works.

Both `!connect` and `!!connect` work.

**1) Auth code (owner sets one code, members unlock):**
```bash
# .env
AI_AUTH_CODE=mysecret123
```
- `!!connect status` - show mode
- `!!connect auth mysecret123` - unlock yourself (message auto-deleted)
- `!!connect logout` - remove your auth

**Join codes (admin panel → Discord) — required: bot is locked without a code (`REQUIRE_JOIN_CODE=true`):**
- Admin logs into the dashboard → **Dashboard ↓ Join Codes** section → Generate (8-digit, user or admin, optional uses/expiry)
- Users type `/join 12345678` (or `!join 12345678`) → AI unlocked
- **Admin** codes additionally grant tier/connect/MCP management (same as mods)

**2) Platform key (mods, connect with that platform's key):**
```bash
!!connect gemini AIza...              # key: https://aistudio.google.com/apikey
!!connect openai sk-...               # key: https://platform.openai.com/api-keys
!!connect groq gsk_...                # key: https://console.groq.com/keys
!!connect openrouter sk-or-...        # key: https://openrouter.ai/keys
!!connect huggingface hf_...         # key: https://huggingface.co/settings/tokens
!!connect xai xai-...                 # key: https://console.x.ai
!!connect cerebras csk-...            # key: https://cloud.cerebras.ai
!!connect fireworks fw_...            # key: https://fireworks.ai
!!connect api https://... sk-...      # custom OpenAI-compatible URL
!!connect model gemini-2.0-flash
!!connect test hello
!!connect free        # back to free
```
- `baseUrl` example: `https://api.openai.com/v1` (trailing `/chat/completions` auto-stripped)
- key message is auto-deleted after saving; also clear it from chat history
- custom endpoint bypasses auth-code requirement for that server

## Web Dashboard

Animated multi-page web panel (default: http://localhost:3000):

- `/` - Public home with live stats
- `/dashboard` - Overview: bot, AI mode, codes, MCP (login required)
- `/tiers` - View/add/remove players, create/delete tiers, set emojis
- `/ai` - AI Playground: chat in the browser (pass `guild` for server custom AI)
- `/commands` - All bot commands reference
- `/status` - Live bot health + uptime
- Set `DASHBOARD_KEY` in `.env` and enter it on the page to enable edits
- Change port with `PORT` in `.env`

## Bug fixes in this version

- `tier` mutating commands now require Manage Messages; embed crash on missing icon fixed; long lists truncated to fit 1024-char field limit
- `clear` checks bot + user perms, handles >14-day messages
- `say` blocks @everyone/@here/role pings + 1900-char limit
- `ai` 45s timeout leak fixed, prompt capped at 1000 chars, per-user cooldown 10s
- `index.js` validates DISCORD_TOKEN, supports `!!` prefix, per-command cooldowns, safe command loader
- dashboard validates Server ID format, rate-limits `/api/ai`, masks API keys
