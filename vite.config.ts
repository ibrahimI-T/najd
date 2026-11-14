import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// The app loads index.html, the Vue 3 renderer under src/vue (R-079). react.html keeps the previous React renderer buildable as a
// fallback until the owner accepts the Vue one; the app never loads it.
export default defineConfig({
  plugins: [react({ include: /\.tsx$/ }), vue()],
  base: './',
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), react: resolve(__dirname, 'react.html') } } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] }
})
