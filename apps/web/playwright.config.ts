import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3123', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 3123', url: 'http://127.0.0.1:3123', reuseExistingServer: false,
    env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:8182', NEXT_PUBLIC_KEYCLOAK_URL: 'http://127.0.0.1:8181', NEXT_PUBLIC_KEYCLOAK_REALM: 'prohodnaya', NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: 'web' },
  },
});
