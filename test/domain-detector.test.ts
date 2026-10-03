/**
 * Domain detection tests.
 *
 * The detector is deterministic, so every expectation here is exact rather than
 * approximate. These cases are also the regression net for the signal lists:
 * adding a signal that steals a match from another domain fails a test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectDomain } from '../src/optimizer/domain-detector.ts'
import { DOMAINS, domainById } from '../src/optimizer/domains/index.ts'

test('detects coding from a plain bug report', () => {
  const match = detectDomain('这个代码有 bug 帮我修')
  assert.equal(match.domain.id, 'coding')
  assert.equal(match.confident, true)
})

test('detects Minecraft and prefers it over generic game development', () => {
  const match = detectDomain('做个 MC 感染末影人')
  assert.equal(match.domain.id, 'minecraft')
})

test('detects Minecraft from a loader name', () => {
  assert.equal(detectDomain('NeoForge 1.21 mod 开发').domain.id, 'minecraft')
})

test('detects UI design from a dashboard request', () => {
  const match = detectDomain('帮我做个好看的管理后台')
  assert.equal(match.domain.id, 'ui-design')
})

test('detects research from a company analysis request', () => {
  assert.equal(detectDomain('分析一下这家公司').domain.id, 'research')
})

test('falls back to general for an unmatched request', () => {
  const match = detectDomain('今天天气怎么样')
  assert.equal(match.domain.id, 'general')
  assert.equal(match.confident, false)
  assert.deepEqual(match.ranked, [])
})

test('minecraftOptimization:false removes the Minecraft strategy', () => {
  const on = detectDomain('minecraft mod 纹理')
  const off = detectDomain('minecraft mod 纹理', { minecraftOptimization: false })
  assert.equal(on.domain.id, 'minecraft')
  assert.notEqual(off.domain.id, 'minecraft')
})

test('ranks every scoring domain, best first', () => {
  const match = detectDomain('用 React 写一个管理后台的 UI 界面')
  assert.ok(match.ranked.length >= 1)
  for (let i = 1; i < match.ranked.length; i += 1) {
    assert.ok(match.ranked[i - 1].score >= match.ranked[i].score)
  }
})

test('a multi-word signal outranks a bare fragment', () => {
  const match = detectDomain('minecraft mod 开发')
  assert.equal(match.ranked[0].id, 'minecraft')
})

test('registry invariants: unique ids, general present and last', () => {
  const ids = DOMAINS.map((domain) => domain.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids[ids.length - 1], 'general')
})

test('domainById falls back to general for an unknown id', () => {
  assert.equal(domainById('does-not-exist').id, 'general')
  assert.equal(domainById('coding').id, 'coding')
})

test('detection is case- and width-insensitive', () => {
  assert.equal(detectDomain('MINECRAFT MOD').domain.id, 'minecraft')
  assert.equal(detectDomain('ＭＩＮＥＣＲＡＦＴ ＭＯＤ').domain.id, 'minecraft')
})
