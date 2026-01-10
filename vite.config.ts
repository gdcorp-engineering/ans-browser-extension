import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';

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
        // Ensure output directory exists first
        const outputDirPath = resolve(__dirname, outDir);
        if (!existsSync(outputDirPath)) {
          mkdirSync(outputDirPath, { recursive: true });
        }
        
        // Copy manifest.json to output directory
        const manifestPath = resolve(__dirname, 'manifest.json');
        const outputManifestPath = resolve(outputDirPath, 'manifest.json');
        
        if (existsSync(manifestPath)) {
          copyFileSync(manifestPath, outputManifestPath);
        } else {
          console.error(`❌ Error: manifest.json not found at ${manifestPath}`);
          throw new Error(`manifest.json not found at ${manifestPath}`);
        }

        // Copy icons folder
        const iconsDir = resolve(__dirname, 'icons');
        const distIconsDir = resolve(__dirname, outDir, 'icons');

        if (existsSync(iconsDir)) {
          if (!existsSync(distIconsDir)) {
            mkdirSync(distIconsDir, { recursive: true });
          }

          // Copy all PNG and SVG icons
          const iconFiles = readdirSync(iconsDir).filter((f: string) => 
            f.endsWith('.png') || f.endsWith('.svg')
          );

          iconFiles.forEach((file: string) => {
            // Security: Validate file name to prevent path traversal
            if (file.includes('..') || file.includes('/') || file.includes('\\') || file.length > 255) {
              console.warn(`⚠️  Skipping invalid file name: ${file}`);
              return;
            }
            // Security: Resolve paths and verify they're within expected directories
            // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
            const sourcePath = resolve(iconsDir, file);
            // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
            const destPath = resolve(distIconsDir, file);
            // Verify resolved paths are within expected directories
            if (!sourcePath.startsWith(resolve(__dirname, 'icons')) || 
                !destPath.startsWith(resolve(__dirname, outDir, 'icons'))) {
              console.warn(`⚠️  Skipping file with path traversal attempt: ${file}`);
              return;
            }
            copyFileSync(sourcePath, destPath);
          });

          console.log(`✓ Copied manifest.json and icons to ${outDir}/`);
        } else {
          console.log(`✓ Copied manifest.json to ${outDir}/`);
        }

        // Copy installer.html to output directory for easy distribution
        const installerPath = resolve(__dirname, 'installer.html');
        if (existsSync(installerPath)) {
          copyFileSync(
            installerPath,
            resolve(__dirname, outDir, 'INSTALL_INSTRUCTIONS.html')
          );
          console.log(`✓ Copied installation instructions to ${outDir}/`);
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
        offscreen: resolve(__dirname, 'offscreen.html'),
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
