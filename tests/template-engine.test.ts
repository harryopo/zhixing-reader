// 知行读书 — 模板引擎 smoke test（2026-07-20）
//
// 覆盖：变量插值、变量提取、变量高亮
// 这是 prompt-registry / system-prompt / RAG service 全部依赖的基础设施
// （2026-09-18：validateTemplate stub 生产零消费，已随死代码清理移除）

import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  extractVariables,
  highlightVariables,
} from '../electron/services/template-engine'

describe('Template Engine — Smoke Tests', () => {
  describe('renderTemplate', () => {
    it('should substitute a single variable', () => {
      expect(renderTemplate('Hello {{name}}', { name: 'Alice' })).toBe('Hello Alice')
    })

    it('should substitute multiple variables', () => {
      expect(
        renderTemplate('{{greeting}}, {{name}}!', { greeting: 'Hi', name: 'Bob' })
      ).toBe('Hi, Bob!')
    })

    it('should coerce numbers to strings', () => {
      expect(renderTemplate('count: {{n}}', { n: 42 })).toBe('count: 42')
    })

    it('should leave placeholder intact when variable is undefined', () => {
      expect(renderTemplate('hi {{name}}', {})).toBe('hi {{name}}')
    })

    it('should leave placeholder intact when variable is null', () => {
      expect(renderTemplate('hi {{name}}', { name: null })).toBe('hi {{name}}')
    })

    it('should leave placeholder intact when variable is empty string', () => {
      expect(renderTemplate('hi {{name}}', { name: '' })).toBe('hi {{name}}')
    })

    it('should leave template unchanged when no variables', () => {
      expect(renderTemplate('no vars here', { foo: 'bar' })).toBe('no vars here')
    })

    it('should handle zero correctly (not treated as empty)', () => {
      expect(renderTemplate('n={{n}}', { n: 0 })).toBe('n=0')
    })

    it('should support word-character variables only (no spaces)', () => {
      // {{a b}} 不会被识别为变量，保留原样
      expect(renderTemplate('x={{a b}}', { 'a b': 'X' })).toBe('x={{a b}}')
    })
  })

  describe('extractVariables', () => {
    it('should return unique variable names', () => {
      const vars = extractVariables('{{a}} and {{b}} and {{a}} again')
      expect(vars.sort()).toEqual(['a', 'b'])
    })

    it('should return empty array for template with no variables', () => {
      expect(extractVariables('plain text')).toEqual([])
    })

    it('should return empty array for empty template', () => {
      expect(extractVariables('')).toEqual([])
    })
  })

  describe('highlightVariables', () => {
    it('should split template into variable and plain segments', () => {
      const parts = highlightVariables('hi {{name}}, age {{age}}')
      expect(parts).toEqual([
        { text: 'hi ', isVariable: false },
        { text: '{{name}}', isVariable: true, name: 'name' },
        { text: ', age ', isVariable: false },
        { text: '{{age}}', isVariable: true, name: 'age' },
      ])
    })

    it('should return single plain segment when no variables', () => {
      const parts = highlightVariables('hello world')
      expect(parts).toEqual([{ text: 'hello world', isVariable: false }])
    })

    it('should handle variable at start', () => {
      const parts = highlightVariables('{{x}} rest')
      expect(parts).toEqual([
        { text: '{{x}}', isVariable: true, name: 'x' },
        { text: ' rest', isVariable: false },
      ])
    })

    it('should handle variable at end', () => {
      const parts = highlightVariables('start {{x}}')
      expect(parts).toEqual([
        { text: 'start ', isVariable: false },
        { text: '{{x}}', isVariable: true, name: 'x' },
      ])
    })

    it('should return empty array for empty template', () => {
      expect(highlightVariables('')).toEqual([])
    })
  })
})
