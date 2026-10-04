export default {
  name: 'say',
  execute(message, args) {
    let text = args.join(' ').trim().slice(0, 1900);
    if (!text) return message.reply('Please provide something to say!');
    // block mass mentions (case-insensitive + zero-width)
    const norm = text.replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '');
    if (/@everyone|@here|<@&/i.test(norm)) {
      return message.reply('❌ No @everyone / @here / role mentions allowed!');
    }
    const safe = text.replace(/@everyone/gi, '@\u200beveryone').replace(/@here/gi, '@\u200bhere');
    message.delete().catch(() => {});
    return message.channel.send(safe).catch(() => message.reply('❌ I cannot send messages here!'));
  },
};
