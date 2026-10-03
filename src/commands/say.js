export default {
  name: 'say',
  execute(message, args) {
    let text = args.join(' ').trim().slice(0, 1900);
    if (!text) return message.reply('Please provide something to say!');
    // block mass mentions
    if (/@everyone|@here|<@&/.test(text)) {
      return message.reply('❌ No @everyone / @here / role mentions allowed!');
    }
    message.delete().catch(() => {});
    return message.channel.send(text).catch(() => message.reply('❌ I cannot send messages here!'));
  },
};
