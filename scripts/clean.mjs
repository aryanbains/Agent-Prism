import { rmSync } from 'node:fs';

for (const path of ['dist', 'coverage', 'playwright-report', 'test-results']) {
  rmSync(path, { recursive: true, force: true });
}

for (const path of ['packages/agent-prism/dist', 'packages/dashboard/dist']) {
  rmSync(path, { recursive: true, force: true });
}