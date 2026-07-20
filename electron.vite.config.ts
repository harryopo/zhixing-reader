import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          // 让 manualChunks 的 chunk 名稳定
          chunkFileNames: 'assets/[name]-[hash].js',
          // 手动分包：把 echarts 单独切出，admin chunk 只保留业务代码
          // 目标：admin 页 admin-charts.tsx 业务代码 < 50KB
          manualChunks(id) {
            if (id.includes('echarts') || id.includes('zrender')) {
              return 'echarts-vendor'
            }
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) {
              return 'recharts-vendor'
            }
            if (id.includes('sql.js')) {
              return 'sqljs-vendor'
            }
            return undefined
          }
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    server: {
      port: 5176
    }
  }
})
