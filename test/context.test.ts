/**
 * Context reader tests: the project rule allowlist and the conversation trimmer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RULE_FILES, readProjectRules } from '../src/context/project.ts'
import { trimConversation } from '../src/context/conversation.ts'

/** A throwaway project directory. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'dshpo-proj-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// --- project rules --------------------------------------------------------

test('the allowlist contains only declarative rule files', () => {
  assert.ok(RULE_FILES.includes('AGENTS.md'))
  assert.ok(RULE_FILES.includes('DESIGN.md'))
  assert.ok(RULE_FILES.includes('.prompt-rules'))
  // Source code must never be on the list.
  for (const forbidden of ['index.ts', 'package.json', 'src', 'main.js']) {
    assert.ok(!RULE_FILES.includes(forbidden), forbidden + ' must not be readable')
  }
})

test('a missing directory yields no rules', () => {
  assert.deepEqual(readProjectRules(undefined), [])
  assert.deepEqual(readProjectRules(''), [])
  assert.deepEqual(readProjectRules('   '), [])
  assert.deepEqual(readProjectRules('D:/definitely/not/here'), [])
})

test('an empty directory yields no rules', () => {
  const s = scratch()
  try {
    assert.deepEqual(readProjectRules(s.dir), [])
  } finally {
    s.cleanup()
  }
})

test('present rule files are read in allowlist order', () => {
  const s = scratch()
  try {
    writeFileSync(join(s.dir, 'DESIGN.md'), '设计规范', 'utf8')
    writeFileSync(join(s.dir, 'AGENTS.md'), '项目规则', 'utf8')
    const rules = readProjectRules(s.dir)
    assert.deepEqual(rules.map((r) => r.file), ['AGENTS.md', 'DESIGN.md'])
    assert.equal(rules[0].text, '项目规则')
  } finally {
    s.cleanup()
  }
})

test('the .prompt-rules file is read', () => {
  const s = scratch()
  try {
    writeFileSync(join(s.dir, '.prompt-rules'), '简洁优先', 'utf8')
    const rules = readProjectRules(s.dir)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].file, '.prompt-rules')
  } finally {
    s.cleanup()
  }
})

test('source files are never read even when present', () => {
  const s = scratch()
  try {
    writeFileSync(join(s.dir, 'index.ts'), 'const secret = 1', 'utf8')
    writeFileSync(join(s.dir, 'package.json'), '{}', 'utf8')
    assert.deepEqual(readProjectRules(s.dir), [])
  } finally {
    s.cleanup()
  }
})

test('a directory named like a rule file is skipped', () => {
  const s = scratch()
  try {
    mkdirSync(join(s.dir, 'AGENTS.md'))
    assert.deepEqual(readProjectRules(s.dir), [])
  } finally {
    s.cleanup()
  }
})

test('an oversized rule file is truncated, not dropped', () => {
  const s = scratch()
  try {
    writeFileSync(join(s.dir, 'AGENTS.md'), 'x'.repeat(40000), 'utf8')
    const rules = readProjectRules(s.dir)
    assert.equal(rules.length, 1)
    assert.ok(rules[0].text.length < 40000)
    assert.ok(rules[0].text.includes('truncated'))
  } finally {
    s.cleanup()
  }
})

test('a binary-looking file is skipped', () => {
  const s = scratch()
  try {
    writeFileSync(join(s.dir, 'README.md'), 'ok\u0000binary', 'utf8')
    assert.deepEqual(readProjectRules(s.dir), [])
  } finally {
    s.cleanup()
  }
})

test('the total across files stays bounded', () => {
  const s = scratch()
  try {
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'DESIGN.md', 'CONTRIBUTING.md']) {
      writeFileSync(join(s.dir, name), 'y'.repeat(16000), 'utf8')
    }
    const total = readProjectRules(s.dir).reduce((sum, rule) => sum + rule.text.length, 0)
    assert.ok(total <= 32 * 1024, 'total was ' + total)
  } finally {
    s.cleanup()
  }
})

test('a whitespace-only rule file is skipped', () => {
  const s = scratch()
  try {
    writeFileSync(join(s.dir, 'AGENTS.md'), '   \n\t  ', 'utf8')
    assert.deepEqual(readProjectRules(s.dir), [])
  } finally {
    s.cleanup()
  }
})

// --- conversation ---------------------------------------------------------

test('a non-array conversation yields nothing', () => {
  assert.deepEqual(trimConversation(undefined), [])
  assert.deepEqual(trimConversation(null), [])
  assert.deepEqual(trimConversation('nope'), [])
  assert.deepEqual(trimConversation({}), [])
})

test('malformed turns are dropped', () => {
  const turns = trimConversation([
    { role: 'user', text: 'ok' },
    { role: 'system', text: 'dropped' },
    { role: 'user' },
    { text: 'no role' },
    null,
    { role: 'assistant', text: '   ' },
    { role: 'assistant', text: 'kept' },
  ])
  assert.deepEqual(turns, [{ role: 'user', text: 'ok' }, { role: 'assistant', text: 'kept' }])
})

test('the tail is kept, oldest first', () => {
  const raw = Array.from({ length: 12 }, (_, i) => ({ role: 'user', text: 'turn' + i }))
  const turns = trimConversation(raw)
  assert.ok(turns.length <= 6)
  assert.equal(turns[turns.length - 1].text, 'turn11')
  // Order is oldest-first.
  assert.equal(turns[0].text, 'turn' + (12 - turns.length))
})

test('a very long turn is capped', () => {
  const turns = trimConversation([{ role: 'user', text: 'z'.repeat(5000) }])
  assert.equal(turns.length, 1)
  assert.equal(turns[0].text.length, 1200)
})

test('the total stays within budget', () => {
  const raw = Array.from({ length: 6 }, () => ({ role: 'user', text: 'w'.repeat(1200) }))
  const total = trimConversation(raw).reduce((sum, turn) => sum + turn.text.length, 0)
  assert.ok(total <= 4000, 'total was ' + total)
})

test('an empty conversation yields nothing', () => {
  assert.deepEqual(trimConversation([]), [])
})
