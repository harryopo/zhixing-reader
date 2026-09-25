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
  const allIds = highlightIds.filter(Boolean)
  const ids = allIds.slice(0, MAX_SHOWN)
  const key = ids.join(',')

  useEffect(() => {
    let alive = true
    setLines([])
    setLostCount(0)
    if (!key) return
    void (async () => {
      const rows = await Promise.all(
        key.split(',').map((id) =>
          window.electronAPI.highlight
            .getById(id)
            // 通道交回的是数据库那一行，字段名以 db-mapper 为准，不在组件里自己猜列名；
            // 划线已被删掉时这里拿到 undefined，按"来源已丢失"计一笔（不硬转成空行）
            .then((raw) => (raw ? mapHighlight(raw) : null))
            .catch(() => null),
        ),
      )
      if (!alive) return
      const found: SourceLine[] = []
      let lost = 0
      rows.forEach((row, i) => {
        if (!row) {
          lost++
          return
        }
        found.push({
          id: key.split(',')[i],
          content: row.content,
          chapterTitle: row.chapterTitle,
        })
      })
      setLines(found)
      setLostCount(lost)
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
    </section>
  )
}
