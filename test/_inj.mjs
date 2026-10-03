const { Context } = await import('file:///C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js')
const ctx = new Context()
// What cordis does with each declaration shape.
const shapes = {
  'my current object': { optional: ['webServer', 'llm', 'agentDefaultModel'] },
  'empty array': [],
  'empty object': {},
  'array of names': ['webServer', 'llm'],
}
for (const [label, value] of Object.entries(shapes)) {
  const captured = []
  const fake = { inject: (names, cb) => { captured.push(names); if (cb) cb({}) } }
  // Re-implement resolve exactly as cordis does, to inspect the result.
  const result = Object.create(null)
  const inject = value
  if (!inject) { /* nothing */ }
  else if (Array.isArray(inject)) for (const n of inject) result[n] = null
  else for (const n of Object.keys(inject)) result[n] = inject[n] ?? null
  console.log(label.padEnd(20), '->', JSON.stringify(result))
}
