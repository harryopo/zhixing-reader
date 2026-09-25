/**
 * VocabularyPage — 生词本（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/vocabulary.html + vocabulary-drawer.html
 *
 * 三种状态：
 *   1. 默认态：双栏布局（左列表 + 右快速详情 sticky 卡片）
 *   2. 抽屉态：点击列表项 / "详情"按钮，打开右侧 420px 抽屉（含完整词典信息 + 掌握度进度条）
 *   3. 复习态：覆盖整页的复习模式（4 评分按钮，FSRS 评分提交）
 *
 * 业务逻辑全部保留：vocabulary.* IPC、复习模式、搜索、tab 筛选、添加/删除/标记掌握/加入复习
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { mapVocabularies, type VocabularyRow } from '../utils/db-mapper'

import {
  getMasteryKind,
  ReviewRating,
  type FilterKey,
} from './vocabulary/model'
import { eyebrowStyle } from './vocabulary/styles'
import {
  FilterChips,
  IconButton,
  MasteryBadge,
  ReviewRatingButton,
} from './vocabulary/controls'
import { VocabularyDrawer } from './vocabulary/VocabularyDrawer'
import { ExportModal } from './vocabulary/ExportModal'
import { deleteWithUndo } from '@/utils/undoable-delete'
// ===== 主组件 =====
export default function VocabularyPage() {
  // 列表 + 统计
  const [vocabulary, setVocabulary] = useState<VocabularyRow[]>([])
  const [stats, setStats] = useState({ total: 0, mastered: 0, dueToday: 0 })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterKey>('all')
  const [searchKeyword, setSearchKeyword] = useState('')

  // 选中的单词（右侧详情）
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 抽屉
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 复习模式
  const [reviewMode, setReviewMode] = useState(false)
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0)
  /** 评分提交中：防止连点导致同一个词被评两次、并跳过一个词 */
  const [submitting, setSubmitting] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [reviewList, setReviewList] = useState<VocabularyRow[]>([])
  const [reviewStats, setReviewStats] = useState({ correct: 0, total: 0 })

  // 导出 Modal
  const [exportModalOpen, setExportModalOpen] = useState(false)
  /** 导出清单：打开导出时一次性取「全部生词」，与当前筛选无关 */
  const [exportItems, setExportItems] = useState<VocabularyRow[]>([])
  /** 批量导入中：防止连点并行跑两遍 */
  const [importing, setImporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<'csv' | 'anki'>('csv')
  const [exporting, setExporting] = useState(false)

  // ===== 数据加载 =====
  const loadVocabulary = useCallback(async () => {
    if (!window.electronAPI?.vocabulary) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      let result: VocabularyRow[] = []
      if (activeTab === 'due') {
        result = mapVocabularies(await window.electronAPI.vocabulary.getDueForReview(200))
      } else if (activeTab === 'mastered') {
        result = mapVocabularies(await window.electronAPI.vocabulary.getAll(200)).filter(
          (v) => v.is_mastered,
        )
      } else if (activeTab === 'unmastered') {
        result = mapVocabularies(await window.electronAPI.vocabulary.getUnmastered(200))
      } else {
        result = mapVocabularies(await window.electronAPI.vocabulary.getAll(200))
      }
      setVocabulary(result)

      // 加载统计
      const statsResult = await window.electronAPI.vocabulary.getStats()
      setStats(statsResult as { total: number; mastered: number; dueToday: number })
    } catch (error) {
      console.error('加载生词本失败:', error)
      toast.error('加载生词本失败')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    loadVocabulary()
  }, [loadVocabulary])

  // 选中单词的派生数据（未选时 fallback 到第一个）
  const selectedItem = useMemo(() => {
    if (!selectedId) return vocabulary[0] ?? null
    return vocabulary.find((v) => v.id === selectedId) ?? null
  }, [selectedId, vocabulary])

  // ===== 业务逻辑 =====

  /** 搜索 */
  const handleSearch = async () => {
    if (!window.electronAPI?.vocabulary) return
    if (!searchKeyword.trim()) {
      loadVocabulary()
      return
    }
    try {
      setVocabulary(mapVocabularies(await window.electronAPI.vocabulary.search(searchKeyword)))
    } catch (error) {
      console.error('搜索失败:', error)
      toast.error('搜索失败')
    }
  }

  /** 添加生词（通过词典查询） */
  const handleAddWord = async () => {
    if (!window.electronAPI?.vocabulary) return
    const word = window.prompt('请输入要添加的英文单词：')
    if (!word || !word.trim()) return
    try {
      const result = await window.electronAPI.vocabulary.createFromLookup(
        word.trim().toLowerCase(),
        '手动添加',
      )
      if (result === null) {
        toast.info(`"${word}" 已在生词本中`)
      } else {
        toast.success(`已添加 "${word}"`)
        await loadVocabulary()
      }
    } catch (error) {
      console.error('添加失败:', error)
      toast.error(error instanceof Error ? error.message : '添加失败')
    }
  }

  /**
   * 批量导入：每行一个英文词 → createFromLookup。
   *
   * importing 是防重入：循环里逐个 IPC 调用（最多 50 个），
   * 原来按钮没有 disabled，连点会让第二遍并行跑起来、同一个词被查两次。
   */
  const handleBatchImport = async () => {
    if (importing) return
    if (!window.electronAPI?.vocabulary) {
      toast.error('生词接口不可用')
      return
    }
    const raw = window.prompt('批量导入：每行一个英文单词（最多 50 个）')
    if (raw === null || !raw.trim()) return
    const words = [
      ...new Set(
        raw
          .split(/[\n,，;；\s]+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => /^[a-z][a-z'-]*$/i.test(w)),
      ),
    ].slice(0, 50)
    if (words.length === 0) {
      toast.info('未识别到有效英文单词')
      return
    }
    let added = 0
    let skipped = 0
    let failed = 0
    setImporting(true)
    const tId = toast.loading(`正在导入 ${words.length} 个单词...`)
    try {
      for (const word of words) {
        try {
          const result = await window.electronAPI.vocabulary.createFromLookup(word, '批量导入')
          if (result === null) skipped++
          else added++
        } catch {
          failed++
        }
      }
      await loadVocabulary()
      toast.remove(tId)
      toast.success(`导入完成：新增 ${added} · 已存在 ${skipped} · 失败 ${failed}`)
    } finally {
      setImporting(false)
    }
  }

  /** 删除生词：删完留 8 秒撤销（生词带着它的 FSRS 复习状态，误点一次就全没了） */
  const handleDelete = async (id: string, word: string) => {
    if (!window.electronAPI?.vocabulary) return
    if (!window.confirm(`确定要删除 "${word}" 吗？`)) return
    if (await deleteWithUndo({ kind: 'vocabulary', id, refresh: loadVocabulary })) {
      setDrawerOpen(false)
      if (selectedId === id) setSelectedId(null)
    }
  }

  /** 标记已掌握 */
  const handleMarkMastered = async (id: string) => {
    if (!window.electronAPI?.vocabulary) return
    try {
      await window.electronAPI.vocabulary.markAsMastered(id)
      toast.success('已标记为掌握')
      await loadVocabulary()
    } catch (error) {
      console.error('标记掌握失败:', error)
      toast.error('标记掌握失败')
    }
  }

  /**
   * 加入复习队列。
   *
   * 2026-09-16 修正：原来这里调 updateReviewData(quality: GOOD) ——
   * 那会 review_count + 1、写 last_review_at、并按 Good 重排下次复习时间，
   * 等于**替用户提交了一次"我认识这个词"的评分**。按钮写的是"加入复习"，做的是"打分"。
   * 现在只把词排到待复习（next_review_at = 现在），不动任何调度参数。
   */
  const handleAddReview = async (id: string) => {
    if (!window.electronAPI?.vocabulary) return
    try {
      await window.electronAPI.vocabulary.scheduleForReview(id)
      toast.success('已加入复习队列')
      await loadVocabulary()
    } catch (error) {
      console.error('加入复习失败:', error)
      toast.error('加入复习失败')
    }
  }

  /**
   * 导出用的清单 = **整个生词本**，不是当前筛选结果。
   *
   * 原来 handleConfirmExport 用的是 vocabulary（受 tab / 搜索影响）：
   * 切到「待复习」再点导出，导出的就只有那几十个词 —— 按钮写着「导出」，
   * 用户以为导的是全部。筛选为空时按钮还会直接禁用，哪怕生词本里有几百个词。
   */
  const handleOpenExportAll = async () => {
    if (!window.electronAPI?.vocabulary) return
    try {
      setExporting(true)
      const all = mapVocabularies(await window.electronAPI.vocabulary.getAll(1000))
      if (all.length === 0) {
        toast.info('生词本还是空的')
        return
      }
      setExportItems(all)
      setExportFormat('csv')
      setExportModalOpen(true)
    } catch (error) {
      console.error('读取生词本失败:', error)
      toast.error('读取生词本失败')
    } finally {
      setExporting(false)
    }
  }

  /** 确认导出：调用主进程 dialog.showSaveDialog + 写文件 */
  const handleConfirmExport = async () => {
    if (!window.electronAPI?.vocabulary?.export) {
      toast.error('导出接口不可用')
      return
    }
    if (exportItems.length === 0) {
      toast.info('生词本为空，无法导出')
      return
    }
    try {
      setExporting(true)
      const items = exportItems.map((v) => ({
        word: v.word,
        phonetic: v.phonetic,
        part_of_speech: v.part_of_speech,
        meaning_zh: v.meaning_zh,
        example_en: v.example_en,
        example_zh: v.example_zh,
      }))
      const result = await window.electronAPI.vocabulary.export(exportFormat, items)
      if (result?.saved) {
        toast.success(`已导出 ${result.count} 个生词`)
        setExportModalOpen(false)
      } else {
        toast.info('已取消导出')
      }
    } catch (error) {
      console.error('导出失败:', error)
      toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  /** 朗读单词（Web Speech API） */
  const handlePronounce = (word: string) => {
    try {
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(word)
        utter.lang = 'en-US'
        utter.rate = 0.9
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utter)
      } else {
        toast.info('当前环境不支持语音合成')
      }
    } catch (error) {
      console.error('朗读失败:', error)
    }
  }

  /** 开始复习模式 */
  const startReview = async () => {
    if (!window.electronAPI?.vocabulary) return
    try {
      const data = mapVocabularies(await window.electronAPI.vocabulary.getDueForReview(50))
      if (data.length === 0) {
        toast.info('没有待复习的单词')
        return
      }
      setReviewList(data)
      setCurrentReviewIndex(0)
      setShowAnswer(false)
      setReviewStats({ correct: 0, total: 0 })
      setReviewMode(true)
    } catch (error) {
      console.error('启动复习失败:', error)
      toast.error('启动复习失败')
    }
  }

  /**
   * 提交复习评分。
   *
   * submitting 是防连点：原来按钮没有 disabled，连点两次会对**同一个词**提交两次评分，
   * 而且 setCurrentReviewIndex 触发两次 → 直接跳过一个词。
   */
  const submitReview = async (rating: ReviewRating) => {
    if (!window.electronAPI?.vocabulary) return
    if (submitting) return
    const currentWord = reviewList[currentReviewIndex]
    if (!currentWord) return
    setSubmitting(true)
    try {
      await window.electronAPI.vocabulary.updateReviewData(currentWord.id, {
        quality: rating,
      })

      const newCorrect = reviewStats.correct + (rating >= ReviewRating.GOOD ? 1 : 0)
      const newTotal = reviewStats.total + 1
      setReviewStats({ correct: newCorrect, total: newTotal })

      if (currentReviewIndex < reviewList.length - 1) {
        setCurrentReviewIndex((prev) => prev + 1)
        setShowAnswer(false)
      } else {
        const pct = Math.round((newCorrect / newTotal) * 100)
        toast.success(`复习完成！正确率: ${pct}%`)
        setReviewMode(false)
        await loadVocabulary()
      }
    } catch (error) {
      console.error('提交复习失败:', error)
      toast.error('提交复习失败')
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 渲染 =====
  if (loading) {
    return <Loading hint="正在加载生词本..." />
  }

  // ===== 复习模式 UI =====
  if (reviewMode && reviewList.length > 0) {
    const currentWord = reviewList[currentReviewIndex]
    const progress = ((currentReviewIndex + 1) / reviewList.length) * 100
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'var(--background)',
        }}
      >
        {/* 复习头部 */}
        <div
          style={{
            borderBottom: '1px solid var(--border)',
            padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 6)',
            background: 'var(--card)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              maxWidth: 720,
              margin: '0 auto',
              gap: 'calc(var(--spacing) * 4)',
            }}
          >
            <Button variant="ghost" onClick={() => setReviewMode(false)}>
              <Icon name="close" size={16} /> 退出
            </Button>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  height: 8,
                  background: 'var(--muted)',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--primary)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
            <span
              style={{
                fontSize: '0.85rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              {currentReviewIndex + 1} / {reviewList.length}
            </span>
          </div>
        </div>

        {/* 复习卡片 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'calc(var(--spacing) * 6)',
          }}
        >
          <div style={{ width: '100%', maxWidth: 560 }}>
            <Card style={{ textAlign: 'center', marginBottom: 'calc(var(--spacing) * 5)' }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '2rem',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {currentWord.word}
              </h2>
              {currentWord.phonetic && (
                <p
                  style={{
                    margin: '0.5rem 0 0',
                    fontSize: '1rem',
                    color: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {currentWord.phonetic}
                </p>
              )}

              {!showAnswer ? (
                <div style={{ marginTop: 'calc(var(--spacing) * 6)' }}>
                  <p
                    style={{
                      color: 'var(--muted-foreground)',
                      marginBottom: 'calc(var(--spacing) * 4)',
                    }}
                  >
                    先回忆一下这个单词的意思...
                  </p>
                  <Button variant="primary" onClick={() => setShowAnswer(true)}>
                    显示答案
                  </Button>
                </div>
              ) : (
                <div
                  className="animate-fade-in"
                  style={{ marginTop: 'calc(var(--spacing) * 5)' }}
                >
                  {currentWord.part_of_speech && (
                    <Badge
                      variant="ok"
                      style={{ marginBottom: 'calc(var(--spacing) * 3)' }}
                    >
                      {currentWord.part_of_speech}
                    </Badge>
                  )}
                  <p
                    style={{
                      fontSize: '1.1rem',
                      color: 'var(--foreground)',
                      margin: '0 0 calc(var(--spacing) * 4)',
                    }}
                  >
                    {currentWord.meaning_zh}
                  </p>
                  {currentWord.example_en && (
                    <div
                      style={{
                        background: 'var(--muted)',
                        borderRadius: 'var(--radius)',
                        padding: 'calc(var(--spacing) * 4)',
                        textAlign: 'left',
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontStyle: 'italic',
                          color: 'var(--foreground)',
                        }}
                      >
                        {currentWord.example_en}
                      </p>
                      {currentWord.example_zh && (
                        <p
                          style={{
                            margin: '0.5rem 0 0',
                            fontSize: '0.85rem',
                            color: 'var(--muted-foreground)',
                          }}
                        >
                          {currentWord.example_zh}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {showAnswer && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                <ReviewRatingButton
                  rating={ReviewRating.AGAIN}
                  label="忘记"
                  color="error"
                  onClick={submitReview}
                  disabled={submitting}
                />
                <ReviewRatingButton
                  rating={ReviewRating.HARD}
                  label="困难"
                  color="warning"
                  onClick={submitReview}
                  disabled={submitting}
                />
                <ReviewRatingButton
                  rating={ReviewRating.GOOD}
                  label="良好"
                  color="info"
                  onClick={submitReview}
                  disabled={submitting}
                />
                <ReviewRatingButton
                  rating={ReviewRating.EASY}
                  label="简单"
                  color="success"
                  onClick={submitReview}
                  disabled={submitting}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== 主页面 =====
  return (
    <>
      <PageHero
        title="生词本"
        subtitle={`共 ${stats.total} 个生词 · 待复习 ${stats.dueToday} 个`}
        actions={
          <>
            <Button variant="primary" onClick={handleAddWord} data-dom-id="cta-add">
              <Icon name="plus" size={16} /> 添加生词
            </Button>
            <Button
              variant="secondary"
              onClick={startReview}
              disabled={stats.dueToday === 0}
              data-dom-id="cta-review"
            >
              <Icon name="refresh" size={16} /> 批量复习
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleBatchImport()}
              disabled={importing}
              data-dom-id="cta-import"
            >
              <Icon name="file" size={16} /> {importing ? '导入中...' : '导入'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleOpenExportAll()}
              disabled={exporting}
              data-dom-id="cta-export"
            >
              <Icon name="arrow-down" size={16} /> 一键导出
            </Button>
          </>
        }
      >
        {/* 双栏布局：左列表 + 右快速详情 */}
        <div
          className="vocab-page-body"
          style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr',
            gap: 'calc(var(--spacing) * 5)',
            alignItems: 'start',
          }}
        >
          {/* ===== 左：vocab-table 卡片 ===== */}
          <Card
            padding={0}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {/* head bar：chips + search */}
            <div
              style={{
                padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 4)',
                flexWrap: 'wrap',
              }}
            >
              <FilterChips
                value={activeTab}
                onChange={(next) => {
                  // 切 tab 会按 tab 重新拉列表，但不搜索时就不该留着一个看不见的过滤条件 ——
                  // 原来搜索框里的旧关键词还在，列表却已经换了口径，界面和结果对不上。
                  setSearchKeyword('')
                  setActiveTab(next)
                }}
              />
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <input
                  type="search"
                  placeholder="搜索单词..."
                  aria-label="搜索单词"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch()
                  }}
                  style={{
                    width: 180,
                    padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                    paddingRight: searchKeyword ? 28 : undefined,
                    border: '1px solid var(--input)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--popover)',
                    fontSize: '0.82rem',
                    color: 'var(--foreground)',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                {/* 清空按钮：原来只能靠手动删字符（搜索只在回车时触发，删完还得再回车一次） */}
                {searchKeyword && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    data-dom-id="cta-clear-search"
                    onClick={() => {
                      setSearchKeyword('')
                      void loadVocabulary()
                    }}
                    style={{
                      position: 'absolute',
                      right: 6,
                      display: 'grid',
                      placeItems: 'center',
                      width: 18,
                      height: 18,
                      padding: 0,
                      border: 'none',
                      borderRadius: '50%',
                      background: 'var(--muted)',
                      color: 'var(--muted-foreground)',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* body: vocab-list */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 3)',
                maxHeight: 'calc(100vh - 280px)',
              }}
            >
              {vocabulary.length === 0 ? (
                <EmptyState
                  icon={<Icon name="vocabulary" size={24} />}
                  title={
                    activeTab === 'due'
                      ? '没有待复习的单词'
                      : activeTab === 'mastered'
                        ? '还没有掌握的单词'
                        : '生词本为空'
                  }
                  description={
                    activeTab === 'due'
                      ? '继续阅读文章，遇到生词即可添加到生词本'
                      : '点击上方"添加生词"按钮，或在阅读时右键点击单词'
                  }
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'calc(var(--spacing) * 2)',
                  }}
                >
                  {vocabulary.map((item) => {
                    const kind = getMasteryKind(item)
                    const active = selectedItem?.id === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-dom-id={`vocab-item-${item.id}`}
                        onClick={() => setSelectedId(item.id)}
                        style={{
                          width: '100%',
                          padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                          textAlign: 'left',
                          border: '1px solid',
                          borderColor: active ? 'var(--primary)' : 'var(--border)',
                          borderRadius: 'var(--radius)',
                          background: active ? 'var(--popover)' : 'var(--background)',
                          cursor: 'pointer',
                          transition:
                            'border-color 0.2s ease, background 0.2s ease, transform 0.16s ease',
                          display: 'grid',
                          gridTemplateColumns: '1.6fr 2fr 0.7fr',
                          gap: 'calc(var(--spacing) * 3)',
                          alignItems: 'center',
                          font: 'inherit',
                          color: 'inherit',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.borderColor = 'var(--ring)'
                            e.currentTarget.style.background = 'var(--popover)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.borderColor = 'var(--border)'
                            e.currentTarget.style.background = 'var(--background)'
                          }
                        }}
                        onMouseDown={(e) => {
                          e.currentTarget.style.transform = 'scale(0.99)'
                        }}
                        onMouseUp={(e) => {
                          e.currentTarget.style.transform = 'scale(1)'
                        }}
                      >
                        <span
                          style={{
                            fontSize: '1rem',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--card-foreground)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.word}
                        </span>
                        <span
                          style={{
                            fontSize: '0.88rem',
                            color: 'var(--muted-foreground)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.meaning_zh}
                        </span>
                        <MasteryBadge kind={kind} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* ===== 右：vocab-detail 卡片（快速详情） ===== */}
          {selectedItem ? (
            <Card
              style={{
                position: 'sticky',
                top: 'calc(var(--spacing) * 4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 4)',
                alignSelf: 'start',
              }}
            >
              {/* head：word + phonetic + play-btn */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--card-foreground)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {selectedItem.word}
                  </div>
                  {selectedItem.phonetic && (
                    <div
                      style={{
                        fontSize: '0.88rem',
                        color: 'var(--muted-foreground)',
                        fontFamily: 'var(--font-mono)',
                        marginTop: '0.4rem',
                      }}
                    >
                      {selectedItem.phonetic}
                    </div>
                  )}
                </div>
                <IconButton
                  dataDomId="cta-pronounce"
                  ariaLabel="发音"
                  onClick={() => handlePronounce(selectedItem.word)}
                >
                  <Icon name="play" size={16} />
                </IconButton>
              </div>

              {/* 释义 section */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={eyebrowStyle}>释义</div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'calc(var(--spacing) * 2)',
                    marginTop: 'calc(var(--spacing) * 2)',
                  }}
                >
                  <div
                    style={{
                      padding: 'calc(var(--spacing) * 3)',
                      background: 'var(--background)',
                      borderRadius: 'var(--radius)',
                      borderLeft: '3px solid var(--chart-1)',
                      fontSize: '0.9rem',
                      color: 'var(--card-foreground)',
                      lineHeight: 1.55,
                    }}
                  >
                    {selectedItem.part_of_speech && (
                      <span
                        style={{
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          marginRight: '0.3rem',
                        }}
                      >
                        {selectedItem.part_of_speech}
                      </span>
                    )}
                    {selectedItem.meaning_zh}
                  </div>
                </div>
              </div>

              {/* 例句 section */}
              {selectedItem.example_en && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={eyebrowStyle}>例句</div>
                  <p
                    style={{
                      fontSize: '0.92rem',
                      lineHeight: 1.7,
                      color: 'var(--card-foreground)',
                      marginTop: 'calc(var(--spacing) * 2)',
                      fontStyle: 'italic',
                      margin: 'calc(var(--spacing) * 2) 0 0 0',
                    }}
                  >
                    {selectedItem.example_en}
                  </p>
                  {selectedItem.example_zh && (
                    <p
                      style={{
                        fontSize: '0.82rem',
                        color: 'var(--muted-foreground)',
                        marginTop: '0.5rem',
                        lineHeight: 1.6,
                      }}
                    >
                      {selectedItem.example_zh}
                    </p>
                  )}
                </div>
              )}

              {/* 复习状态 section */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={eyebrowStyle}>复习状态</div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                    marginTop: 'calc(var(--spacing) * 2)',
                    padding: 'calc(var(--spacing) * 3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--muted-foreground)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        fontWeight: 600,
                      }}
                    >
                      复习次数
                    </span>
                    <span
                      style={{
                        fontSize: '0.9rem',
                        color: 'var(--card-foreground)',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                      }}
                    >
                      {selectedItem.review_count} 次
                    </span>
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div
                style={{
                  display: 'flex',
                  gap: 'calc(var(--spacing) * 3)',
                  flexWrap: 'wrap',
                }}
              >
                <Button
                  variant="primary"
                  data-dom-id="cta-add-review"
                  onClick={() => handleAddReview(selectedItem.id)}
                >
                  加入复习
                </Button>
                <Button
                  variant="secondary"
                  data-dom-id="cta-master"
                  onClick={() => handleMarkMastered(selectedItem.id)}
                >
                  标记掌握
                </Button>
                <Button
                  variant="ghost"
                  data-dom-id="cta-edit-word"
                  onClick={() => setDrawerOpen(true)}
                >
                  <Icon name="edit" size={14} /> 详情
                </Button>
              </div>
            </Card>
          ) : (
            <Card
              style={{
                position: 'sticky',
                top: 'calc(var(--spacing) * 4)',
                alignSelf: 'start',
              }}
            >
              <EmptyState
                icon={<Icon name="vocabulary" size={24} />}
                title="选择一个单词查看详情"
                description="点击左侧列表中的任意单词，此处将展示它的释义、例句与来源。"
              />
            </Card>
          )}
        </div>
      </PageHero>

      {/* ===== 抽屉（深度详情） ===== */}
      {drawerOpen && selectedItem && (
        <VocabularyDrawer
          item={selectedItem}
          onClose={() => setDrawerOpen(false)}
          onPronounce={handlePronounce}
          onAddReview={handleAddReview}
          onMarkMastered={handleMarkMastered}
          onDelete={handleDelete}
        />
      )}

      {/* ===== 导出 Modal ===== */}
      {exportModalOpen && (
        <ExportModal
          format={exportFormat}
          onFormatChange={setExportFormat}
          onConfirm={() => void handleConfirmExport()}
          onCancel={() => setExportModalOpen(false)}
          exporting={exporting}
          count={exportItems.length}
        />
      )}
    </>
  )
}
