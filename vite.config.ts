import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read BUILD_ENV from environment variable (default to 'dev')
const BUILD_ENV = process.env.BUILD_ENV || 'dev';

// Map environment to folder name (capitalize first letter)
const envFolder = BUILD_ENV.charAt(0).toUpperCase() + BUILD_ENV.slice(1);
const outDir = `artifacts/${envFolder}`;

console.log(`🏗️  Building for environment: ${BUILD_ENV}`);
console.log(`📁 Output directory: ${outDir}`);

export default defineConfig({
  define: {
    // Make BUILD_ENV available in the extension code
    'import.meta.env.BUILD_ENV': JSON.stringify(BUILD_ENV),
  },
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      closeBundle() {
        // Copy manifest.json to output directory
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, outDir, 'manifest.json')
        );

        // Copy icons folder
        const iconsDir = resolve(__dirname, 'icons');
        const distIconsDir = resolve(__dirname, outDir, 'icons');

        if (existsSync(iconsDir)) {
          if (!existsSync(distIconsDir)) {
            mkdirSync(distIconsDir, { recursive: true });
          }

          // Copy all PNG icons
          const iconFiles = readdirSync(iconsDir).filter((f: string) => f.endsWith('.png'));

          iconFiles.forEach((file: string) => {
            copyFileSync(
              resolve(iconsDir, file),
              resolve(distIconsDir, file)
            );
          });

          console.log(`✓ Copied manifest.json and icons to ${outDir}/`);
        } else {
          console.log(`✓ Copied manifest.json to ${outDir}/`);
        }
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        settings: resolve(__dirname, 'settings.html'),
        background: resolve(__dirname, 'background.ts'),
        content: resolve(__dirname, 'content.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Content and background scripts should be standalone
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name].[ext]',
      },
    },
    outDir,
    emptyOutDir: true,
    minify: false, // Don't minify to avoid single-line issues with Chrome
    sourcemap: false, // Disable source maps to prevent CSP issues
    target: 'es2020', // Use stable target to avoid eval usage
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});
