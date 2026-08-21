import { spawnSync } from 'node:child_process';

const result = spawnSync('git', [
  'grep', '-nEI',
  '(sk_(live|test)_[A-Za-z0-9]{16,}|rk_(live|test)_[A-Za-z0-9]{16,}|QONTO_API_SECRET=[^[:space:]]{8,}|QONTO_ACCESS_TOKEN=[^[:space:]]{8,})',
  '--', ':!package-lock.json', ':!scripts/check-secrets.mjs',
], { encoding: 'utf8' });

if (result.status === 0 && result.stdout.trim()) {
  console.error('Secret potentiel détecté :\n' + result.stdout);
  process.exit(1);
}

if (result.status !== 0 && result.status !== 1) {
  console.error(result.stderr || 'Impossible de vérifier les secrets.');
  process.exit(result.status || 2);
}
