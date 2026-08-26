import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Todo adentro: la version publicable es UN archivo, sin red. El limite
    // alto hace que las fuentes de KaTeX entren al CSS como data URI, y el
    // CSS unico evita que queden hojas sueltas que despues nadie carga.
    assetsInlineLimit: 16 * 1024 * 1024,
    cssCodeSplit: false,
  },
  server: {
    // El motor corre en Python: todo /api va al backend en dev.
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
});
