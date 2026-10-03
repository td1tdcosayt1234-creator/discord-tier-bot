import { workspaceFiles } from '../agent.js';

export default {
  name: 'files',
  async execute(message, args) {
    const q = args.join(' ').trim().replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 200);
    let rows = workspaceFiles(message.guild.id);
    if (q) {
      const dir = q.replace(/\/+$/, '');
      rows = rows.filter(f => f === dir || f.startsWith(`${dir}/`));
    }
    if (!rows.length) {
      return message.reply('📁 Workspace empty! Turn on `!ai coding on` and ask the AI to create something.');
    }
    const list = rows.slice(0, 40).map(f => `• \`${f}\``).join('\n').slice(0, 1800);
    return message.reply(
      `📁 Workspace files${q ? ` under \`${q}\`` : ''}:\n${list}${rows.length > 40 ? `\n…+${rows.length - 40} more` : ''}\nDownload: \`!get <path>\``
    );
  },
};
