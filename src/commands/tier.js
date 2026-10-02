import { EmbedBuilder } from 'discord.js';
import { DEFAULT_TIERS } from '../data.js';
import { getTierName, setTierName, getPlayers, addPlayer, removePlayer, resetTierList } from '../db.js';

export default {
  name: 'tier',
  execute(message, args, client, PREFIX) {
    const sub = (args[0] || 'show').toLowerCase();

    if (sub === 'show') {
      const name = getTierName(message.guild.id);
      const players = getPlayers(message.guild.id);
      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${name}`)
        .setColor(0x5865f2)
        .setTimestamp();
      const emojis = { S: '🔴', A: '🟠', B: '🟡', C: '🟢', D: '🔵' };
      for (const t of DEFAULT_TIERS) {
        const list = players.filter(p => p.tier === t).map(p => `• ${p.player}`);
        embed.addFields({ name: `${emojis[t]} Tier ${t}`, value: list.length ? list.join('\n') : '_empty_' });
      }
      return message.reply({ embeds: [embed] });
    }

    if (sub === 'add') {
      const tier = (args[1] || '').toUpperCase();
      const player = args.slice(2).join(' ');
      if (!DEFAULT_TIERS.includes(tier) || !player) {
        return message.reply(`❌ Usage: \`${PREFIX}tier add <S/A/B/C/D> <player>\``);
      }
      addPlayer(message.guild.id, tier, player);
      return message.reply(`✅ Added **${player}** to Tier **${tier}**!`);
    }

    if (sub === 'remove') {
      const tier = (args[1] || '').toUpperCase();
      const player = args.slice(2).join(' ');
      if (!DEFAULT_TIERS.includes(tier) || !player) {
        return message.reply(`❌ Usage: \`${PREFIX}tier remove <S/A/B/C/D> <player>\``);
      }
      const removed = removePlayer(message.guild.id, tier, player);
      if (!removed) return message.reply(`⚠️ **${player}** not found in Tier ${tier}!`);
      return message.reply(`🗑️ Removed **${player}** from Tier **${tier}**!`);
    }

    if (sub === 'setname') {
      const name = args.slice(1).join(' ');
      if (!name) return message.reply(`❌ Usage: \`${PREFIX}tier setname <name>\``);
      setTierName(message.guild.id, name);
      return message.reply(`✏️ Tier list renamed to **${name}**!`);
    }

    if (sub === 'reset') {
      resetTierList(message.guild.id);
      return message.reply('🔄 Tier list has been reset!');
    }

    return message.reply(`❌ Unknown tier command! Try \`${PREFIX}tier show\`, \`add\`, \`remove\`, \`setname\`, \`reset\`.`);
  },
};
