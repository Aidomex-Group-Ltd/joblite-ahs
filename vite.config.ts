import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@worker': resolve(__dirname, 'src/worker'),
      '@client': resolve(__dirname, 'src/client')
    }
  }
})
