import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'packages/chat-ui/test/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
