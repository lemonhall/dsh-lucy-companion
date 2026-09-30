/**
 * Browser half of dsh-lucy-companion.
 *
 * Reuses dsh-whale-widget's data pipeline instead of re-implementing it: balance
 * polling, the ledger, the peak/valley schedule, credential handling and per-turn
 * accounting all stay in that plugin's host half and are read here over its own
 * `/dsh-whale/*` routes, from inside the authenticated GUI page.
 *
 * This half only gives the left Lucy a voice:
 *
 *   - the whale widget stops painting (`visibility: hidden`: its own geometry maths
 *     stay valid and it can no longer steal a click) while its pipeline keeps running;
 *   - left-clicking Lucy types out one line about the numbers — 余额、今日已用、
 *     峰谷时段、上轮消耗、近 7 天、最近几天的账 — inside the same comic bubble the
 *     skin uses (a line per click, cycling, so she "natters" the way the whale did);
 *   - a finished turn types out what that turn cost;
 *   - right-clicking Lucy opens the widget's own menu, which still owns every other
 *     feature (角色、音效、泡泡编辑器、预算预警、多厂商、资源管理…);
 *   - while this narrator is loaded it sets `data-lucy-narrator`, which tells a
 *     skin's own hooks to keep quiet so two bubbles never fight over her head.
 *
 * Module shape mirrors @deepseek-ai/dsh-client-ui-brand-official: the GUI loader
 * wraps the factory, which exports `apply` and `inject`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-lucy-companion',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const WHALE = '/dsh-whale'
    const PORTRAIT = { aspect: 609 / 1800, height: [340, 0.62, 780], bottom: [-30, -0.02, -10] }
    const TURN_POLL_MS = 6000
    const HOLD_MS = 5200
    const TYPE_MS = 42

    const clamp = (min, value, max) => Math.min(max, Math.max(min, value))

    /** Where the left portrait sits, in viewport coordinates. */
    function portraitRect() {
      const card = document.querySelector('[data-composer-card]')
      if (!card) return null
      const cardBox = card.getBoundingClientRect()
      const height = clamp(PORTRAIT.height[0], window.innerHeight * PORTRAIT.height[1], PORTRAIT.height[2])
      const width = height * PORTRAIT.aspect
      const bottom = clamp(PORTRAIT.bottom[0], window.innerHeight * PORTRAIT.bottom[1], PORTRAIT.bottom[2])
      const top = window.innerHeight - bottom - height
      return { left: cardBox.left - width, right: cardBox.left, top, bottom: top + height, width, height }
    }

    async function getJson(path) {
      const response = await fetch(WHALE + path, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(path + ' -> ' + response.status)
      return response.json()
    }

    const money = (value, currency) =>
      (currency === 'USD' ? '$' : '¥') + (Number(value) || 0).toFixed(2)

    const tokenText = (value) => (Number(value) || 0) >= 1000
      ? (Number(value) / 1000).toFixed(0) + 'k'
      : String(Number(value) || 0)

    function nextChangeText(epochSeconds) {
      const seconds = Math.max(0, Math.round(epochSeconds - Date.now() / 1000))
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.round((seconds % 3600) / 60)
      if (hours >= 48) return `${Math.round(hours / 24)} 天后`
      if (hours > 0) return `${hours} 小时 ${minutes} 分后`
      return `${Math.max(1, minutes)} 分钟后`
    }

    /** The lines she can say, built from whatever the pipeline currently reports. */
    function narration(data) {
      const { balance, records, turn } = data
      const today = records && records.today
      const lines = []

      if (balance && Number.isFinite(Number(balance.totalBalance))) {
        lines.push(`余额还有 ${money(balance.totalBalance, balance.currency)}，够你折腾一阵`)
      }
      if (today) {
        lines.push(`今天已经烧掉 ${money(today.amount, today.currency)} 了`)
      }
      if (balance && balance.peakNextChangeAt) {
        lines.push(balance.isPeak
          ? `现在是高峰时段，贵；${nextChangeText(balance.peakNextChangeAt)}转谷价`
          : `现在谷价，放心用；${nextChangeText(balance.peakNextChangeAt)}转高峰`)
      }
      if (turn) {
        lines.push(`刚才那轮 ${money(turn.amount, 'CNY')}，${tokenText(turn.tokens)} tokens`)
      }
      if (records) {
        lines.push(`近 7 天一共 ${money(records.total7, records.total7Currency)}`)
      }
      const days = (records && records.all && records.all.days) || []
      const recent = days.slice(-3).reverse()
        .filter((day) => Number(day.amount) > 0)
        .map((day) => `${String(day.day).slice(5)} ${money(day.amount, day.currency)}`)
      if (recent.length) {
        lines.push(`这几天的账：${recent.join('，')}`)
      }
      lines.push('右键我可以打开设置')
      return lines
    }

    function styles() {
      return `
/* the widget keeps its layout (its menu positions itself from that box) but stops
   painting, and visibility:hidden never becomes a click target */
.dshwv-root { visibility: hidden !important; }

.lucy-narrator {
  position: fixed;
  z-index: 902;
  max-width: 340px;
  box-sizing: border-box;
  padding: 10px 14px 11px;
  border: 2px solid var(--dsw-alias-brand-primary, #7dffc0);
  border-radius: 14px;
  background: var(--dsw-alias-bg-overlay, #041610f7);
  backdrop-filter: blur(8px) saturate(1.05);
  color: var(--dsw-alias-label-primary, #e9ecf1);
  box-shadow: 0 14px 34px #00000073, 0 0 18px var(--dsw-alias-brand-primary, #3dff9e33);
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: 0.02em;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(0.96);
  transition: opacity 0.14s ease-out, transform 0.14s ease-out;
}
.lucy-narrator[data-shown="true"] { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
/* tail: a rotated square, so it works at any bubble width */
.lucy-narrator::after {
  content: "";
  position: absolute;
  left: var(--lucy-tail-x, 50%);
  bottom: -7px;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  background: var(--dsw-alias-bg-overlay, #041610f7);
  border-right: 2px solid var(--dsw-alias-brand-primary, #7dffc0);
  border-bottom: 2px solid var(--dsw-alias-brand-primary, #7dffc0);
  transform: rotate(45deg);
}
.lucy-narrator-caret {
  display: inline-block;
  width: 7px;
  height: 13px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--dsw-alias-brand-primary, #7dffc0);
  animation: lucy-caret 0.9s steps(2, start) infinite;
}
@keyframes lucy-caret { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .lucy-narrator { transition: none; }
  .lucy-narrator-caret { animation: none; }
}
`
    }

    function apply(ctx) {
      if (typeof document === 'undefined' || !document.body) return

      // ask any skin hooks to stay quiet: this plugin owns her bubble now
      document.documentElement.dataset.lucyNarrator = '1'

      const style = document.createElement('style')
      style.dataset.lucyCompanion = '1'
      style.textContent = styles()
      document.head.append(style)

      const bubble = document.createElement('div')
      bubble.className = 'lucy-narrator'
      bubble.dataset.shown = 'false'
      bubble.setAttribute('role', 'status')
      bubble.setAttribute('aria-live', 'polite')
      document.body.append(bubble)

      let data = { balance: null, records: null, turn: null, error: '' }
      let queue = []
      let cursor = 0
      let typeTimer = 0
      let holdTimer = 0
      let lastSeq = null
      let loading = false

      function position(rect) {
        bubble.style.bottom = `${Math.round(window.innerHeight - rect.top + 12)}px`
        const box = bubble.getBoundingClientRect()
        const half = box.width / 2 || 160
        const center = rect.left + rect.width / 2
        bubble.style.left = `${Math.round(clamp(half + 8, center, window.innerWidth - half - 8))}px`
      }

      /** Type `text` out, then keep it on screen for a while. */
      function say(text, rect) {
        if (rect) position(rect)
        window.clearInterval(typeTimer)
        window.clearTimeout(holdTimer)
        bubble.dataset.shown = 'true'
        bubble.style.setProperty('--lucy-tail-x', '50%')
        let index = 0
        const paint = () => {
          bubble.innerHTML = `${text.slice(0, index).replace(/&/g, '&amp;').replace(/</g, '&lt;')}<span class="lucy-narrator-caret"></span>`
        }
        paint()
        typeTimer = window.setInterval(() => {
          index += 1
          paint()
          if (index >= text.length) {
            window.clearInterval(typeTimer)
            bubble.textContent = text
            holdTimer = window.setTimeout(() => { bubble.dataset.shown = 'false' }, HOLD_MS)
          }
        }, TYPE_MS)
      }

      async function load() {
        if (loading) return
        loading = true
        try {
          const [balance, records, turn] = await Promise.all([
            getJson('/balance.json'),
            getJson('/usage-records.json'),
            getJson('/last-turn.json').catch(() => null),
          ])
          data = { balance, records, turn, error: '' }
          if (turn && typeof turn.seq === 'number') lastSeq = turn.seq
        } catch (error) {
          data = {
            ...data,
            error: /401|403/.test(String(error && error.message))
              ? '读不到账本，看看鲸鱼插件还在不在'
              : '信号不好，稍后再试',
          }
        } finally {
          loading = false
        }
      }

      /** One click, one line: build the queue if needed, then advance it. */
      async function speakNext() {
        const rect = portraitRect()
        if (data.error) {
          say(data.error, rect)
          data.error = ''
          load()
          return
        }
        if (!data.balance && !data.records) {
          say('信号接入中…', rect)
          await load()
          queue = narration(data)
          cursor = 0
          say(queue[0] || '账本还是空的', rect)
          cursor = 1
          return
        }
        if (!queue.length || cursor >= queue.length) {
          queue = narration(data)
          cursor = 0
        }
        const line = queue[cursor] || '没什么好念的了'
        cursor += 1
        say(line, rect)
        if (cursor >= queue.length) load()
      }

      function openWhaleMenu() {
        const menuButton = document.querySelector('.dshwv-menu-btn')
        if (!menuButton) return false
        const menu = document.querySelector('.dshwv-menu')
        const wasVisible = menu && getComputedStyle(menu).opacity !== '0'
        menuButton.click()
        if (wasVisible) return true
        window.setTimeout(() => {
          const box = menu && menu.getBoundingClientRect()
          if (!box) return
          if (box.top < 8 || box.left < 8) {
            const rect = portraitRect()
            menu.style.left = `${Math.round(Math.min(window.innerWidth - box.width - 12, Math.max(12, (rect ? rect.left : 12))))}px`
            menu.style.top = `${Math.round(Math.max(12, (rect ? rect.top : 12) - box.height - 12))}px`
          }
        }, 30)
        return true
      }

      const onPointerDown = (event) => {
        if (event.button !== 0) return
        const rect = portraitRect()
        if (!rect) return
        const onGirl =
          event.clientX >= rect.left - 8 && event.clientX <= rect.right + 8 &&
          event.clientY >= rect.top - 8 && event.clientY <= rect.top + rect.height * 0.72
        if (!onGirl) {
          if (bubble.dataset.shown === 'true') bubble.dataset.shown = 'false'
          return
        }
        event.preventDefault()
        speakNext()
      }
      document.addEventListener('pointerdown', onPointerDown, true)

      const onContextMenu = (event) => {
        const rect = portraitRect()
        if (!rect) return
        const onGirl =
          event.clientX >= rect.left - 8 && event.clientX <= rect.right + 8 &&
          event.clientY >= rect.top - 8 && event.clientY <= rect.top + rect.height * 0.72
        if (!onGirl) return
        event.preventDefault()
        if (openWhaleMenu()) say('设置给你打开啦', rect)
      }
      document.addEventListener('contextmenu', onContextMenu, true)

      // narrate what a finished turn cost, using the pipeline's own seq counter
      window.setInterval(async () => {
        try {
          const turn = await getJson('/last-turn.json')
          if (!turn || typeof turn.seq !== 'number') return
          if (lastSeq !== null && turn.seq > lastSeq) {
            data.turn = turn
            queue = []
            cursor = 0
            say(`刚才那轮 ${money(turn.amount, 'CNY')}，${tokenText(turn.tokens)} tokens`, portraitRect())
            load()
          }
          lastSeq = turn.seq
        } catch {
          /* pipeline absent: the whale plugin may be disabled */
        }
      }, TURN_POLL_MS)

      const cleanup = () => {
        delete document.documentElement.dataset.lucyNarrator
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('contextmenu', onContextMenu, true)
        window.clearInterval(typeTimer)
        window.clearTimeout(holdTimer)
        bubble.remove()
        style.remove()
        try { disposeWebviews() } catch { /* already gone */ }
        try { disposeBookmarks() } catch { /* already gone */ }
        try { disposePaneWidth() } catch { /* already gone */ }
      }

      const disposeWebviews = crtifyWebviews()
      const disposeBookmarks = mountBookmarks()
      const disposePaneWidth = mountPaneWidth()

      if (ctx && typeof ctx.on === 'function') ctx.on('dispose', cleanup)
      else if (ctx && typeof ctx.onCleanup === 'function') ctx.onCleanup(cleanup)
      else window.addEventListener('beforeunload', cleanup, { once: true })

      window.__lucyCompanion = {
        say: (text) => say(text || '你好呀', portraitRect()),
        speakNext,
        reload: load,
        lines: () => narration(data),
        data: () => data,
        paneWidth: {
          get: () => paneWidth(),
          stored: () => readStoredPaneWidth(),
          apply: (px) => applyPaneWidth(px),
          forget: () => window.localStorage.removeItem(PANE_WIDTH_KEY),
        },
      }
    }



    // ---------------------------------------------------------------------
    // Chrome bookmarks. The renderer cannot read disk, so the host half serves
    // them; this side renders a panel: search across every folder, click to open
    // in the embedded browser. Bookmarks only — no history, passwords or cookies.
    // ---------------------------------------------------------------------
    const BOOKMARK_ROUTE = '/dsh-lucy/bookmarks.json'

    function flattenBookmarks(nodes, out = []) {
      for (const node of nodes || []) {
        if (node.u) out.push(node)
        if (node.c) flattenBookmarks(node.c, out)
      }
      return out
    }

    function bookmarksCss() {
      return `
.lucy-bm-btn {
  /* Top-left of the pane. Measured: the pane's own header content starts ~91px in
     (the portrait inset pushes it right), leaving that corner free - the earlier
     top-right placement collided with the pane's own buttons and the bottom-left
     one was easy to miss. */
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 905;
  display: none;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  padding: 0 10px;
  height: 30px;
  flex: none;
  align-self: flex-start;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l3, #ffffff3d);
  background: var(--dsw-alias-bg-layer-4, #ffffff1f);
  color: var(--dsw-alias-label-primary, #e9ecf1);
  box-shadow: 0 2px 10px #0000005c;
}
[data-rightbar-col] .lucy-bm-btn { display: inline-flex; }
.lucy-bm-btn:hover { border-color: var(--dsw-alias-brand-primary, #4c8dff); }
.lucy-bm-btn[data-open="true"] { border-color: var(--dsw-alias-brand-primary, #4c8dff); }
.lucy-bm-panel {
  position: fixed;
  z-index: 904;
  width: 430px;
  max-height: 62vh;
  box-sizing: border-box;
  display: none;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border: 1px solid var(--dsw-alias-border-l2, #ffffff2e);
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay, #0d1117f5);
  backdrop-filter: blur(10px) saturate(1.05);
  color: var(--dsw-alias-label-primary, #e9ecf1);
  box-shadow: 0 18px 44px #00000080;
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 12.5px;
}
.lucy-bm-panel[data-open="true"] { display: flex; }
.lucy-bm-head { display: flex; align-items: baseline; gap: 8px; padding-right: 8px; }
.lucy-bm-title { font-weight: 600; }
.lucy-bm-count { margin-left: auto; color: var(--dsw-alias-label-caption, #6f7885); font-size: 11px; }
.lucy-bm-search {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 12.5px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, #ffffff2e);
  background: var(--dsw-specific-input-major, #0003);
  color: var(--dsw-alias-label-primary, #e9ecf1);
}
.lucy-bm-tree { overflow: auto; flex: 1; margin: 0 -4px; padding: 0 8px 2px 4px; scrollbar-gutter: stable; }
.lucy-bm-folder > summary { cursor: pointer; padding: 3px 0; color: var(--dsw-alias-label-secondary, #9aa4b2); }
.lucy-bm-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
  width: 100%;
  text-align: left;
  font: inherit;
  font-size: 12px;
  padding: 2px 4px 2px 14px;
  cursor: pointer;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e9ecf1);
}
.lucy-bm-item:hover { background: var(--dsw-alias-interactive-bg-hover, #ffffff14); }
.lucy-bm-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lucy-bm-path { margin-left: auto; color: var(--dsw-alias-label-caption, #6f7885); font-size: 10.5px; flex: none; }
.lucy-bm-note { color: var(--dsw-alias-label-caption, #6f7885); font-size: 11px; }
`
    }

    /** The bookmarks panel, wired to the embedded browser. */
    /** Local HTML-escape helper. Do NOT call the global `escape()`: it is the
     * deprecated one and turns non-ASCII into `%uXXXX`, which is exactly how the
     * first version of this panel mangled every Chinese bookmark name. */
    const escText = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    function mountBookmarks() {
      const style = document.createElement('style')
      style.dataset.lucyBookmarks = '1'
      style.textContent = bookmarksCss()
      document.head.append(style)

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'lucy-bm-btn'
      button.textContent = '★ 书签'
      const panel = document.createElement('div')
      panel.className = 'lucy-bm-panel'
      panel.dataset.open = 'false'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', 'Chrome 书签')

      const attach = () => {
        const pane = document.querySelector('[data-rightbar-col]')
        if (!pane) return false
        if (button.parentElement !== pane) pane.append(button)
        if (panel.parentElement !== document.body) document.body.append(panel)
        return true
      }
      attach()
      // the pane can be closed when this mounts (and reopened later), so keep
      // watching instead of attaching once
      const attachObserver = new MutationObserver(() => attach())
      attachObserver.observe(document.body, { childList: true, subtree: true })

      let data = null
      let loading = false

      async function load() {
        if (loading) return
        loading = true
        panel.innerHTML = '<div class="lucy-bm-head"><span class="lucy-bm-title">★ Chrome 书签</span></div><div class="lucy-bm-note">读取中…</div>'
        try {
          const response = await fetch(BOOKMARK_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          data = await response.json()
        } catch (error) {
          panel.innerHTML = `<div class="lucy-bm-head"><span class="lucy-bm-title">★ Chrome 书签</span></div><div class="lucy-bm-note">读取失败：${escText(String((error && error.message) || error))}</div>`
          loading = false
          return
        }
        render('')
        loading = false
      }

      /**
       * Load `url` in the pane's embedded browser.
       *
       * The plugin that owns that browser exports no open-URL API, so the pane is
       * driven through its own controls - and precisely: an existing browser TAB
       * (`role=tab`) is activated first, and only when none exists is the start
       * card used. Matching loosely on the text "浏览器" once hit the wrong control
       * (the toolbar's "open in the system browser" button), which is why a click
       * used to launch desktop Chrome with whatever page was already loaded.
       */
      async function openInBrowser(url) {
        const findView = () => document.querySelector('webview')
        let view = findView()
        if (!view) {
          const pane = document.querySelector('[data-rightbar-col]')
          if (pane) {
            const tab = [...pane.querySelectorAll('[role=tab]')]
              .find((el) => /浏览器/.test((el.textContent || '').trim()))
            if (tab) {
              tab.click()
            } else {
              const card = [...pane.querySelectorAll('button, [role=button]')]
                .find((el) => /^浏览器/.test((el.textContent || '').trim()) && /浏览网页|Ctrl\s*\+\s*T/.test((el.textContent || '') + (el.getAttribute('title') || '')))
              if (card) card.click()
              else {
                const startTab = [...pane.querySelectorAll('[role=tab]')]
                  .find((el) => /开始/.test((el.textContent || '').trim()))
                if (startTab) startTab.click()
              }
            }
          }
          for (let i = 0; i < 30 && !view; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 120))
            view = findView()
          }
        }
        if (view && typeof view.loadURL === 'function') {
          view.loadURL(url)
          return true
        }
        return false
      }

      function render(query) {
        const all = (data && data.profiles) || []
        // the host only reads stable Chrome; this keeps older host halves (and any
        // beta/dev channel that shows up later) out of the list too
        const stable = all.filter((profile) => profile.browser === 'Chrome')
        const profiles = stable.length ? stable : all
        const needle = query.trim().toLowerCase()
        const total = profiles.reduce((sum, p) => sum + flattenBookmarks(p.bar).length + flattenBookmarks(p.other).length + flattenBookmarks(p.synced).length, 0)
        const head = `<div class="lucy-bm-head"><span class="lucy-bm-title">★ Chrome 书签</span><span class="lucy-bm-count">${profiles.map((p) => `${p.profile} ${p.from === 'Bookmarks' ? '' : '(bak) '}`).join(' · ') || '未找到'} · ${total} 条</span></div>`

        if (!profiles.length) {
          panel.innerHTML = head + '<div class="lucy-bm-note">没有读到 Chrome 书签：确认 Chrome 装在本机并至少打开过一次</div>'
          return
        }

        if (needle) {
          const hits = []
          for (const profile of profiles) {
            for (const source of ['bar', 'other', 'synced']) {
              for (const item of flattenBookmarks(profile[source])) {
                if (item.n.toLowerCase().includes(needle) || item.u.toLowerCase().includes(needle)) {
                  hits.push({ ...item, profile: profile.profile })
                }
              }
            }
          }
          panel.innerHTML = head +
            '<input class="lucy-bm-search" placeholder="搜索书签（名称或网址）" value="' + escText(query) + '">' +
            `<div class="lucy-bm-tree">${hits.slice(0, 60).map((item) =>
              `<button class="lucy-bm-item" data-url="${escText(item.u)}"><span class="lucy-bm-name">${escText(item.n)}</span><span class="lucy-bm-path">${escText(item.p || item.profile)}</span></button>`).join('') ||
              '<div class="lucy-bm-note">没有匹配</div>'}</div>` +
            (hits.length > 60 ? `<div class="lucy-bm-note">共 ${hits.length} 条匹配，只显示前 60 条</div>` : '')
          return
        }

        const tree = (nodes) => nodes.map((node) => {
          if (node.u) {
            return `<button class="lucy-bm-item" data-url="${escText(node.u)}"><span class="lucy-bm-name">${escText(node.n)}</span></button>`
          }
          return `<details class="lucy-bm-folder"><summary>${escText(node.n || '(未命名)')} <span class="lucy-bm-path">${(node.c || []).length}</span></summary>${tree(node.c || [])}</details>`
        }).join('')

        panel.innerHTML = head +
          '<input class="lucy-bm-search" placeholder="搜索书签（名称或网址）">' +
          `<div class="lucy-bm-tree">${profiles.map((profile, index) =>
            // the first (stable Chrome) tree starts expanded: one less click before
            // the user sees their actual bookmark bar
            `<details class="lucy-bm-folder" ${index === 0 || profiles.length === 1 ? 'open' : ''}><summary>${escText(profile.browser)} · ${escText(profile.profile)}</summary>${tree(profile.bar)}${tree(profile.other)}${tree(profile.synced)}</details>`).join('')}</div>`
      }

      const closePanel = () => {
        panel.dataset.open = 'false'
        button.dataset.open = 'false'
      }

      const onClick = (event) => {
        // clicking anywhere outside the panel (and off the button) dismisses it
        if (panel.dataset.open === 'true' && !panel.contains(event.target) && event.target !== button && !button.contains(event.target)) {
          closePanel()
          if (event.target.closest('.lucy-bm-item')) return
        }
        const item = event.target.closest('.lucy-bm-item')
        if (item && item.dataset.url) {
          const note = panel.querySelector('.lucy-bm-note')
          openInBrowser(item.dataset.url).then((done) => {
            if (done) {
              // the click did what it should: get the panel out of the way
              panel.dataset.open = 'false'
              button.dataset.open = 'false'
            } else if (note) {
              note.textContent = '这个页面没有可用的内嵌浏览器：先在右栏打开「浏览器」卡片，再点书签'
            }
          })
          return
        }
        if (event.target === button) {
          attach()
          const open = panel.dataset.open === 'true'
          if (open) {
            closePanel()
            return
          }
          const box = button.getBoundingClientRect()
          // drop the panel straight down from the top-left button
          panel.style.bottom = 'auto'
          panel.style.top = `${Math.round(box.bottom + 8)}px`
          panel.style.left = `${Math.round(Math.max(12, Math.min(box.left, window.innerWidth - 442)))}px`
          panel.dataset.open = 'true'
          button.dataset.open = 'true'
          if (!data) load()
        }
      }
      document.addEventListener('click', onClick, true)

      const onInput = (event) => {
        if (event.target.classList && event.target.classList.contains('lucy-bm-search')) {
          render(event.target.value)
          const input = panel.querySelector('.lucy-bm-search')
          if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length) }
        }
      }
      document.addEventListener('input', onInput, true)

      const onKey = (event) => {
        if (event.key === 'Escape' && panel.dataset.open === 'true') closePanel()
      }
      document.addEventListener('keydown', onKey)

      return () => {
        attachObserver.disconnect()
        document.removeEventListener('click', onClick, true)
        document.removeEventListener('input', onInput, true)
        document.removeEventListener('keydown', onKey)
        button.remove()
        panel.remove()
        style.remove()
      }
    }


    // ---------------------------------------------------------------------
    // The right pane's width has no persisted home: the app only writes it into
    // the frame's inline grid, so a restart forgets it. Remember the width the
    // user dragged to and put it back on every boot / reopen.
    // ---------------------------------------------------------------------
    const PANE_WIDTH_KEY = 'dsh.lucy.rightbar-width'
    const PANE_WIDTH_MIN = 240

    /** The frame element that owns the three grid tracks. */
    function frameEl() {
      return document.querySelector('[class*="_frame"]')
    }

    function paneEl() {
      return document.querySelector('[data-rightbar-col]')
    }

    function paneWidth() {
      const pane = paneEl()
      return pane ? Math.round(pane.getBoundingClientRect().width) : 0
    }

    function readStoredPaneWidth() {
      const raw = Number(window.localStorage.getItem(PANE_WIDTH_KEY))
      return Number.isFinite(raw) && raw >= PANE_WIDTH_MIN ? Math.round(raw) : 0
    }

    /** Rewrite the pane track, keeping the app's own two other tracks. */
    function applyPaneWidth(px) {
      const frame = frameEl()
      const pane = paneEl()
      if (!frame || !pane || !px) return false
      if (frame.hasAttribute('data-rightbar-collapsed')) return false
      if (Math.abs(paneWidth() - px) <= 8) return true
      const computed = getComputedStyle(frame).gridTemplateColumns.split(' ').filter(Boolean)
      if (computed.length < 3) return false
      // keep the sidebar + centre tracks as the app laid them out, replace the pane
      frame.style.gridTemplateColumns = `${computed[0]} minmax(400px, 1fr) minmax(0px, ${px}px)`
      return true
    }

    /** Remember deliberate widths, ignore the collapsed (0px) and default states. */
    function mountPaneWidth() {
      let lastStored = readStoredPaneWidth()
      let applying = false
      let settle = 0

      const remember = () => {
        const width = paneWidth()
        const collapsed = frameEl() && frameEl().hasAttribute('data-rightbar-collapsed')
        if (collapsed || width < PANE_WIDTH_MIN) return
        if (Math.abs(width - lastStored) <= 8) return
        lastStored = width
        try { window.localStorage.setItem(PANE_WIDTH_KEY, String(width)) } catch { /* storage full */ }
      }

      const onSettle = () => {
        window.clearTimeout(settle)
        settle = window.setTimeout(() => {
          if (applying) return
          remember()
        }, 400)
      }

      const observer = new ResizeObserver(onSettle)
      const pane = paneEl()
      if (pane) observer.observe(pane)

      // the pane element is recreated when the pane opens; re-observe and re-apply
      const bodyObserver = new MutationObserver(() => {
        const current = paneEl()
        if (current && current !== observer.__el) {
          observer.__el = current
          observer.observe(current)
          const stored = readStoredPaneWidth()
          if (stored) {
            applying = true
            applyPaneWidth(stored)
            window.setTimeout(() => { applying = false }, 500)
          }
        }
      })
      bodyObserver.observe(document.body, { childList: true, subtree: true })

      // and once on boot
      const stored = readStoredPaneWidth()
      if (stored) {
        applying = true
        let tries = 0
        const boot = window.setInterval(() => {
          tries += 1
          applyPaneWidth(stored)
          if (tries > 20) {
            window.clearInterval(boot)
            applying = false
          }
        }, 250)
      }

      return () => {
        observer.disconnect()
        bodyObserver.disconnect()
        window.clearTimeout(settle)
      }
    }

    // ---------------------------------------------------------------------
    // The in-GUI browser is an Electron <webview>: whatever site it loads can
    // be given the CRT treatment from here, and `insertCSS` applies to the page
    // itself, so it works cross-origin where a parent-document stylesheet could
    // not. Re-injected on every navigation because the page is replaced.
    // ---------------------------------------------------------------------
    const CRT_FONT_CANDIDATES = [
      '/api/skin-center/v2/skins/crt-phosphor/assets/fusion-pixel-12px-monospaced.woff2',
    ]
    let fontDataUrlPromise = null

    /** The skin's pixel face as a data URL, so a foreign page can use it too. */
    function pixelFontDataUrl() {
      if (fontDataUrlPromise) return fontDataUrlPromise
      fontDataUrlPromise = (async () => {
        for (const url of CRT_FONT_CANDIDATES) {
          try {
            const response = await fetch(url)
            if (!response.ok) continue
            const bytes = new Uint8Array(await response.arrayBuffer())
            let binary = ''
            for (let i = 0; i < bytes.length; i += 8192) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
            }
            return 'data:font/woff2;base64,' + window.btoa(binary)
          } catch {
            /* try the next candidate */
          }
        }
        return ''
      })()
      return fontDataUrlPromise
    }

    /** The CRT stylesheet handed to every page the embedded browser loads. */
    function crtPageCss(fontUrl) {
      const face = fontUrl
        ? `@font-face{font-family:"Lucy CRT Pixel";src:url(${fontUrl}) format("woff2");font-display:swap;}`
        : ''
      const stack = fontUrl
        ? '"Lucy CRT Pixel",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
        : 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
      return `${face}
html{background:#02120a !important;filter:grayscale(1) sepia(1) hue-rotate(62deg) saturate(2.6) contrast(1.12);}
html,body{background:#02120a !important;color:#b9ffd8 !important;}
/* a light page turned green is unreadable: drop the site's own paper and paint the
   tube instead, keeping media (which carries the visible content) untouched */
*:not(img):not(video):not(canvas):not(svg):not(iframe){background-color:transparent !important;background-image:none !important;box-shadow:none !important;border-color:rgba(61,255,158,.32) !important;}
img,video,canvas,svg{filter:saturate(.55) hue-rotate(70deg) contrast(1.05);}
body,body *{font-family:${stack} !important;text-shadow:0 0 1px rgba(61,255,158,.35);}
a,a *{color:#7dffc0 !important;}
::selection{background:#3dff9e !important;color:#02150c !important;text-shadow:none !important;}
html::after{content:"";position:fixed;inset:0;z-index:2147483647;pointer-events:none;
  background:repeating-linear-gradient(180deg,rgba(0,0,0,.20) 0 1px,rgba(0,0,0,0) 1px 3px),
             radial-gradient(125% 105% at 50% 50%,rgba(0,0,0,0) 55%,rgba(0,0,0,.55) 100%);
  mix-blend-mode:multiply;}
input,textarea,select,button{background:#04160e !important;border-color:rgba(61,255,158,.35) !important;}
*{scrollbar-color:rgba(61,255,158,.45) transparent;}`
    }

    /**
     * Style every page the embedded browser shows, now and after each navigation.
     * Returns a disposer.
     */
    function crtifyWebviews() {
      const seen = new WeakSet()
      const disposers = []

      const decorate = (view) => {
        if (!view || seen.has(view)) return
        seen.add(view)
        const paint = async () => {
          const css = crtPageCss(await pixelFontDataUrl())
          try {
            if (typeof view.insertCSS === 'function') await view.insertCSS(css)
            else if (typeof view.executeJavaScript === 'function') {
              await view.executeJavaScript(
                `(()=>{const id='lucy-crt-page';let s=document.getElementById(id);` +
                `if(!s){s=document.createElement('style');s.id=id;(document.head||document.documentElement).appendChild(s);}` +
                `s.textContent=${JSON.stringify(css)};})()`,
                true,
              )
            }
          } catch {
            /* a page may refuse; the next navigation tries again */
          }
        }
        view.addEventListener('dom-ready', paint)
        disposers.push(() => view.removeEventListener('dom-ready', paint))
        paint()
      }

      const scan = () => {
        document.querySelectorAll('webview').forEach(decorate)
      }
      scan()
      const observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true })
      disposers.push(() => observer.disconnect())
      return () => disposers.forEach((fn) => fn())
    }

    /** No client services required: this plugin talks to the DOM and the whale's routes. */
    const inject = []

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
