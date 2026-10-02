// Watchdog: keeps the bot alive. Restarts index.js if it ever exits/crashes.
import { spawn } from 'node:child_process';

function launch() {
  const child = spawn(process.execPath, ['index.js'], { stdio: 'inherit' });
  child.on('exit', code => {
    console.log(`[watchdog] bot exited with code ${code}, restarting in 5s...`);
    setTimeout(launch, 5000);
  });
  child.on('error', err => {
    console.error('[watchdog] failed to start bot:', err.message);
    setTimeout(launch, 5000);
  });
}

console.log('[watchdog] starting bot...');
launch();
