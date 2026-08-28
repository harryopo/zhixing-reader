import { useState, useEffect, useMemo } from 'react'
import { PromptWithOverride, PromptVariable } from '../../../../types/renderer'

const CATEGORY_LABELS: Record<string, string> = {
  agent: '智能体',
  intent: '意图识别',
  ai: 'AI 功能',
}

const CATEGORY_COLORS: Record<string, string> = {
  agent: 'bg-violet-50 text-violet-600 border-violet-200',
  intent: 'bg-amber-50 text-amber-600 border-amber-200',
  ai: 'bg-emerald-50 text-emerald-600 border-emerald-200',
}

const ROLE_LABELS: Record<string, string> = {
  system: '系统提示',
  user: '用户消息',
}

function _renderPreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key]
    return v && v.trim() ? v : `{{${key}}}`
  })
}

function highlightPreview(template: string, vars: Record<string, string>): Array<{ text: string; isVariable: boolean; isFilled: boolean; name?: string }> {
  const parts: Array<{ text: string; isVariable: boolean; isFilled: boolean; name?: string }> = []
  const regex = /\{\{(\w+)\}\}/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: template.slice(lastIndex, match.index), isVariable: false, isFilled: false })
    }
    const filled = vars[match[1]] && vars[match[1]].trim()
    parts.push({ text: filled || match[0], isVariable: true, isFilled: !!filled, name: match[1] })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < template.length) {
    parts.push({ text: template.slice(lastIndex), isVariable: false, isFilled: false })
  }
  return parts
}

