import { EmbedBuilder } from 'discord.js';
import { getTierName, setTierName, getPlayers, getTiers, getTierRows, createTier, deleteTier, setTierEmoji, addPlayer, removePlayer, resetTierList } from '../db.js';

const DEFAULT_EMOJIS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚪', '⚫', '🟤', '⭐'];
const TIER_COLORS = [0xff4655, 0xff9f1c, 0xffd23f, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf1fa8c, 0x495057, 0x9c6644, 0xff70a6];
const MAX_TIERS = 20;

function validTierName(tier) {
  return /^[A-Z0-9+\-]{1,10}$/.test(tier);
}

function validEmoji(emoji) {
  return emoji.length >= 1 && emoji.length <= 50 && !/\s/.test(emoji);
}

export default {
  name: 'tier',
  execute(message, args, client, PREFIX) {
    const sub = (args[0] || 'show').toLowerCase();
    const guildId = message.guild.id;

    if (sub === 'show') {
      const name = getTierName(guildId);
      const rows = getTierRows(guildId);
      const players = getPlayers(guildId);
      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${name}`)
        .setColor(TIER_COLORS[players.length % TIER_COLORS.length])
        .setThumbnail(message.guild.iconURL())
        .setDescription(`Use \`${PREFIX}tier add <TIER> <player>\` to rank a player`)
        .setTimestamp()
        .setFooter({ text: `Total players: ${players.length}` });
      rows.forEach((row, i) => {
        const emoji = row.emoji || DEFAULT_EMOJIS[i % DEFAULT_EMOJIS.length];
        const list = players.filter(p => p.tier === row.tier).map(p => `• ${p.player}`);
        embed.addFields({ name: `${emoji} ${row.tier} (${list.length})`, value: list.length ? list.join('\n') : '_empty_' });
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

    if (sub === 'emoji') {
      const tier = (args[1] || '').toUpperCase();
      const emoji = args[2];
      if (!tier || !emoji) {
        return message.reply(`❌ Usage: \`${PREFIX}tier emoji <TIER> <emoji>\` (or \`clear\` to reset)`);
      }
      if (!getTiers(guildId).includes(tier)) {
        return message.reply(`⚠️ Tier **${tier}** not found!`);
      }
      if (['clear', 'none', 'remove'].includes(emoji.toLowerCase())) {
        setTierEmoji(guildId, tier, null);
        return message.reply(`✅ Cleared custom emoji for Tier **${tier}**!`);
      }
      if (!validEmoji(emoji)) {
        return message.reply(`❌ That doesn't look like an emoji! Send one emoji with no spaces.`);
      }
      setTierEmoji(guildId, tier, emoji);
      return message.reply(`${emoji} Tier **${tier}** emoji set!`);
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

    return message.reply(`❌ Unknown tier command! Try \`${PREFIX}tier show\`, \`create\`, \`delete\`, \`emoji\`, \`add\`, \`remove\`, \`setname\`, \`reset\`.`);
  },
};
