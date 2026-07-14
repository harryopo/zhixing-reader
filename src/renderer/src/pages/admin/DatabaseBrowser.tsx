import { useState, useEffect, useMemo } from 'react'

interface TableSchema {
  name: string
  sql: string
}

interface TableData {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '...' : v
  if (typeof v === 'number') return v.toLocaleString()
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80)
  return String(v)
}

function getColumnType(sql: string, colName: string): string {
  const match = sql.match(new RegExp(`${colName}\\s+([A-Z]+(\\([^)]+\\))?)\\s`, 'i'))
  return match ? match[1] : 'TEXT'
}

export default function DatabaseBrowser() {
  const [schema, setSchema] = useState<TableSchema[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [data, setData] = useState<TableData | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const pageSize = 30

  useEffect(() => {
    loadSchema()
  }, [])

  const loadSchema = async () => {
    try {
      const result = await window.electronAPI.admin.getDatabaseSchema()
      const tables = Array.isArray(result) ? result : []
      setSchema(tables)
      if (tables.length > 0 && !selectedTable) {
        setSelectedTable(tables[0].name)
      }
      if (tables.length === 0) {
        console.warn('[DatabaseBrowser] 未加载到任何表')
      }
    } catch (err) {
      console.error('加载表结构失败:', err)
    }
  }

  useEffect(() => {
    if (selectedTable) {
      loadTableData()
    }
  }, [selectedTable, page])

  const loadTableData = async () => {
    if (!selectedTable) return
    setLoading(true)
    try {
      const result = await window.electronAPI.admin.getTableData(selectedTable, pageSize, page * pageSize)
      const tableData = result || { columns: [], rows: [], total: 0 }
      setData(tableData)
      if (tableData.rows.length === 0) {
        console.warn(`[DatabaseBrowser] 表 ${selectedTable} 无数据`)
      }
    } catch (err) {
      console.error('加载表数据失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredRows = useMemo(() => {
    if (!data || !search.trim()) return data?.rows || []
    const q = search.toLowerCase()
    return data.rows.filter(row =>
      Object.values(row).some(v => String(v).toLowerCase().includes(q))
    )
  }, [data, search])

  const currentSchema = useMemo(() => schema.find(s => s.name === selectedTable), [schema, selectedTable])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">数据库浏览器</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            共 {schema.length} 张表 · 当前查看: {selectedTable || '未选择'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3 bg-white rounded-xl border border-gray-100 p-2 max-h-[600px] overflow-y-auto">
          {schema.map(t => (
            <button
              key={t.name}
              onClick={() => { setSelectedTable(t.name); setPage(0) }}
              className={`w-full text-left px-2.5 py-1.5 text-[12px] rounded-md transition-colors ${
                selectedTable === t.name
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div className="col-span-9 space-y-3">
          {currentSchema && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-[12px] font-semibold text-gray-700 mb-2">表结构</h3>
              <pre className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-600 font-mono overflow-x-auto max-h-40 overflow-y-auto">
                {currentSchema.sql}
              </pre>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[13px] font-semibold text-gray-800">数据</h3>
                {data && (
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    共 {data.total} 条 · 当前第 {page * pageSize + 1}-{Math.min((page + 1) * pageSize, data.total)} 条
                  </p>
                )}
              </div>
              <input
                type="text"
                placeholder="筛选..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="px-2.5 py-1 text-[11px] bg-gray-50 border border-gray-200 rounded-md outline-none focus:border-indigo-400 w-40"
              />
            </div>

            {loading ? (
              <div className="py-12 text-center text-gray-300 text-sm">加载中...</div>
            ) : !data || data.rows.length === 0 ? (
              <div className="py-12 text-center text-gray-300 text-sm">无数据</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {data.columns.map(col => (
                        <th key={col} className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">
                          {col}
                          {currentSchema && (
                            <span className="text-[9px] text-gray-300 ml-1">({getColumnType(currentSchema.sql, col)})</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                        {data.columns.map(col => (
                          <td key={col} className="py-1.5 px-2 text-gray-700 max-w-xs truncate" title={String(row[col] ?? '')}>
                            {formatCell(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.total > pageSize && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 text-[11px] text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  ← 上一页
                </button>
                <span className="text-[11px] text-gray-400">
                  第 {page + 1} / {Math.ceil(data.total / pageSize)} 页
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * pageSize >= data.total}
                  className="px-3 py-1 text-[11px] text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  下一页 →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
