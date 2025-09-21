import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',  // or use './projects/manifest/manifest-ui' if outside
  server: {
    host: '0.0.0.0', // to expose to local network if needed
    port: 5173
  }
})
