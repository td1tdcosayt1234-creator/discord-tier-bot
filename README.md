# 🤖 Discord Bot

A cool Discord bot built with discord.js.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Edit `.env` and paste your bot token from https://discord.com/developers/applications

3. Run the bot:
   ```bash
   npm start
   ```

## Commands (prefix: `!`)

- `!help` - Show all commands
- `!ping` - Check latency
- `!8ball <question>` - Magic 8-ball
- `!roll [number]` - Roll a dice
- `!joke` - Random joke
- `!say <text>` - Bot echoes text
- `!avatar [@user]` - Get avatar
- `!userinfo [@user]` - User info
- `!serverinfo` - Server info
- `!clear <amount>` - Bulk delete messages (mods)
- `!tier show` - Show the tier list
- `!tier create <NAME>` - Create a new tier (e.g. `!tier create SS`)
- `!tier delete <NAME>` - Delete a tier
- `!tier add <TIER> <player>` - Add player to a tier
- `!tier remove <TIER> <player>` - Remove player from a tier
- `!tier setname <name>` - Rename the tier list
- `!tier reset` - Clear everyone from the tier list
