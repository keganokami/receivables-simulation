import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// devサーバに POST /api/report を追加。
// アプリの「レポート出力」ボタンから現在の設定を受け取り、レポートを生成し、
// 生成したPDFのバイト列をそのまま返す（ブラウザ側で自動ダウンロード）。
// Claude不要で十数秒で完了するため、同期的に生成→返却する方式。
function reportPlugin(): PluginOption {
  return {
    name: 'report-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/report', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const root = process.cwd()
          const outDir = join(root, 'reports')
          if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
          const cfgPath = join(outDir, 'last-config.json')
          writeFileSync(cfgPath, body || '{}', 'utf8')

          const before = new Set(readdirSync(outDir).filter((f) => f.endsWith('.pdf')))

          // 非同期 spawn（イベントループを止めない）。NODE_OPTIONS は空にして preload エラーを回避。
          const child = spawn('npm', ['run', 'report', '--', '--config', cfgPath], {
            cwd: root,
            env: { ...process.env, NODE_OPTIONS: '' },
          })
          let stderr = ''
          child.stderr.on('data', (d) => (stderr += d))
          child.on('error', (err) => {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: String(err) }))
          })
          child.on('close', (code) => {
            if (code !== 0) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: stderr.slice(-500) || `exit ${code}` }))
              return
            }
            // 生成された最新PDFを特定（新規 or 最も新しい mtime）
            const pdfs = readdirSync(outDir)
              .filter((f) => f.endsWith('.pdf'))
              .map((f) => ({ f, t: statSync(join(outDir, f)).mtimeMs, isNew: !before.has(f) }))
              .sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.t - a.t)
            if (pdfs.length === 0) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: 'PDFが生成されませんでした' }))
              return
            }
            const buf = readFileSync(join(outDir, pdfs[0].f))
            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader('X-Report-Filename', encodeURIComponent(pdfs[0].f))
            res.end(buf)
          })
        })
      })
    },
  }
}

// 静的配信できるよう base は相対パスにしておく（理事会への共有・ローカル配布が楽）
export default defineConfig({
  base: './',
  plugins: [react(), reportPlugin()],
})
