/** 生词面板（从 DailyLearning.tsx 原样搬出，逻辑未改） */
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { STAGE_LABELS } from './constants'
import type { VocabularyRow } from '../../utils/db-mapper'
import { formatRelativeTime } from './format'

interface VocabPanelProps {
  vocabulary: VocabularyRow[]
  dueWords: VocabularyRow[]
  vocabTab: 'all' | 'review'
  reviewingWord: VocabularyRow | null
  setVocabTab: (tab: 'all' | 'review') => void
  setReviewingWord: (word: VocabularyRow | null) => void
  onClose: () => void
  /** rating 为 ts-fsrs Rating：1=Again / 2=Hard / 3=Good / 4=Easy */
  onReviewWord: (wordId: string, rating: number) => void
  /** 评分提交中：禁用按钮，避免连点重复提交 */
  reviewSubmitting?: boolean
  onMarkMastered: (wordId: string) => void
  onDeleteVocab: (wordId: string) => void
  onContextMenu: (word: string, e: React.MouseEvent) => void
}

function VocabPanel({
  vocabulary,
  dueWords,
  vocabTab,
  reviewingWord,
  setVocabTab,
  setReviewingWord,
  onClose,
  onReviewWord,
  reviewSubmitting = false,
  onContextMenu,
}: VocabPanelProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: 'var(--card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-xl)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 面板头部 */}
      <div style={{ padding: 'calc(var(--spacing) * 4)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'calc(var(--spacing) * 3)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--foreground)' }}>生词本</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              cursor: 'pointer',
              padding: '0.34rem',
              borderRadius: 'var(--radius-sm)',
              display: 'grid',
              placeItems: 'center',
            }}
            aria-label="关闭"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 4)', fontSize: '0.78rem', color: 'var(--muted-foreground)', marginBottom: 'calc(var(--spacing) * 3)' }}>
          <span>总词数: {vocabulary.length}</span>
          <span>待复习: {dueWords.length}</span>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={() => { setVocabTab('all'); setReviewingWord(null) }}
            style={{
              flex: 1,
              padding: '0.5rem 0',
              border: 'none',
              background: 'transparent',
              borderBottom: vocabTab === 'all' ? '2px solid var(--primary)' : '2px solid transparent',
              color: vocabTab === 'all' ? 'var(--primary)' : 'var(--muted-foreground)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            全部 ({vocabulary.length})
          </button>
          <button
            type="button"
            onClick={() => { setVocabTab('review'); setReviewingWord(null) }}
            style={{
              flex: 1,
              padding: '0.5rem 0',
              border: 'none',
              background: 'transparent',
              borderBottom: vocabTab === 'review' ? '2px solid var(--primary)' : '2px solid transparent',
              color: vocabTab === 'review' ? 'var(--primary)' : 'var(--muted-foreground)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            待复习 ({dueWords.length})
          </button>
        </div>
      </div>

      {/* 面板内容 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'calc(var(--spacing) * 4)' }}>
        {vocabTab === 'review' ? (
          // 复习模式
          reviewingWord ? (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 'calc(var(--spacing) * 5)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)', marginBottom: '0.25rem' }}>{reviewingWord.word}</div>
                {reviewingWord.phonetic && <div style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>{reviewingWord.phonetic}</div>}
                {reviewingWord.part_of_speech && (
                  <span style={{ display: 'inline-block', marginTop: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.78rem', background: 'var(--secondary)', color: 'var(--accent-foreground)', borderRadius: 'var(--radius-sm)' }}>
                    {reviewingWord.part_of_speech}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                <button
                  type="button"
                  onClick={() => onReviewWord(reviewingWord.id, 1)} /* Again */
                  disabled={reviewSubmitting}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--accent)',
                    color: 'var(--destructive)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    font: 'inherit',
                  }}
                >
                  忘记
                </button>
                <button
                  type="button"
                  onClick={() => onReviewWord(reviewingWord.id, 2)} /* Hard */
                  disabled={reviewSubmitting}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--secondary)',
                    color: 'var(--accent-foreground)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    font: 'inherit',
                  }}
                >
                  模糊
                </button>
                <button
                  type="button"
                  onClick={() => onReviewWord(reviewingWord.id, 3)} /* Good */
                  disabled={reviewSubmitting}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--state-success)',
                    color: '#ffffff',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    font: 'inherit',
                  }}
                >
                  认识
                </button>
              </div>
              <button
                type="button"
                onClick={() => setReviewingWord(null)}
                style={{
                  width: '100%',
                  marginTop: 'calc(var(--spacing) * 3)',
                  padding: '0.5rem 0',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--muted-foreground)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  font: 'inherit',
                }}
              >
                返回单词列表
              </button>
            </div>
          ) : dueWords.length > 0 ? (
            <div style={{ textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
              <div style={{ marginBottom: 'calc(var(--spacing) * 4)' }}>
                <Icon name="vocabulary" size={32} style={{ color: 'var(--primary)' }} />
              </div>
              <p style={{ color: 'var(--foreground)', marginBottom: 'calc(var(--spacing) * 4)', fontSize: '0.9rem' }}>今日有 {dueWords.length} 个单词待复习</p>
              <Button variant="primary" onClick={() => setReviewingWord(dueWords[0])}>
                <Icon name="play" size={14} /> 开始复习
              </Button>
            </div>
          ) : (
            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
              今日暂无待复习单词 🎉
            </p>
          )
        ) : (
          // 全部生词列表
          vocabulary.length === 0 ? (
            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
              暂无生词，悬停或右键点击英文单词可添加
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
              {vocabulary.map(vocab => (
                <div
                  key={vocab.id}
                  style={{
                    background: 'var(--background)',
                    borderRadius: 'var(--radius)',
                    padding: 'calc(var(--spacing) * 3)',
                    border: '1px solid var(--border)',
                  }}
                  onContextMenu={(e) => onContextMenu(vocab.word, e)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{vocab.word}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {vocab.cefr_level && (
                        <span style={{ fontSize: '0.72rem', background: 'var(--secondary)', color: 'var(--accent-foreground)', padding: '0.2rem 0.4rem', borderRadius: 'var(--radius-sm)' }}>
                          {vocab.cefr_level}
                        </span>
                      )}
                      {vocab.learning_stage !== undefined && (
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '0.2rem 0.4rem',
                          borderRadius: 'var(--radius-sm)',
                          background: vocab.learning_stage === 0
                            ? 'var(--state-info)'
                            : vocab.learning_stage === 1
                            ? 'var(--state-warning)'
                            : 'var(--state-success)',
                          color: '#ffffff',
                        }}>
                          {STAGE_LABELS[vocab.learning_stage] || '新词'}
                        </span>
                      )}
                    </div>
                  </div>
                  {vocab.phonetic && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>{vocab.phonetic}</span>
                  )}
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--foreground)' }}>{vocab.meaning_zh}</p>
                  {vocab.next_review_at && (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
                      下次复习: {formatRelativeTime(vocab.next_review_at)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}


export { VocabPanel }
