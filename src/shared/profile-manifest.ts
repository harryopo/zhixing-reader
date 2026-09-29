/**
 * profile-manifest — 语料包那张「我基于什么写这份画像」的说明书
 *
 * 为什么单独一份而不是拼在导出代码里：外部 AI 读语料时，第一个要看的不是内容，
 * 是**这批内容是什么、缺什么**。没有 manifest，40 条想法会被读成"这个人的全部想法"，
 * 而它其实只是本地库里现存的那些（微信读书那边还有从书架删掉的书 —— 实测差 1 条）。
 * 空的一层必须自己说清"这层为什么是空的"，不许留一个 0 让人猜。
 *
 * 纯函数：时钟由调用方给（测试里可确定），不碰 fs。
 */
import { PROFILE_LAYERS, describeCorpus, volumeChars } from './profile-corpus'
import type { CorpusPlan, CorpusVolume, ProfileLayer } from './profile-corpus'

export interface ManifestLayer {
  records: number
  chars: number
}

export interface ManifestVolume {
  file: string
  layer: ProfileLayer
  records: number
  chars: number
}

export interface ProfileManifest {
  /** 导出那一刻（带 Z 的 ISO）—— 语料会随阅读变，这一行说明它是哪一刻的快照 */
  generated_at: string
  /** 画像的口径说明：这些条数是怎么算出来的 */
  summary: string
  layers: Record<ProfileLayer, ManifestLayer>
  total_records: number
  total_chars: number
  /** 被丢掉的东西按原因计数 —— 与 `planCorpusRecords` 交回的是同一份 */
  dropped: Record<string, number>
  volumes: ManifestVolume[]
  /** 空层与已知缺口的如实说明，逐条一句人话 */
  caveats: string[]
}

const EMPTY_LAYER_REASON: Record<ProfileLayer, string> = {
  said: '「我说的」这层是空的 —— 你还没写过想法或消息，画像里没有你自己说的话可引',
  marked: '「我挑的」这层是空的 —— 库里一条划线都没有',
  chose: '「我选的」这层是空的 —— 本地书架上一本书都没有',
}

export const KNOWN_GAPS: string[] = [
  '语料只来自这台电脑上的本地库：从微信读书书架里删掉的书不会在这里（它们的思想仍然在云端）',
  '知识卡片、方法论、章节摘要一类 AI 生成物**不在**语料里 —— 把 AI 的输出喂回给 AI 不算你的证据',
  '划线正文是作者写的句子，只读作"你当时认为这句值得留着"，读不出"你认同这句的观点"',
]

function layerStats(plan: CorpusPlan): Record<ProfileLayer, ManifestLayer> {
  const out = {} as Record<ProfileLayer, ManifestLayer>
  for (const layer of PROFILE_LAYERS) {
    const rows = plan.records.filter((r) => r.layer === layer)
    out[layer] = { records: rows.length, chars: volumeChars(rows) }
  }
  return out
}

function buildCaveats(layers: Record<ProfileLayer, ManifestLayer>): string[] {
  const empty = PROFILE_LAYERS.filter((layer) => layers[layer].records === 0).map((layer) => EMPTY_LAYER_REASON[layer])
  return [...KNOWN_GAPS, ...empty]
}

export function buildManifest(input: {
  plan: CorpusPlan
  /** 由 `planVolumes` 算出 —— 文件名与分卷只有那一个出处 */
  volumes: readonly CorpusVolume[]
  now: Date
}): ProfileManifest {
  const layers = layerStats(input.plan)
  return {
    generated_at: input.now.toISOString(),
    summary: describeCorpus(input.plan),
    layers,
    total_records: input.plan.records.length,
    total_chars: volumeChars(input.plan.records),
    dropped: input.plan.dropped,
    volumes: input.volumes.map((volume) => ({
      file: volume.file,
      layer: volume.layer,
      records: volume.records.length,
      chars: volumeChars(volume.records),
    })),
    caveats: buildCaveats(layers),
  }
}

/** 写盘时那一行日志/界面用的口径：条数与卷数说在一句里 */
export function describeManifest(manifest: ProfileManifest): string {
  const volumes = manifest.volumes.length
  return `${manifest.summary} · 分 ${volumes} 卷 · 共 ${manifest.total_chars} 字`
}

/**
 * `profile:exportPackage` 交回渲染层的那一份 —— 跨进程的形状只在 shared 写一次。
 *
 * `saved: false` 有两种，界面必须分得开：**用户取消**与**库里确实没东西可导**。
 * 两者都算"没导"就说不准下一句该写什么（本项目反复治的"两种失败共用一个形状"）。
 * 所以原因单独一栏，取消时 `dir` 是空串而不是编一个路径。
 */
export type CorpusCancelReason = 'canceled' | 'empty'

export interface CorpusExportResult {
  saved: boolean
  /** 界面那句提示：无论成功、取消、还是空语料，都是一句人话 */
  summary: string
  /** 取消或空语料时是空串 —— 不填一个用户没选过的目录 */
  dir: string
  volumes: number
  reason?: CorpusCancelReason
}
