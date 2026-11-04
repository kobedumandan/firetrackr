import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { selectGoogleMapsKey } from './config/publicGoogleMapsEnv.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const frontendDir = fileURLToPath(new URL('.', import.meta.url))
  const backendDir = fileURLToPath(new URL('../backend', import.meta.url))
  const apiTarget = loadEnv(mode, frontendDir, 'VITE_API_BASE_URL').VITE_API_BASE_URL?.trim().replace(/\/+$/, '')
    || 'http://127.0.0.1:8000'
  // Expose this public browser key only, never the rest of backend/.env.
  const prefixes = ['VITE_GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'next_public_google_maps_api_key']
  const key = selectGoogleMapsKey(
    loadEnv(mode, frontendDir, prefixes),
    loadEnv(mode, backendDir, prefixes),
  )
  return {
    plugins: [react()],
    define: { 'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(key) },
    server: {
      proxy: {
        '/health': { target: apiTarget, changeOrigin: true, headers: { 'ngrok-skip-browser-warning': '1' } },
        '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/uploads': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
      },
    },
  }
})
