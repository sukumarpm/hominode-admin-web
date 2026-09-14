import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(({ mode, command }) => {
  if (mode === 'browser-test' && command === 'build')
    throw Error('The offline browser harness cannot be built for production.');
  return {
    plugins: [
      react(),
      ...(mode === 'browser-test'
        ? [
            {
              name: 'offline-browser-harness',
              enforce: 'pre' as const,
              resolveId(source: string, importer?: string) {
                if (importer?.includes('/src/') && ['./data', './firebase'].includes(source))
                  return resolve('e2e/' + source.slice(2) + '.ts');
              },
              configureServer(server: {
                middlewares: {
                  use: (
                    handler: (
                      req: { headers: { accept?: string }; url?: string },
                      res: unknown,
                      next: () => void,
                    ) => void,
                  ) => void;
                };
              }) {
                server.middlewares.use((req, _res, next) => {
                  if (req.headers.accept?.includes('text/html')) req.url = '/e2e/harness.html';
                  next();
                });
              },
            },
          ]
        : []),
    ],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      exclude: ['e2e/**', 'node_modules/**'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'firebase-core': ['firebase/app'],
            'firebase-auth': ['firebase/auth'],
            'firebase-firestore': ['firebase/firestore'],
            'firebase-services': ['firebase/functions', 'firebase/app-check', 'firebase/storage'],
            react: ['react', 'react-dom/client', 'react-router-dom'],
          },
        },
      },
    },
  };
});
