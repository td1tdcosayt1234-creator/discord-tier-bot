// Watchdog: keeps the bot alive. Restarts index.js on crash with backoff.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'index.js');

let child = null;
let failures = 0;
let restarting = false;
let stopped = false;

function launch() {
  if (stopped || restarting) return;
  restarting = false;
  console.log('[watchdog] starting bot...');
  child = spawn(process.execPath, [ENTRY], { stdio: 'inherit', cwd: __dirname });
  child.on('exit', code => {
    child = null;
    if (stopped) return;
    // clean exit (0) = do not restart; config errors exit fast repeatedly -> backoff
    if (code === 0) {
      console.log('[watchdog] bot exited cleanly, not restarting.');
      return;
    }
    failures++;
    const delay = Math.min(5000 * failures, 60000);
    console.log(`[watchdog] bot exited with code ${code}, restarting in ${Math.round(delay / 1000)}s... (failure #${failures})`);
    if (failures > 10) {
      console.error('[watchdog] too many restarts, giving up. Fix the error above.');
      process.exit(1);
    }
    restarting = true;
    setTimeout(() => { restarting = false; launch(); }, delay);
  });
  child.on('error', err => {
    console.error('[watchdog] failed to start bot:', err.message);
    if (!restarting) {
      restarting = true;
      setTimeout(() => { restarting = false; launch(); }, 5000);
    }
  });
}

// reset failure counter on healthy run
setInterval(() => { if (child) failures = 0; }, 5 * 60 * 1000).unref?.();

function shutdown(sig) {
  stopped = true;
  console.log(`[watchdog] ${sig}, stopping child...`);
  try { child?.kill(sig); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 3000).unref?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

launch();
