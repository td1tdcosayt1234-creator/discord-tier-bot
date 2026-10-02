import { EmbedBuilder } from 'discord.js';
import { getTierName, setTierName, getPlayers, getTiers, createTier, deleteTier, addPlayer, removePlayer, resetTierList } from '../db.js';

const TIER_EMOJIS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚪', '⚫', '🟤', '⭐'];
const MAX_TIERS = 20;

function validTierName(tier) {
  return /^[A-Z0-9+\-]{1,10}$/.test(tier);
}

export default {
  name: 'tier',
  execute(message, args, client, PREFIX) {
    const sub = (args[0] || 'show').toLowerCase();
    const guildId = message.guild.id;

    if (sub === 'show') {
      const name = getTierName(guildId);
      const tiers = getTiers(guildId);
      const players = getPlayers(guildId);
      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${name}`)
        .setColor(0x5865f2)
        .setTimestamp();
      tiers.forEach((t, i) => {
        const emoji = TIER_EMOJIS[i % TIER_EMOJIS.length];
        const list = players.filter(p => p.tier === t).map(p => `• ${p.player}`);
        embed.addFields({ name: `${emoji} ${t}`, value: list.length ? list.join('\n') : '_empty_' });
      });
      return message.reply({ embeds: [embed] });
    }

    if (sub === 'create') {
      const tier = (args[1] || '').toUpperCase();
      if (!tier || !validTierName(tier)) {
        return message.reply(`❌ Usage: \`${PREFIX}tier create <NAME>\` (letters/numbers, max 10 chars, no spaces)`);
      }
      if (getTiers(guildId).length >= MAX_TIERS) {
        return message.reply(`❌ Max **${MAX_TIERS}** tiers allowed!`);
      }
      if (!createTier(guildId, tier)) {
        return message.reply(`⚠️ Tier **${tier}** already exists!`);
      }
      return message.reply(`✅ Created Tier **${tier}**!`);
    }

    if (sub === 'delete') {
      const tier = (args[1] || '').toUpperCase();
      if (!tier) return message.reply(`❌ Usage: \`${PREFIX}tier delete <NAME>\``);
      const result = deleteTier(guildId, tier);
      if (result === null) return message.reply(`⚠️ Tier **${tier}** not found!`);
      if (result === 'last') return message.reply(`❌ Cannot delete the last tier!`);
      return message.reply(`🗑️ Deleted Tier **${tier}** (removed **${result}** player(s))!`);
    }

    if (sub === 'add') {
      const tiers = getTiers(guildId);
      const tier = (args[1] || '').toUpperCase();
      const player = args.slice(2).join(' ');
      if (!tiers.includes(tier) || !player) {
        return message.reply(`❌ Usage: \`${PREFIX}tier add <${tiers.join('/')}> <player>\``);
      }
      addPlayer(guildId, tier, player);
      return message.reply(`✅ Added **${player}** to Tier **${tier}**!`);
    }

    if (sub === 'remove') {
      const tiers = getTiers(guildId);
      const tier = (args[1] || '').toUpperCase();
      const player = args.slice(2).join(' ');
      if (!tiers.includes(tier) || !player) {
        return message.reply(`❌ Usage: \`${PREFIX}tier remove <${tiers.join('/')}> <player>\``);
      }
      const removed = removePlayer(guildId, tier, player);
      if (!removed) return message.reply(`⚠️ **${player}** not found in Tier ${tier}!`);
      return message.reply(`🗑️ Removed **${player}** from Tier **${tier}**!`);
    }

    if (sub === 'setname') {
      const name = args.slice(1).join(' ');
      if (!name) return message.reply(`❌ Usage: \`${PREFIX}tier setname <name>\``);
      setTierName(guildId, name);
      return message.reply(`✏️ Tier list renamed to **${name}**!`);
    }

    if (sub === 'reset') {
      resetTierList(guildId);
      return message.reply('🔄 Tier list has been reset!');
    }

    return message.reply(`❌ Unknown tier command! Try \`${PREFIX}tier show\`, \`create\`, \`delete\`, \`add\`, \`remove\`, \`setname\`, \`reset\`.`);
  },
};
