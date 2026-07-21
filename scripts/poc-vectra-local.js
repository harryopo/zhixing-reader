/**
 * Vectra LocalIndex POC（CommonJS，便于直接 node 跑）
 * 测试内容：创建索引 → 插入向量 → 查询 → 删除 → 统计
 * 不依赖 LocalEmbeddings（避免下载 ONNX 模型），用假向量代替
 */
const path = require('path')
const os = require('os')
const fs = require('fs')
const { LocalIndex } = require('vectra')

function makeVector(seed, dim = 384) {
  // 简单确定性向量生成器
  const v = new Array(dim)
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed * 0.1 + i * 0.01) * 0.5 + 0.5
  }
  // 归一化
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map(x => x / norm)
}

async function main() {
  console.time('total')
  const tmpDir = path.join(os.tmpdir(), `vectra-poc-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  console.log('Index dir:', tmpDir)

  // 1. 创建索引
  const index = new LocalIndex(tmpDir)
  if (!(await index.isIndexCreated())) {
    await index.createIndex({ version: 1, metadata_config: { indexed: ['bookId', 'highlightId'] } })
    console.log('✅ Index created')
  }

  // 2. 插入文档
  const docs = [
    { id: 'h_001', content: '费曼学习法：用最简单的语言讲给外行听', bookId: 'b1', bookTitle: '认知觉醒', highlightId: 'h_001' },
    { id: 'h_002', content: 'SQ3R 读书法：Survey Question Read Recite Review', bookId: 'b1', bookTitle: '认知觉醒', highlightId: 'h_002' },
    { id: 'h_003', content: '番茄工作法：专注 25 分钟休息 5 分钟', bookId: 'b2', bookTitle: '番茄工作法图解', highlightId: 'h_003' },
  ]

  console.time('insert')
  await index.beginUpdate()
  for (let i = 0; i < docs.length; i++) {
    await index.insertItem({
      id: docs[i].id,
      vector: makeVector(i + 1),
      metadata: docs[i],
    })
  }
  await index.endUpdate()
  console.timeEnd('insert')

  // 3. 查询
  console.time('query')
  const results = await index.queryItems(makeVector(1), '费曼 学习 方法', 3)
  console.timeEnd('query')

  console.log('\n📊 Query results:')
  for (const r of results) {
    console.log(`  [score=${r.score.toFixed(3)}] id=${r.item.id} content="${r.item.metadata.content}"`)
  }

  // 4. 带 filter 查询（按 bookId）
  console.time('query_filtered')
  const filtered = await index.queryItems(
    makeVector(1),
    '费曼',
    3,
    { bookId: 'b2' },  // 只查 b2
  )
  console.timeEnd('query_filtered')
  console.log('\n📊 Filtered (bookId=b2):')
  for (const r of filtered) {
    console.log(`  [score=${r.score.toFixed(3)}] id=${r.item.id} bookId="${r.item.metadata.bookId}"`)
  }

  // 5. 统计
  const stats = await index.getIndexStats()
  console.log('\n📈 Stats:', { items: stats.items, vectors: stats.vectors })

  // 6. 删除
  await index.beginUpdate()
  await index.deleteItem('h_001')
  await index.endUpdate()
  const afterDelete = await index.getIndexStats()
  console.log('After delete h_001:', { items: afterDelete.items })

  // 7. upsert（替换）
  await index.beginUpdate()
  await index.upsertItem({
    id: 'h_002',
    vector: makeVector(99),
    metadata: { ...docs[1], content: 'Updated SQ3R' },
  })
  await index.endUpdate()
  const item = await index.getItem('h_002')
  console.log('After upsert h_002:', item?.metadata?.content)

  console.timeEnd('total')
  console.log('\n✅ POC 完成')

  // 清理
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

main().catch(err => {
  console.error('❌ POC failed:', err)
  process.exit(1)
})
