/**
 * The shared React stand-in for the browser-half tests.
 *
 * Two test files exercise the client bundle, and both need the same fake
 * runtime. Keeping one copy is not a style preference: the copies had already
 * drifted, and the drifted one hid a real defect. `createElement` had put
 * children on the element while React puts them in `props.children`, so a
 * component branching on `props.children !== undefined` silently took its
 * fallback branch and the diff view rendered nothing. The tests passed, because
 * they only asserted the toggle's own state.
 *
 * This module therefore deliberately mirrors React's shape:
 *
 *   - children live in `props.children`;
 *   - an element whose expanded children are empty has no `children` key at
 *     all, so `!== undefined` sees undefined, exactly as React leaves it;
 *   - hooks are stored per mounted component, so a `setState` lands on the
 *     component that owns it and re-renders it;
 *   - hook cursors are saved and restored around a child's render, so a child's
 *     `useMemo` cannot advance its parent's cursor.
 *
 * @module dsh-prompt-optimizer/test/helpers/react-stub
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** The browser bundle under test. */
export const CLIENT_SOURCE = readFileSync(join(here, '..', '..', 'lib', 'client.js'), 'utf8')

/**
 * The bundle calls a bare `fetch`, which resolves lexically to the realm's
 * global — an injected globalThis cannot intercept it. The global is therefore
 * replaced once per process with a proxy that delegates to a swappable slot.
 */
let fetchImpl = async () => { throw new Error('no fetch stub installed') }
if (globalThis.fetch?.__dshpoProxy !== true) {
  const proxy = (url, init) => fetchImpl(String(url).startsWith('/') ? 'http://localhost' + url : url, init)
  proxy.__dshpoProxy = true
  globalThis.fetch = proxy
  globalThis.location = { href: 'http://localhost/' }
}

/** Build a fresh React stand-in for one test. */
export function makeReact() {
  let current = null

  const react = {
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      // React puts children in props. A mock that keeps them only on the
      // element cannot render a component that branches on props.children.
      const base = props === null || props === undefined ? {} : { ...props }
      if (flat.length > 0) base.children = flat
      return { type, props: base }
    },

    useState(initial) {
      const store = current
      const index = store.cursor++
      if (store.hooks.length <= index) {
        store.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = store.hooks[index]
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        store.schedule()
      }]
    },

    useEffect(fn) {
      const store = current
      const index = store.cursor++
      if (store.hooks.length <= index) {
        store.hooks[index] = { ran: true }
        store.cleanups.push(fn() ?? (() => {}))
      }
    },

    useCallback(fn) { current.cursor += 1; return fn },
    useMemo(fn) { current.cursor += 1; return fn() },

    useRef(initial) {
      const store = current
      const index = store.cursor++
      if (store.hooks.length <= index) store.hooks[index] = { current: initial }
      return store.hooks[index]
    },

    /**
     * Render function components the way React does.
     * @param node - the node to expand.
     */
    __expand(node) {
      if (node === null || node === undefined || typeof node !== 'object') return node
      if (Array.isArray(node)) return node.map((c) => react.__expand(c)).flat(Infinity).filter((c) => c !== null && c !== undefined)
      if (typeof node.type === 'function') {
        const parent = current
        const saved = parent === null ? 0 : parent.cursor
        const childStore = { hooks: [], cursor: 0, cleanups: [], props: node.props, tree: null, alive: true, schedule() {} }
        current = childStore
        let rendered
        try {
          rendered = node.type(node.props)
        } finally {
          current = parent
          if (parent !== null) parent.cursor = saved
        }
        return react.__expand(rendered)
      }
      const raw = node.props?.children ?? []
      const kids = raw.map((c) => react.__expand(c)).flat(Infinity).filter((c) => c !== null && c !== undefined)
      const nextProps = { ...node.props }
      if (kids.length > 0) nextProps.children = kids
      else delete nextProps.children
      return { type: node.type, props: nextProps }
    },

    /**
     * Mount a component and return a handle whose `tree` reflects the latest
     * render.
     */
    __mount(component, props) {
      const store = {
        hooks: [], cursor: 0, cleanups: [], props, tree: null, alive: true,
        render() {
          if (!store.alive) return store.tree
          store.cursor = 0
          const previous = current
          current = store
          try {
            store.tree = react.__expand(component(store.props))
          } finally {
            current = previous
          }
          return store.tree
        },
        schedule() {
          if (store.pending) return
          store.pending = true
          queueMicrotask(() => { store.pending = false; store.render() })
        },
        unmount() {
          store.alive = false
          for (const cleanup of store.cleanups) if (typeof cleanup === 'function') cleanup()
        },
      }
      store.render()
      return store
    },
  }
  return react
}

/**
 * Load the client bundle against stubs.
 * @param options - the fetch stub.
 * @returns the plugin face plus captured slot registrations.
 */
export function loadClient(options = {}) {
  fetchImpl = options.fetch ?? (async () => { throw new Error('no fetch stub') })
  const react = options.react ?? makeReact()
  const registrations = []
  const injections = []
  let face = null

  const windowStub = {
    __ModuleLoader__: {
      load({ id, factory }) {
        face = factory((specifier) => {
          if (specifier === 'react') return react
          throw new Error('unexpected require: ' + specifier)
        })
        face.__id = id
      },
    },
    crypto: { getRandomValues: (array) => { for (let i = 0; i < array.length; i += 1) array[i] = i + 1; return array } },
  }
  const documentStub = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
  }

  const scope = { window: windowStub, document: documentStub, location: { href: 'http://localhost/' } }
  new Function('window', 'document', 'globalThis', CLIENT_SOURCE).call(scope, windowStub, documentStub, scope)

  face.apply({
    slots: {
      inject(key, callback) { injections.push(key); callback() },
      register(spec, component) { registrations.push({ spec, component }); return () => {} },
    },
  })

  return { face, registrations, injections, react }
}

/** Let queued microtasks (state updates, fetch promises) settle. */
export function settle() { return new Promise((resolve) => setTimeout(resolve, 20)) }

/** Every text node in a rendered tree, flattened. */
export function textOf(node, out = []) {
  if (typeof node === 'string') { out.push(node); return out }
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const c of node) textOf(c, out); return out }
  for (const c of node.props?.children ?? []) textOf(c, out)
  return out
}

/** Depth-first search for the first node satisfying a predicate. */
export function findNode(node, predicate) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate)
      if (found !== null) return found
    }
    return null
  }
  if (predicate(node)) return node
  for (const child of node.props?.children ?? []) {
    const found = findNode(child, predicate)
    if (found !== null) return found
  }
  return null
}

/** Collect every node satisfying a predicate. */
export function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out }
  if (predicate(node)) out.push(node)
  for (const child of node.props?.children ?? []) findAll(child, predicate, out)
  return out
}

/** Look up a registered slot component by slot name. */
export function componentOf(registrations, slotName) {
  const entry = registrations.find((r) => r.spec.name === slotName)
  if (entry === undefined) throw new Error('no registration for ' + slotName)
  return entry.component
}
