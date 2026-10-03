export default {
  name: 'roll',
  execute(message, args) {
    const raw = args[0] ?? '6';
    const max = parseInt(raw, 10);
    if (!Number.isFinite(max) || max < 2 || max > 1000000) {
      return message.reply('🎲 Usage: `!roll [2-1000000]` (default 6)');
    }
    const result = Math.floor(Math.random() * max) + 1;
    return message.reply(`🎲 You rolled a **${result}** (out of ${max})!`);
  },
};
