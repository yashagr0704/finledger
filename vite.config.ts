import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Single-file builds (VITE_ROUTER=memory) are used for sandboxed hosted previews.
const singleFile = process.env.VITE_ROUTER === 'memory';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: singleFile
        ? { inlineDynamicImports: true }
        : {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover', '@radix-ui/react-tooltip', '@radix-ui/react-checkbox', 'sonner', 'lucide-react'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod', 'date-fns'],
        },
          },
    },
  },
});
