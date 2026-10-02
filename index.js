import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startDashboard } from './src/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREFIX = process.env.PREFIX || '!';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Load all commands from src/commands
const commands = new Map();
const commandsDir = join(__dirname, 'src', 'commands');
for (const file of readdirSync(commandsDir)) {
  if (!file.endsWith('.js')) continue;
  const mod = await import(`./src/commands/${file}`);
  commands.set(mod.default.name, mod.default);
}

client.once('clientReady', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  client.user.setActivity(`${PREFIX}help for commands`, { type: 0 });
});

client.on('error', console.error);
client.on('shardError', console.error);
client.on('shardDisconnect', e => console.error('[shardDisconnect]', e?.code));
client.on('invalidated', () => console.error('[invalidated] session invalidated'));
client.on('warn', console.warn);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.on('guildMemberAdd', member => {
  const welcomeChannel = member.guild.systemChannel;
  if (welcomeChannel) {
    welcomeChannel.send(`👋 Welcome to **${member.guild.name}**, ${member}! 🎉`);
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  if (!message.guild) return message.reply('❌ Commands only work in a server, not DMs.').catch(() => {});

  const args = message.content.slice(PREFIX.length).trim().split(/ +/g);
  const commandName = args.shift().toLowerCase();

  const command = commands.get(commandName);
  if (!command) {
    return message.reply(`❓ Unknown command! Try \`${PREFIX}help\`.`);
  }

  try {
    await command.execute(message, args, client, PREFIX);
  } catch (err) {
    console.error(err);
    message.reply('⚠️ Something went wrong!');
  }
});

client.login(process.env.DISCORD_TOKEN);

startDashboard(client);
