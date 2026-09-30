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
      }

      if (ctx && typeof ctx.on === 'function') ctx.on('dispose', cleanup)
      else if (ctx && typeof ctx.onCleanup === 'function') ctx.onCleanup(cleanup)
      else window.addEventListener('beforeunload', cleanup, { once: true })

      window.__lucyCompanion = {
        say: (text) => say(text || '你好呀', portraitRect()),
        speakNext,
        reload: load,
        lines: () => narration(data),
        data: () => data,
      }
    }

    /** No client services required: this plugin talks to the DOM and the whale's routes. */
    const inject = []

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
