import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The repo-root .env is shared by the server and the client (envDir '..').
const envDir = fileURLToPath(new URL('..', import.meta.url));

// Files the dev server may serve outside the client's own folder (via /@fs/...).
// Vite would otherwise allow the whole workspace, and a tunnel would expose the
// answer list (shared/data), the server source and the database to anyone.
const fsAllow = [
  fileURLToPath(new URL('.', import.meta.url)),
  fileURLToPath(new URL('../shared/src', import.meta.url)),
  fileURLToPath(new URL('../node_modules', import.meta.url)),
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const apiTarget = `http://localhost:${env.PORT || '3001'}`;
  const hmrClientPort = Number(env.VITE_HMR_CLIENT_PORT) || undefined;
  const extraHosts = (env.VITE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  // A cloudflared quick tunnel reaches the dev server over HTTP with its own Host header.
  const allowedHosts = ['.trycloudflare.com', ...extraHosts];
  const proxy = { '/api': { target: apiTarget, changeOrigin: true } };

  return {
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      allowedHosts,
      proxy,
      fs: { allow: fsAllow },
      // Behind an HTTPS tunnel (Discord) the browser must reach HMR on 443.
      // Vite 8 name of the (deprecated, auto-synced) server.hmr.clientPort.
      ws: hmrClientPort ? { clientPort: hmrClientPort } : undefined,
    },
    preview: {
      port: 4173,
      allowedHosts,
      proxy,
    },
  };
});
