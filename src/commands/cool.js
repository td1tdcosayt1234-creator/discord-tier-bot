import { EmbedBuilder } from 'discord.js';
import { randomInt } from 'node:crypto';

const QUOTES = [
  'Stay hungry, stay foolish. — Steve Jobs',
  'The best way out is always through. — Robert Frost',
  'Grind now, shine later. ✨',
  'Small steps every day lead to big wins.',
  'Tier S mindset: practice, patience, precision.',
  'Bot online, grind online. 🤖',
  'No lag in dreams. Keep pushing!',
  'GGs only. Learn from every loss.',
];

export default {
  name: 'cool',
  async execute(message, args) {
    const sub = (args[0] || 'help').toLowerCase();
    if (sub === 'coin' || sub === 'flip' || sub === 'coinflip') {
      const win = randomInt(0, 2) === 0;
      const e = new EmbedBuilder().setTitle('🪙 Coinflip').setColor(win ? 0xffd23f : 0x5865f2)
        .setDescription(`# ${win ? 'HEADS ☀️' : 'TAILS 🌙'}`)
        .setFooter({ text: `Called by ${message.author.username}` });
      return message.reply({ embeds: [e] });
    }
    if (sub === 'rps') {
      const pick = (args[1] || '').toLowerCase();
      const valid = ['rock', 'paper', 'scissors'];
      if (!valid.includes(pick)) return message.reply('❓ Usage: `!cool rps <rock|paper|scissors>`');
      const bot = valid[randomInt(0, 3)];
      const winMap = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
      const result = bot === pick ? '🤝 Draw!' : winMap[pick] === bot ? '🎉 You win!' : '🤖 Bot wins!';
      const e = new EmbedBuilder().setTitle('✊✋✌️ Rock-Paper-Scissors').setColor(0x9b5de5)
        .addFields({ name: 'You', value: pick, inline: true }, { name: 'Bot', value: bot, inline: true }, { name: 'Result', value: result, inline: false });
      return message.reply({ embeds: [e] });
    }
    if (sub === 'quote') {
      const q = QUOTES[randomInt(0, QUOTES.length)];
      const e = new EmbedBuilder().setTitle('💬 Quote').setColor(0x06d6a0).setDescription(`> ${q}`);
      return message.reply({ embeds: [e] });
    }
    const e = new EmbedBuilder().setTitle('✨ Cool Commands').setColor(0x5865f2)
      .setDescription(['`!cool coin` — flip a coin', '`!cool rps <rock|paper|scissors>` — play RPS', '`!cool quote` — random quote', '`!cool stats` — bot stats'].join('\n'));
    if (sub === 'stats') {
      const up = Math.floor(process.uptime());
      const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      return message.reply({ embeds: [new EmbedBuilder().setTitle('📊 Bot Stats').setColor(0x118ab2)
        .addFields({ name: 'Uptime', value: `${Math.floor(up / 3600)}h ${Math.floor(up % 3600 / 60)}m`, inline: true }, { name: 'Memory', value: `${mem} MB`, inline: true }, { name: 'Node', value: process.version, inline: true })] });
    }
    return message.reply({ embeds: [e] });
  },
};
