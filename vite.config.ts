import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * 工作路线 · 独立的行动路线网页。
 *
 * 和后端/模型彻底解耦：没有 /api、没有 key，所有数据都在浏览器本地。
 * 想换电脑/换浏览器，用右栏的「导出数据 / 导入数据」搬。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5174, host: '127.0.0.1' },
})
