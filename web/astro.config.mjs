// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

import vercel from '@astrojs/vercel';
import vue from '@astrojs/vue';

import tailwindcss from '@tailwindcss/vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const envDir = fileURLToPath(new URL('.', import.meta.url));
const loadedEnvironment = loadEnv(process.env.NODE_ENV || 'development', envDir, '');
for (const [key, value] of Object.entries(loadedEnvironment)) process.env[key] ??= value;
const identityApi = process.env.IDENTITY_API_TARGET;

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [vue()],
  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': srcDir }
    },
    ...(identityApi ? { server: {
      proxy: {
        '/api': { target: identityApi },
        '/oauth2': { target: identityApi },
        '/.well-known': { target: identityApi },
        '/userinfo': { target: identityApi },
        '/connect': { target: identityApi }
      }
    } } : {})
  }
});
