/**
 * Complexity tests — the plugin's defence against over-optimization.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeComplexity } from '../src/optimizer/complexity.ts'

test('a greeting is trivial', () => {
  assert.equal(analyzeComplexity('你好', 'general').level, 'trivial')
  assert.equal(analyzeComplexity('谢谢', 'general').level, 'trivial')
  assert.equal(analyzeComplexity('Hello!', 'general').level, 'trivial')
  assert.equal(analyzeComplexity('好的', 'general').level, 'trivial')
})

test('a trivial verdict gets the smallest budget', () => {
  assert.equal(analyzeComplexity('你好', 'general').budget, 200)
})

test('a one-line translation request stays simple', () => {
  assert.equal(analyzeComplexity('把这句话翻译成英文。', 'general').level, 'simple')
})

test('a multi-part application request is complex', () => {
  const text = '帮我做一个完整的桌面应用，支持账号、同步、主题和插件系统，需要端到端架构设计以及完整的数据迁移方案和测试覆盖。'
  assert.equal(analyzeComplexity(text, 'coding').level, 'complex')
})

test('complexity rises with clause count', () => {
  const short = analyzeComplexity('做一个登录页', 'ui-design')
  const long = analyzeComplexity(
    '做一个登录页，支持手机号登录，支持邮箱登录，支持第三方登录，还要记住登录状态，并且要处理验证码和错误提示。',
    'ui-design',
  )
  const order = { trivial: 0, simple: 1, moderate: 2, complex: 3 }
  assert.ok(order[long.level] > order[short.level])
})

test('design and research briefs get more room than general ones', () => {
  const text = '设计一个首页，要有清晰的信息层级和主要 CTA。'
  assert.ok(analyzeComplexity(text, 'ui-design').budget > analyzeComplexity(text, 'general').budget)
})

test('reasons are reported for the panel', () => {
  const verdict = analyzeComplexity('你好', 'general')
  assert.ok(verdict.reasons.length > 0)
})

test('empty text is simple, not complex', () => {
  assert.equal(analyzeComplexity('', 'general').level, 'simple')
})
