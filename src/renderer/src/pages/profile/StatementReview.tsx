/**
 * 画像核验区 —— 外部 AI 读语料写出的结论，逐条由你按下「对 / 不对 / 不确定」
 *
 * 为什么要有这一块：自画像没有外部真值可比对（调研报告第 8 节），唯一能把
 * 「模型读出来的你」和「你知道的你」对上的动作，就是本人逐条判定。
 * 所以这里的规则只有一条要紧的：**只有点过「对」的才进画像卡**，
 * 而「还没判的有几条」必须摆在计数旁边 —— 只报一个好看的确认率等于骗自己。
 *
 * 数据只走 `profile:listStatements` 那一条读路：结论、证据原文、能不能点回原文，
 * 都来自应用自己算出的那份语料（与导入那道闸认的 id 集同源）。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { toast } from '../../stores/toastStore'
import { copyToClipboard } from '../../utils/clipboard'
import { sourceHighlightLink } from '../../../../shared/source-anchor'
import { renderProfileCard } from '../../../../shared/profile-card'
import { STATEMENT_LAYER_LABELS } from '../../../../shared/profile-statements'
import {
  STATEMENT_FILTERS,
  STATEMENT_FILTER_LABELS,
  countByFilter,
  filterStatements,
} from './statement-filter'
import type { StatementFilter } from './statement-filter'
import type { EvidenceText, ProfileStatement, StatementListView, StatementVerdict } from '../../../../shared/profile-statements'

/** 一条结论后面最多摆几条证据：全摆会变成一屏引用，核验要的是"够我认出来" */
const MAX_EVIDENCE_SHOWN = 3

const VERDICT_BUTTONS: { verdict: StatementVerdict; label: string }[] = [
  { verdict: 'confirmed', label: '对' },
  { verdict: 'rejected', label: '不对' },
  { verdict: 'unsure', label: '不确定' },
]

const VERDICT_DONE: Record<StatementVerdict, string> = {
  pending: '还没判',
  confirmed: '你判过：对',
  rejected: '你判过：不对',
  unsure: '你判过：不确定',
}

function excerpt(text: string, max = 96): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 一条证据：读得出原句就摆原句 + 点得回去，读不出来说「原始划线已不在」 */
function EvidenceLine({ id, item }: { id: string; item?: EvidenceText }) {
  const navigate = useNavigate()
  if (!item) {
    return (
      <li style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
        {`这条证据在你的语料里已经找不到了（${id}）`}
      </li>
    )
  }
  const canGoBack = Boolean(item.bookId && item.highlightId)
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'calc(var(--spacing) * 3)',
      }}
    >
      <span style={{ minWidth: 0, fontStyle: 'italic' }}>
        {item.bookTitle ? `${item.bookTitle}：` : ''}
        {excerpt(item.text) || '（这条没有正文）'}
      </span>
      {canGoBack && (
        <Button
          variant="ghost"
          aria-label="跳回这条划线"
          onClick={() => navigate(sourceHighlightLink({ bookId: item.bookId ?? '', highlightId: item.highlightId ?? '' }))}
        >
          <Icon name="arrow-right" size={14} /> 回原文
        </Button>
      )}
    </li>
  )
}

