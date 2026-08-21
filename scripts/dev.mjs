import { spawn } from 'node:child_process';

const processes = [
  spawn('tsx', ['watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn('vite', [], { stdio: 'inherit' }),
];

let stopping = false;
const stop = (signal = 'SIGTERM') => {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill(signal);
};

for (const child of processes) {
  child.on('exit', (code) => {
    stop();
    process.exitCode = Math.max(process.exitCode ?? 0, code ?? 0);
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
