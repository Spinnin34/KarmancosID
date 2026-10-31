// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

import vue from '@astrojs/vue';

import tailwindcss from '@tailwindcss/vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const identityApi = process.env.IDENTITY_API_TARGET ?? 'http://localhost:8080';

// https://astro.build/config
export default defineConfig({
  integrations: [vue()],
  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': srcDir }
    },
    server: {
      proxy: {
        '/api': { target: identityApi },
        '/oauth2': { target: identityApi },
        '/.well-known': { target: identityApi },
        '/userinfo': { target: identityApi },
        '/connect': { target: identityApi }
      }
    }
  }
});
