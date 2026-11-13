import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--test', 'tests/ui-v3.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, SF_BROWSER: '1' },
});
process.exit(result.status ?? 1);
