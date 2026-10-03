import { EmbedBuilder } from 'discord.js';

export default {
  name: 'help',
  execute(message, args, client, PREFIX) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Commands')
      .setColor(0x5865f2)
      .setDescription([
        `\`${PREFIX}ping\` - Check bot latency`,
        `\`${PREFIX}8ball <question>\` - Ask the magic 8-ball`,
        `\`${PREFIX}roll [number]\` - Roll a dice`,
        `\`${PREFIX}joke\` - Get a random joke`,
        `\`${PREFIX}ai <question>\` - Ask the AI`,
        `\`${PREFIX}say <text>\` - Make the bot say something`,
        `\`${PREFIX}userinfo [@user]\` - Info about a user`,
        `\`${PREFIX}serverinfo\` - Info about this server`,
        `\`${PREFIX}avatar [@user]\` - Get someone's avatar`,
        `\`${PREFIX}clear <amount>\` - Delete messages (mods)`,
        `\`${PREFIX}tier show\` - Show the tier list`,
        `\`${PREFIX}tier create <NAME>\` - Create a new tier`,
        `\`${PREFIX}tier delete <NAME>\` - Delete a tier`,
        `\`${PREFIX}tier emoji <TIER> <emoji>\` - Set tier emoji`,
        `\`${PREFIX}tier add <TIER> <player>\` - Add player to a tier`,
        `\`${PREFIX}tier remove <TIER> <player>\` - Remove player`,
        `\`${PREFIX}tier setname <name>\` - Rename the tier list`,
        `\`${PREFIX}tier reset\` - Clear the tier list`,
        ``,
        `**🔌 AI Connect (both \`!connect\` and \`!!connect\` work):**`,
        `\`!!connect login [openrouter|google|huggingface|github]\` - Log in on site, no key needed`,
        `\`!!connect models [search]\` - List free OpenRouter models`,
        `\`/connect model\` - Pick a free model from the dropdown`,
        `\`!ai coding on\` - Coding agent: file create, zip/unzip, MCP (tools only, auto by default)`,
        `\`!ai forget\` - Erase chat memory on this server`,
        `\`!!connect code <CODE>\` - Paste the OpenRouter code to connect`,
        `\`!!connect status\` - Show AI mode`,
        `\`!ai panel create\` - AI panel (mods) | \`!ai new/my/close\``,
        `\`/ai /aipanel /ainew /aiclose /connect /tier /mcp\` - Slash too`,
        `\`!!connect auth <CODE>\` - Unlock free AI with owner code`,
        `\`/join <8-digit-code>\` - Join with an admin-panel code (admin codes grant management too)`,
        `\`!!connect gemini <KEY> [model]\` - Connect Gemini (https://aistudio.google.com/apikey)`,
        `\`!!connect openai|groq|openrouter|deepseek <KEY> [model]\` - More platforms`,
        `\`!!connect huggingface|xai|cerebras|fireworks <KEY> [model]\` - More platforms`,
        `\`!!connect together|mistral|github-models <KEY> [model]\` - More platforms`,
        `\`!!connect api <URL> <KEY> [model]\` - Custom URL (mods)`,
        `\`!!connect free\` - Back to free AI (mods)`,
      ].join('\n'))
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  },
};
