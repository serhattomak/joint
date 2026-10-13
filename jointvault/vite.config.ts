import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    /*
     * `src-tauri/target`, Tauri'nin çıktı klasörüdür ve `extension/` oraya
     * KOPYALANIR (tauri.conf.json → bundle.resources). Vitest varsayılan
     * glob'u oradaki `*.test.mjs` kopyalarını da bulur: testler iki kez koşar
     * ve kopya bayatladığında **yeni kodu değil eski kopyayı** ölçer.
     * Kaynak değildir; dışlanır. (Varsayılan dışlamalar burada tekrarlanır:
     * `exclude` verilince varsayılanlar geçersiz olur.)
     */
    exclude: ['**/node_modules/**', '**/dist/**', '**/src-tauri/**'],
  },
})
