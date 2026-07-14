import { logger } from '../logger'
import { fetchWithTimeout } from '../http-client'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSION = 1536

interface EmbeddingConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

let config: EmbeddingConfig | null = null

// 设置Embedding配置
export function setEmbeddingConfig(newConfig: EmbeddingConfig): void {
  config = newConfig
  logger.info(`Embedding service configured: model=${newConfig.model || EMBEDDING_MODEL}`)
}

// 从AI配置初始化Embedding配置
export function initFromAIConfig(aiConfig: { apiKey: string; baseUrl?: string }): void {
  config = {
    apiKey: aiConfig.apiKey,
    baseUrl: aiConfig.baseUrl || 'https://api.openai.com/v1',
  }
  logger.info('Embedding service initialized from AI config')
}

// 获取配置
function getConfig(): EmbeddingConfig {
  if (!config) {
    throw new Error('Embedding service not configured')
  }
  return config
}

// 生成单个文本的Embedding
export async function generateEmbedding(text: string): Promise<number[]> {
  const cfg = getConfig()
  const baseUrl = cfg.baseUrl || 'https://api.openai.com/v1'
  
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model || EMBEDDING_MODEL,
          input: text,
          encoding_format: 'float',
        }),
      },
      30000
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Embedding API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>
      usage: { prompt_tokens: number; total_tokens: number }
    }

    if (!data.data || data.data.length === 0) {
      throw new Error('No embedding returned from API')
    }

    logger.debug(`Generated embedding: ${data.usage.total_tokens} tokens`)
    return data.data[0].embedding
  } catch (error) {
    logger.error('Failed to generate embedding', error)
    throw error
  }
}

// 批量生成Embedding
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const cfg = getConfig()
  const baseUrl = cfg.baseUrl || 'https://api.openai.com/v1'
  
  // OpenAI支持批量请求，但有token限制，分批处理
  const batchSize = 100
  const results: number[][] = []
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/embeddings`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model || EMBEDDING_MODEL,
            input: batch,
            encoding_format: 'float',
          }),
        },
        60000
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Embedding API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>
        usage: { prompt_tokens: number; total_tokens: number }
      }

      // 按index排序确保顺序正确
      const sorted = data.data.sort((a, b) => a.index - b.index)
      results.push(...sorted.map(d => d.embedding))
      
      logger.debug(`Generated batch embeddings: ${data.usage.total_tokens} tokens`)
    } catch (error) {
      logger.error(`Failed to generate batch embeddings at index ${i}`, error)
      throw error
    }
  }
  
  return results
}

// 测试连接
export async function testConnection(apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string }> {
  const testBaseUrl = baseUrl || 'https://api.openai.com/v1'
  
  try {
    const response = await fetchWithTimeout(
      `${testBaseUrl}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: 'test',
          encoding_format: 'float',
        }),
      },
      15000
    )

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, message: `API错误: ${response.status} - ${errorText}` }
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>
    }

    if (data.data && data.data.length > 0 && data.data[0].embedding.length === EMBEDDING_DIMENSION) {
      return { success: true, message: `连接成功！模型: ${EMBEDDING_MODEL}, 维度: ${EMBEDDING_DIMENSION}` }
    } else {
      return { success: false, message: '响应格式异常' }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, message: `连接失败: ${errorMessage}` }
  }
}
