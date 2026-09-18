/**
 * 知行读书 — 品牌图标构建
 *
 * 唯一真值是 brand/*.svg，resources/ 下的位图与 ICO 全部由此生成，不要手改。
 * 平台图标一律用 mark-icon.svg（满版底板 + 加粗台阶）：标准稿 mark.svg 四周的留白
 * 是按「与其他元素并排」设计的，直缩到 16px 只剩 8px 见方的图形，实测台阶糊成一团。
 */
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = join(ROOT, 'brand')
const OUT = join(ROOT, 'resources')

/** ICO 目录项只有 1 字节存宽高，256 已封顶，更大尺寸不进 ICO */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

function raster(source, size) {
  const svg = readFileSync(join(BRAND, source), 'utf8')
  return new Resvg(svg, { fitTo: { mode: 'zoom', value: size / 48 } }).render().asPng()
}

/**
 * ICO 容器：每个目录项指向一张完整 PNG。
 * 宽高 0 表示 256（1 字节放不下），Windows 与 Electron 均按 PNG 解码。
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const offsetOf = []
  let cursor = 6 + images.length * 16
  for (const img of images) {
    offsetOf.push(cursor)
    cursor += img.png.length
  }

  const entries = images.map((img, i) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0)
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(img.png.length, 8)
    entry.writeUInt32LE(offsetOf[i], 12)
    return entry
  })

  return Buffer.concat([header, ...entries, ...images.map((img) => img.png)])
}

mkdirSync(OUT, { recursive: true })

const images = ICO_SIZES.map((size) => ({ size, png: raster('mark-icon.svg', size) }))

writeFileSync(join(OUT, 'icon.ico'), buildIco(images))
writeFileSync(join(OUT, 'icon.png'), raster('mark-icon.svg', 1024))

console.log(`icon.ico ← mark-icon.svg，${images.length} 档：${ICO_SIZES.join('/')}`)
console.log('icon.png ← mark-icon.svg @1024')
