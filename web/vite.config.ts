// Mizavo — Vite build settings.
// Each page is its own entry. `npm run build` writes the finished site to dist/,
// and dist/ is what gets uploaded to Cloudflare.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: 'index.html',
        admin: 'admin.html',
        guide: 'guide.html',
        login: 'login-test.html',
        today: 'today.html',
        channel: 'channel.html',
      },
    },
  },
});
