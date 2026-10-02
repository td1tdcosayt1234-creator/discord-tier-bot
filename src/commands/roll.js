export default {
  name: 'roll',
  execute(message, args) {
    const max = parseInt(args[0]) || 6;
    if (max < 2) return message.reply('🎲 Please provide a number greater than 1!');
    const result = Math.floor(Math.random() * max) + 1;
    return message.reply(`🎲 You rolled a **${result}** (out of ${max})!`);
  },
};
