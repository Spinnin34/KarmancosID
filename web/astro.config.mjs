// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

import vercel from '@astrojs/vercel';
import vue from '@astrojs/vue';

import tailwindcss from '@tailwindcss/vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [vue()],
  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],
    resolve: { alias: { '@': srcDir } }
  }
});
