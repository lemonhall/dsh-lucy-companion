/**
 * Host half of dsh-lucy-companion.
 *
 * The browser half runs in the GUI renderer, which has no filesystem access, so
 * reading anything off the disk has to happen here. This half publishes exactly one
 * thing — the user's Chrome bookmarks — on a fenced, read-only route:
 *
 *   GET /dsh-lucy/bookmarks.json
 *
 * Chrome keeps bookmarks as plain JSON per profile
 * (`%LOCALAPPDATA%\Google\Chrome\<channel>\User Data\<profile>\Bookmarks`), so this
 * is a read of files the user already owns; nothing is written back, and no other
 * browser data (history, passwords, cookies) is touched.
 *
 * The fence mirrors what dsh-whale-widget does on this exact build: same-origin and
 * non-cross-site checks locally, plus the host's own `connection.requestRejection`
 * when it is available, fail-closed on any error.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Single route this half serves. */
const ROUTE = '/dsh-lucy/bookmarks.json'
/** Profile directories Chrome uses besides `Default`. */
const PROFILE_DIR = /^Profile \d+$/

/** Chrome channel installs, in the order a user is likely to care about them. */
function chromeRoots() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const candidates = [
    ['Chrome', join(local, 'Google', 'Chrome', 'User Data')],
    ['Chrome Beta', join(local, 'Google', 'Chrome Beta', 'User Data')],
    ['Chrome Dev', join(local, 'Google', 'Chrome Dev', 'User Data')],
    ['Chrome Canary', join(local, 'Google', 'Chrome SxS', 'User Data')],
  ]
  return candidates.filter(([, dir]) => existsSync(dir))
}

/** Chrome's bookmark nodes -> the compact shape the panel renders. */
function walk(node, trail) {
  const items = []
  for (const child of (node && node.children) || []) {
    if (!child) continue
    if (child.type === 'url' && child.url) {
      items.push({ n: child.name || child.url, u: child.url, p: trail })
    } else if (child.type === 'folder') {
      const name = child.name || ''
      items.push({ n: name, f: 1, p: trail, c: walk(child, trail ? `${trail}/${name}` : name) })
    }
  }
  return items
}

/** Every readable Chrome profile, newest file first. */
function readProfiles() {
  const profiles = []
  for (const [browser, root] of chromeRoots()) {
    let dirs = []
    try {
      dirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || PROFILE_DIR.test(entry.name)))
        .map((entry) => entry.name)
    } catch {
      continue
    }
    for (const dir of dirs) {
      const live = join(root, dir, 'Bookmarks')
      const backup = join(root, dir, 'Bookmarks.bak')
      const file = existsSync(live) ? live : existsSync(backup) ? backup : null
      if (!file) continue
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'))
        const roots = data.roots || {}
        profiles.push({
          browser,
          profile: dir,
          from: file === live ? 'Bookmarks' : 'Bookmarks.bak',
          bar: walk(roots.bookmark_bar, ''),
          other: walk(roots.other, '其他书签'),
          synced: walk(roots.synced, '移动设备'),
        })
      } catch {
        /* unreadable or mid-write: skip this profile, never fail the route */
      }
    }
  }
  return profiles
}

/** Hosts that count as "this machine / this app" without asking the host fence. */
const LOCAL_HOSTS = new Set(['dsh-app', 'app', 'localhost', '127.0.0.1', '::1', '[::1]'])

function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  if (!host) return false
  if (LOCAL_HOSTS.has(host)) return true
  if (host.endsWith('.localhost')) return true
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
}

/**
 * Local checks, mirroring the reviewed plugin's self-fence: GET/HEAD only, no
 * cross-site fetch, and an Origin that belongs to this app. Returns a status code
 * when the request must be refused, otherwise null.
 *
 * The desktop app reaches its own routes with the `dsh-app` authority, which is
 * why the host fence must only be consulted for genuinely foreign hosts - asking
 * it unconditionally rejects the app's own requests with 403.
 */
function localRejection(req) {
  const headers = (req && req.headers) || {}
  const method = String((req && req.method) || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return 405
  if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
  const origin = headers.origin
  if (typeof origin === 'string' && origin && origin !== 'null') {
    try {
      const parsed = new URL(origin)
      // the app's own custom scheme, or a same-host http origin
      if (parsed.protocol !== 'dsh-app:') {
        const host = new URL('http://' + String(headers.host || '')).host.toLowerCase()
        if (parsed.host.toLowerCase() !== host) return 403
      }
    } catch {
      return 403
    }
  }
  return null
}

/** Host plugin body: one fenced read-only route. */
function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    const disposers = []
    const reject = (req, res, code) => {
      try { res.statusCode = code; res.end() } catch { /* already closed */ }
      return true
    }
    const dispose = scoped.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: (req, res) => {
        const local = localRejection(req)
        if (local !== null) return reject(req, res, local)
        let hostname = ''
        try { hostname = new URL('http://' + String((req.headers || {}).host || '')).hostname } catch { hostname = '' }
        if (!isLocalHost(hostname)) {
          try {
            const fence = scoped.connection && typeof scoped.connection.requestRejection === 'function'
              ? scoped.connection.requestRejection(req)
              : 403
            if (fence) return reject(req, res, typeof fence === 'number' ? fence : 403)
          } catch {
            return reject(req, res, 403)
          }
        }
        try {
          const body = JSON.stringify({ ok: true, generatedAt: Date.now(), profiles: readProfiles() })
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(body),
          })
          res.end(body)
        } catch (error) {
          try { res.statusCode = 500; res.end(String((error && error.message) || error)) } catch { /* closed */ }
        }
      },
    })
    if (typeof dispose === 'function') disposers.push(dispose)
    ctx.on('dispose', () => disposers.forEach((fn) => { try { fn() } catch { /* gone */ } }))
  })
}

export { apply }