export default function PromptCenter() {
  const [prompts, setPrompts] = useState<PromptWithOverride[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [vars, setVars] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const loadPrompts = async () => {
    try {
      const data = await window.electronAPI.admin.getPrompts()
      const prompts = Array.isArray(data) ? data : []
      setPrompts(prompts)
      if (prompts.length > 0 && !selectedId) {
        setSelectedId(prompts[0].id)
      }
      if (prompts.length === 0) {
        setMessage({ type: 'error', text: '未加载到任何提示词，请检查后端日志' })
      }
    } catch (err) {
      console.error('加载提示词失败:', err)
      setMessage({ type: 'error', text: `加载失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  useEffect(() => {
    loadPrompts()
  }, [])

  const selected = useMemo(() => prompts.find(p => p.id === selectedId) || null, [prompts, selectedId])

  useEffect(() => {
    if (selected) {
      setDraft(selected.currentTemplate)
      setVars({ ...selected.exampleVars })
    }
  }, [selectedId])

  const filtered = useMemo(() => {
    let result = prompts
    if (activeCategory !== 'all') {
      result = result.filter(p => p.category === activeCategory)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      )
    }
    return result
  }, [prompts, search, activeCategory])

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const result = await window.electronAPI.admin.savePrompt(selected.id, draft)
      if (result) {
        setMessage({ type: 'success', text: '已保存，下次对话生效' })
        await loadPrompts()
        setTimeout(() => setMessage(null), 3000)
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!selected) return
    if (!confirm(`确定恢复「${selected.title}」到默认值？`)) return
    try {
      await window.electronAPI.admin.resetPrompt(selected.id)
      setMessage({ type: 'success', text: '已恢复默认' })
      await loadPrompts()
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    }
  }

  const handleResetAll = async () => {
    if (!confirm('确定恢复所有提示词到默认值？此操作不可撤销。')) return
    try {
      const result = await window.electronAPI.admin.resetAllPrompts()
      setMessage({ type: 'success', text: `已恢复 ${(result as { count?: number } | null)?.count ?? 0} 个提示词到默认` })
      await loadPrompts()
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    }
  }

  const handleExport = async () => {
    try {
      const json = await window.electronAPI.admin.exportPrompts()
      const blob = new Blob([typeof json === 'string' ? json : JSON.stringify(json, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `prompts-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ type: 'success', text: '已导出到下载目录' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const result = await window.electronAPI.admin.importPrompts(text) as { success?: boolean; imported?: number; error?: string } | null
        if (result?.success) {
          setMessage({ type: 'success', text: `已导入 ${result.imported} 个提示词` })
          await loadPrompts()
          setTimeout(() => setMessage(null), 3000)
        } else {
          setMessage({ type: 'error', text: result?.error || '导入失败' })
        }
      } catch (err) {
        setMessage({ type: 'error', text: String(err) })
      }
    }
    input.click()
  }

  const previewParts = useMemo(() => selected ? highlightPreview(draft, vars) : [], [selected, draft, vars])

  const stats = useMemo(() => ({
    total: prompts.length,
    custom: prompts.filter(p => p.isCustom).length,
  }), [prompts])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">AI 提示词中心</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            管理 {stats.total} 个提示词 · 已自定义 {stats.custom} 个
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleImport} className="px-2.5 py-1 text-[11px] text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            导入
          </button>
          <button onClick={handleExport} className="px-2.5 py-1 text-[11px] text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            导出
          </button>
          <button onClick={handleResetAll} className="px-2.5 py-1 text-[11px] text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50">
            全部恢复
          </button>
        </div>
      </div>

      {message && (
        <div className={`px-3 py-2 text-[12px] rounded-lg border ${
          message.type === 'success'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="p-3 border-b border-gray-100 space-y-2">
            <input
              type="text"
              placeholder="搜索提示词..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-2.5 py-1.5 text-[12px] bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none"
            />
            <div className="flex gap-1">
              {['all', 'agent', 'intent', 'ai'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                    activeCategory === cat
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {cat === 'all' ? '全部' : CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-gray-300 text-xs">未找到</div>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 transition-colors ${
                    selectedId === p.id ? 'bg-emerald-50/60' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[12px] font-medium text-gray-800 truncate">{p.title}</span>
                        {p.isCustom && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="已自定义"></span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`inline-block px-1.5 py-0 text-[10px] rounded border ${CATEGORY_COLORS[p.category]}`}>
                          {CATEGORY_LABELS[p.category]}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {ROLE_LABELS[p.role] || p.role}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="col-span-8 space-y-3">
          {!selected ? (
            <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-300 text-sm">
              ← 选择左侧的提示词
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-gray-800">{selected.title}</h3>
                    <p className="text-[12px] text-gray-500 mt-1">{selected.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded border ${CATEGORY_COLORS[selected.category]}`}>
                        {CATEGORY_LABELS[selected.category]}
                      </span>
                      <span className="text-[10px] text-gray-400">id: {selected.id}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      className="px-2.5 py-1 text-[11px] text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      恢复默认
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || draft === selected.currentTemplate}
                      className="px-3 py-1 text-[11px] text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>

                {selected.variables.length > 0 && (
                  <div className="mb-3 p-2.5 bg-amber-50/50 border border-amber-200/50 rounded-lg">
                    <p className="text-[10px] font-medium text-amber-700 mb-1.5">可用变量（点击插入到光标位置）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.variables.map((v: PromptVariable) => (
                        <button
                          key={v.name}
                          onClick={() => {
                            setDraft(d => d + `{{${v.name}}}`)
                          }}
                          className="px-2 py-0.5 text-[10px] bg-white border border-amber-200 text-amber-700 rounded hover:bg-amber-100"
                          title={v.description}
                        >
                          {`{{${v.name}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  className="w-full h-64 px-3 py-2 text-[12px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 resize-none font-mono leading-relaxed"
                  placeholder="输入提示词模板..."
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  {draft === selected.currentTemplate ? '已保存' : '未保存的修改'} · 使用 <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">{'{{变量名}}'}</code> 语法插入变量
                </p>
              </div>

              {selected.variables.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <h4 className="text-[12px] font-semibold text-gray-700 mb-2">变量预览</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selected.variables.map((v: PromptVariable) => (
                      <div key={v.name}>
                        <label className="text-[10px] text-gray-500 block mb-0.5">
                          <code className="text-emerald-600">{`{{${v.name}}}`}</code> · {v.description}
                        </label>
                        <input
                          type="text"
                          value={vars[v.name] || ''}
                          onChange={e => setVars(prev => ({ ...prev, [v.name]: e.target.value }))}
                          placeholder={v.sample}
                          className="w-full px-2 py-1 text-[11px] bg-gray-50 border border-gray-200 rounded outline-none focus:border-emerald-400"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <h4 className="text-[12px] font-semibold text-gray-700 mb-2">渲染预览</h4>
                <div className="px-3 py-2 bg-gradient-to-br from-emerald-50/50 to-emerald-50/30 border border-emerald-100 rounded-lg text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                  {previewParts.map((part, i) => (
                    <span
                      key={i}
                      className={
                        part.isVariable
                          ? part.isFilled
                            ? 'bg-emerald-100 text-emerald-700 px-0.5 rounded'
                            : 'bg-rose-100 text-rose-700 px-0.5 rounded font-bold'
                          : ''
                      }
                    >
                      {part.text}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">
                  <span className="inline-block w-2 h-2 bg-emerald-100 border border-emerald-200 rounded-sm mr-1 align-middle"></span>
                  已填值的变量
                  <span className="inline-block w-2 h-2 bg-rose-100 border border-rose-200 rounded-sm ml-2 mr-1 align-middle"></span>
                  未填值（发送时会保留为 <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">{'{{var}}'}</code>）
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
