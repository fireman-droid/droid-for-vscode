import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: { alias: [
    { find: '@droidvisx/chat-ui/styles.css', replacement: local('./packages/chat-ui/dist/styles.css') },
    { find: /^@droidvisx\/chat-ui$/, replacement: local('./packages/chat-ui/src/index.ts') },
    { find: /^@droidvisx\/chat-ui\/(.*)$/, replacement: `${local('./packages/chat-ui/src')}/$1` },
  ] },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'packages/chat-ui/test/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
