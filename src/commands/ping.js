export default {
  name: 'ping',
  execute(message, args, client) {
    return message.reply(`🏓 Pong! Latency: **${Date.now() - message.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  },
};
