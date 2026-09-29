/**
 * 「出自哪条划线」区块 —— 知识卡片与方法论详情共用一份。
 *
 * 出处 id 早就写在库里（knowledge_cards.source_highlight_id /
 * methodologies.source_highlight_ids，2026-09-16 补的数据血缘），但界面上
 * 从来没有露过面：用户看着一段 AI 解读，不知道它凭的是哪条划线，也没法回去看语境。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { sourceHighlightLink } from '../../../shared/source-anchor'
import { mapHighlight } from '../utils/db-mapper'

/** 一次最多拉几条：方法论的 ids 可能有几十个，全查会变成一屏按钮 */
const MAX_SHOWN = 3

interface SourceLine {
  id: string
  content: string
  chapterTitle: string
}

function excerpt(text: string, max = 96): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export function SourceHighlights({
  bookId,
  highlightIds,
}: {
  bookId: string
  highlightIds: string[]
}) {
  const navigate = useNavigate()
  const [lines, setLines] = useState<SourceLine[]>([])
  const [lostCount, setLostCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const allIds = highlightIds.filter(Boolean)
  const ids = allIds.slice(0, MAX_SHOWN)
  const key = ids.join(',')

  useEffect(() => {
    let alive = true
    setLines([])
    setLostCount(0)
    setFailedCount(0)
    if (!key) return
    void (async () => {
      /*
        三件事必须分得开：读到了 / 库里确实没有这一条 / 这一次没读成功。
        原来 `catch` 与"交回空"合成了一个 `null`，于是通道报错时界面对用户说
        「原始划线已经不在了」—— 那是一条关于他自己数据的假话（划线可能好好的，
        只是这一次没读出来），本项目在检索那两路已经治过同一个形状。
      */
      const rows = await Promise.all(
        key.split(',').map(async (id) => {
          try {
            const raw = await window.electronAPI.highlight.getById(id)
            return { id, row: raw ? mapHighlight(raw) : null, failed: false }
          } catch {
            return { id, row: null, failed: true }
          }
        }),
      )
      if (!alive) return
      const found: SourceLine[] = []
      let lost = 0
      let failed = 0
      rows.forEach((r) => {
        if (r.failed) failed++
        else if (!r.row) lost++
        else found.push({ id: r.id, content: r.row.content, chapterTitle: r.row.chapterTitle })
      })
      setLines(found)
      setLostCount(lost)
      setFailedCount(failed)
    })()
    return () => {
      alive = false
    }
  }, [key])

  // 没有出处（历史数据里那批从没写进 source_highlight_id 的）就不占地方，
  // 也不编一句"来源不明"给用户看 —— 那是一条谁也不需要知道的提示。
  if (ids.length === 0) return null

  return (
    <section
      style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}
    >
      <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
        {`出自你的划线${allIds.length > MAX_SHOWN ? `（前 ${MAX_SHOWN} 条）` : ''}`}
      </span>
      {lines.map((line) => (
        <div
          key={line.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'calc(var(--spacing) * 3)',
            padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--muted)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {line.chapterTitle && (
              <div style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', marginBottom: 2 }}>
                {line.chapterTitle}
              </div>
            )}
            <p
              style={{
                margin: 0,
                fontSize: '0.82rem',
                lineHeight: 1.6,
                fontStyle: 'italic',
                color: 'var(--card-foreground)',
              }}
            >
              {excerpt(line.content) || '（这条划线没有正文）'}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate(sourceHighlightLink({ bookId, highlightId: line.id }))}
            aria-label="跳回这条划线"
          >
            <Icon name="arrow-right" size={14} /> 回原文
          </Button>
        </div>
      ))}
      {lostCount > 0 && (
        <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
          另有 {lostCount} 条原始划线已经不在了
        </span>
      )}
      {failedCount > 0 && (
        <span style={{ fontSize: '0.72rem', color: 'var(--destructive)' }}>
          另有 {failedCount} 条出处这一次没读出来
        </span>
      )}
    </section>
  )
}