function StatementItem({
  statement,
  evidence,
  busy,
  onVerdict,
}: {
  statement: ProfileStatement
  evidence: Record<string, EvidenceText>
  busy: boolean
  onVerdict: (id: string, verdict: StatementVerdict) => void
}) {
  const shown = statement.evidenceIds.slice(0, MAX_EVIDENCE_SHOWN)
  const rest = statement.evidenceIds.length - shown.length
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'calc(var(--spacing) * 2)',
        padding: 'calc(var(--spacing) * 3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
        <Badge>{STATEMENT_LAYER_LABELS[statement.layer]}</Badge>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>{statement.topic}</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
          {VERDICT_DONE[statement.verdict]}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.7 }}>{statement.statement}</p>
      <ul style={{ margin: 0, padding: '0 0 0 1rem', display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem' }}>
        {shown.map((id) => (
          <EvidenceLine key={id} id={id} item={evidence[id]} />
        ))}
        {rest > 0 && <li style={{ color: 'var(--muted-foreground)' }}>{`另有 ${rest} 条证据没展开`}</li>}
      </ul>
      <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
        {VERDICT_BUTTONS.map((button) => (
          <Button
            key={button.verdict}
            variant={statement.verdict === button.verdict ? 'primary' : 'secondary'}
            disabled={busy}
            aria-pressed={statement.verdict === button.verdict}
            onClick={() => onVerdict(statement.id, button.verdict)}
          >
            {button.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** 读失败那一态：说的是"这一次没读出来"，与"库里没有结论"分开（见文件头注释） */
function ReadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--destructive)' }}>{message}</span>
      <Button variant="ghost" onClick={onRetry}>
        再读一次
      </Button>
    </div>
  )
}

/** 空态带出口：说清下一步是"导出语料 → 交给外部 AI → 导回来"，不是摆一句"暂无数据" */
function EmptyHint({ busy, onImport }: { busy: boolean; onImport: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.7 }}>
        这里还没有画像结论。上面点「导出画像语料包」把证据交给外部 AI，让它读完后写一份结论清单（
        <code>statements.json</code>），再回到这里导入。
      </p>
      <div>
        <Button variant="secondary" disabled={busy} onClick={onImport}>
          导入结论清单
        </Button>
      </div>
    </div>
  )
}

/**
 * 有结论时的整块：计数那句 + 两颗表头按钮 + 逐条。
 *
 * 「还没判的有几条」与确认数摆在一句里（方案书 §8：未核验条数不许只藏在一个百分比后面）；
 * 一条都没确认时「复制画像卡」不可用 —— 空的画像卡贴出去，对面只能凭猜测编一个人。
 */
function StatementList({
  statements,
  evidence,
  busy,
  onVerdict,
  onImport,
  onCopy,
}: {
  statements: ProfileStatement[]
  evidence: Record<string, EvidenceText>
  busy: boolean
  onVerdict: (id: string, verdict: StatementVerdict) => void
  onImport: () => void
  onCopy: () => void
}) {
  const confirmed = statements.filter((row) => row.verdict === 'confirmed').length
  const pending = statements.length - confirmed
  // 筛选只管"摆哪些"：上面这两个数与「复制画像卡」永远按全部条目算（口径见 statement-filter.ts）
  const [filter, setFilter] = useState<StatementFilter>('all')
  const counts = countByFilter(statements)
  const visible = filterStatements(statements, filter)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
          {`共 ${statements.length} 条 · 你判过「对」的 ${confirmed} 条 · 还没判的 ${pending} 条`}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
          <Button variant="ghost" disabled={busy} onClick={onImport}>
            导入新的
          </Button>
          <Button variant="secondary" disabled={busy || confirmed === 0} onClick={onCopy}>
            复制画像卡
          </Button>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 'calc(var(--spacing)', flexWrap: 'wrap' }}>
        {STATEMENT_FILTERS.map((option) => {
          const n = counts[option]
          const active = option === filter
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(option)}
              style={{
                fontSize: '0.8rem',
                padding: 'calc(var(--spacing) * 0.5) calc(var(--spacing) * 1.5)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: active ? 'var(--primary)' : 'transparent',
                color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                // 空档也点得动：禁用的话点不进去，"这一档没有条目"那句话就永远看不见，
                // 而它正是"这里确实没有"与"读失败了"必须分开的地方
                opacity: n === 0 ? 0.6 : 1,
              }}
            >
              {`${STATEMENT_FILTER_LABELS[option]} ${n}`}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
        {visible.map((statement) => (
          <StatementItem
            key={statement.id}
            statement={statement}
            evidence={evidence}
            busy={busy}
            onVerdict={onVerdict}
          />
        ))}
        {visible.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
            {statements.length === 0 ? '还没有结论' : '这一档没有条目'}
          </p>
        )}
      </div>
    </>
  )
}

export default function StatementReview() {
  const [view, setView] = useState<StatementListView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const api = window.electronAPI
    if (!api) return
    try {
      setView(await api.profile.listStatements())
      setError('')
    } catch (e) {
      // 读失败说的是"这一次没读出来"，不是"你没有画像结论"
      setError(`这一次没读出来：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pressVerdict = async (id: string, verdict: StatementVerdict) => {
    const api = window.electronAPI
    if (!api) return
    setBusy(true)
    try {
      const result = await api.profile.setStatementVerdict(id, verdict)
      if (!result.recorded) toast.info('这条结论已经不在库里了，所以没记上')
      else toast.success(`记下了：${VERDICT_DONE[verdict].replace('你判过：', '')}`)
      await load()
    } catch (e) {
      toast.error(`没记上：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const importStatements = async () => {
    const api = window.electronAPI
    if (!api) return
    setBusy(true)
    try {
      const result = await api.profile.importStatements()
      // 取消 / 认不出文件 / 一条没过闸 / 真写进去了 —— 四种各说各的一句话
      if (result.saved) toast.success(result.summary, 8000)
      else toast.info(result.summary, 8000)
      await load()
    } catch (e) {
      toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const copyCard = async () => {
    // 这一段不碰 electronAPI：剪贴板是渲染进程自己的事
    const card = renderProfileCard(view?.statements ?? [])
    // 成功与否按真实结果报：剪贴板在 WebView 里可能被拒，静默"已复制"是假话
    if (await copyToClipboard(card.text)) {
      toast.success(card.omitted ? `画像卡已复制 · 还有 ${card.omitted} 条没放进去` : '画像卡已复制', 8000)
    } else {
      toast.error('剪贴板用不了，画像卡没复制成功')
    }
  }

  const statements = view?.statements ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
      {error && <ReadError message={error} onRetry={() => void load()} />}
      {!error && !view && <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>正在读你的画像结论…</div>}
      {!error && view && (statements.length === 0 ? (
        <EmptyHint busy={busy} onImport={() => void importStatements()} />
      ) : (
        <StatementList
          statements={statements}
          evidence={view.evidence}
          busy={busy}
          onVerdict={(id, verdict) => void pressVerdict(id, verdict)}
          onImport={() => void importStatements()}
          onCopy={() => void copyCard()}
        />
      ))}
    </div>
  )
}
