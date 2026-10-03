import { redeemJoinCode } from '../db.js';

// 5 tries / 5 min per user (codes are secret)
const attempts = new Map();
function hitRateLimit(userId) {
  const now = Date.now();
  const arr = (attempts.get(userId) || []).filter(t => now - t < 5 * 60 * 1000);
  arr.push(now);
  attempts.set(userId, arr);
  return arr.length > 5;
}

export default {
  name: 'join',
  async execute(message, args, client, PREFIX) {
    const code = (args[0] || '').trim();
    if (!code) return message.reply(`❌ Usage: \`${PREFIX}join <8-digit-code>\` — get the code from an admin!`);
    if (hitRateLimit(message.author.id)) return message.reply('⏳ Too many tries! Wait 5 minutes.');
    message.delete().catch(() => {});
    const r = redeemJoinCode(code, message.guild.id, message.author.id);
    if (!r.ok) return message.channel.send(`❌ <@${message.author.id}> ${r.error}`).catch(() => {});
    if (r.role === 'admin') {
      return message.channel.send(`✅ <@${message.author.id}> joined as **ADMIN**! AI unlocked + bot management allowed. I deleted your code message for safety.`).catch(() => {});
    }
    return message.channel.send(`✅ <@${message.author.id}> joined! You can now use \`!ai\`. I deleted your code message for safety.`).catch(() => {});
  },
};
