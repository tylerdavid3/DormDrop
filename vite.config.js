import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

function copySchoolScripts() {
  return {
    name: 'copy-school-scripts',
    closeBundle() {
      ['bu', 'neu', 'merrimack'].forEach(function (dir) {
        mkdirSync(resolve(__dirname, 'dist', dir), { recursive: true });
        copyFileSync(
          resolve(__dirname, dir, 'firebase-config.js'),
          resolve(__dirname, 'dist', dir, 'firebase-config.js')
        );
        copyFileSync(
          resolve(__dirname, dir, 'roommates.js'),
          resolve(__dirname, 'dist', dir, 'roommates.js')
        );
      });
      // Copy landlord portal (compat SDK — not processed by Vite bundler)
      mkdirSync(resolve(__dirname, 'dist', 'landlord'), { recursive: true });
      ['index.html', 'landlord.js', 'firebase-config.js'].forEach(function (f) {
        copyFileSync(
          resolve(__dirname, 'landlord', f),
          resolve(__dirname, 'dist', 'landlord', f)
        );
      });
    }
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [copySchoolScripts()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bu: resolve(__dirname, 'bu/index.html'),
        neu: resolve(__dirname, 'neu/index.html'),
        merrimack: resolve(__dirname, 'merrimack/index.html'),
        profileSetup: resolve(__dirname, 'profile-setup.html'),
        discover: resolve(__dirname, 'discover.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        messages: resolve(__dirname, 'messages.html'),
        landlordDashboard: resolve(__dirname, 'landlord-dashboard.html'),
        landlordSignup: resolve(__dirname, 'landlord-signup.html')
      }
    }
  },
  server: {
    port: 5173
  }
});
