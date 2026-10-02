import { JOKES } from '../data.js';

export default {
  name: 'joke',
  execute(message) {
    return message.reply(JOKES[Math.floor(Math.random() * JOKES.length)]);
  },
};
