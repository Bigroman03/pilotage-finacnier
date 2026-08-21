import { spawnSync } from 'node:child_process';

const result = spawnSync('git', [
  'grep', '-nEI',
  '(sk_live_|sk_test_|rk_live_|rk_test_|QONTO_API_SECRET=.{8}|QONTO_ACCESS_TOKEN=.{8})',
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
