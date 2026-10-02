export default {
  name: 'say',
  execute(message, args) {
    const text = args.join(' ');
    if (!text) return message.reply('Please provide something to say!');
    message.delete().catch(() => {});
    return message.channel.send(text);
  },
};
