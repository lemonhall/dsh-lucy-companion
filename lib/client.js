/**
 * Browser half of dsh-lucy-companion.
 *
 * Reuses dsh-whale-widget's data pipeline instead of re-implementing it: the
 * balance poller, the ledger, the peak/valley schedule, credential handling and
 * per-turn accounting all stay in that plugin's host half and are read here over
 * its own `/dsh-whale/*` routes, from inside the authenticated GUI page. This file
 * adds only presentation and interaction:
 *
 *   - the whale widget stops painting (`visibility: hidden`, so its own geometry
 *     stays valid and it never steals a click) while its host pipeline keeps running;
 *   - clicking the left Lucy opens a panel above her head: 余额 / 今日已用 / 近 7 天 /
 *     峰谷倒计时 / 上轮消耗, plus a self-rendered 明细 view (recent days with per-model
 *     cost and token counts) that matches whatever skin is active;
 *   - a finished turn auto-opens the panel with that turn's cost;
 *   - 「设置」hands over to the widget's own menu, which owns every remaining feature
 *     (角色、音效、泡泡编辑器、预算预警、多厂商…).
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
    const TURN_FLASH_MS = 4200
    const LEDGER_DAYS = 14

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

    function countdown(epochSeconds) {
      const seconds = Math.max(0, Math.round(epochSeconds - Date.now() / 1000))
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.round((seconds % 3600) / 60)
      if (hours >= 48) return `${Math.round(hours / 24)} 天后`
      if (hours > 0) return `${hours} 小时 ${minutes} 分后`
      return `${Math.max(1, minutes)} 分钟后`
    }

    const escape = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    function styles() {
      return `
/* the widget stays laid out, it just stops painting: visibility keeps its own
   geometry maths valid (its menu positions itself from that box) and, unlike
   display:none, it never becomes a click target */
.dshwv-root { visibility: hidden !important; }

.lucy-co-panel {
  position: fixed;
  z-index: 901;
  width: 316px;
  box-sizing: border-box;
  padding: 12px 14px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #ffffff2e);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-3, #14181dea);
  color: var(--dsw-alias-label-primary, #e9ecf1);
  box-shadow: 0 20px 46px #0000007a, 0 0 0 1px #0000001f inset;
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 12.5px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  opacity: 0;
  transform: translateY(6px) scale(0.98);
  transform-origin: 50% 100%;
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
  pointer-events: none;
}
.lucy-co-panel[data-open="true"] { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }

.lucy-co-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.lucy-co-name { font-weight: 600; letter-spacing: 0.04em; font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa4b2); }
.lucy-co-balance { margin-left: auto; font-size: 19px; font-weight: 650; font-variant-numeric: tabular-nums; }
.lucy-co-row { display: flex; align-items: baseline; gap: 8px; margin: 3px 0; }
.lucy-co-row > span:first-child { color: var(--dsw-alias-label-secondary, #9aa4b2); flex: none; }
.lucy-co-row > span:last-child { margin-left: auto; font-variant-numeric: tabular-nums; text-align: right; }
.lucy-co-warn { color: var(--dsw-alias-state-warning-primary, #e0a800); }
.lucy-co-ok { color: var(--dsw-alias-state-success-primary, #2fa36b); }

.lucy-co-bars { display: flex; align-items: flex-end; gap: 4px; height: 40px; margin: 9px 0 4px; }
.lucy-co-bar { flex: 1; min-height: 2px; border-radius: 3px 3px 1px 1px; background: var(--dsw-alias-brand-primary, #4c8dff); opacity: 0.85; }
.lucy-co-bar[data-today="true"] { opacity: 1; box-shadow: 0 0 0 1px var(--dsw-alias-label-primary, #fff) inset; }
.lucy-co-axis { display: flex; gap: 4px; font-size: 9.5px; color: var(--dsw-alias-label-caption, #6f7885); }
.lucy-co-axis > span { flex: 1; text-align: center; }

.lucy-co-ledger { max-height: 232px; overflow: auto; margin: 8px -4px 0; padding: 0 4px; }
.lucy-co-day { padding: 6px 0; border-top: 1px solid var(--dsw-alias-border-l1, #ffffff14); }
.lucy-co-day:first-child { border-top: 0; }
.lucy-co-dayhead { display: flex; align-items: baseline; gap: 8px; }
.lucy-co-dayhead > b { font-weight: 600; font-variant-numeric: tabular-nums; }
.lucy-co-dayhead > span { margin-left: auto; font-variant-numeric: tabular-nums; }
.lucy-co-daynote { font-size: 10.5px; color: var(--dsw-alias-label-caption, #6f7885); }
.lucy-co-model { display: flex; gap: 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #9aa4b2); }
.lucy-co-model > span:last-child { margin-left: auto; font-variant-numeric: tabular-nums; }

.lucy-co-foot { display: flex; gap: 6px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--dsw-alias-border-l1, #ffffff1f); }
.lucy-co-btn {
  flex: 1; font: inherit; font-size: 11.5px; padding: 5px 0; cursor: pointer;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, #ffffff2e);
  background: var(--dsw-alias-bg-layer-1, #ffffff10); color: var(--dsw-alias-label-primary, #e9ecf1);
  transition: background 0.12s, border-color 0.12s;
}
.lucy-co-btn:hover { border-color: var(--dsw-alias-label-dimmed, #ffffff5c); }
.lucy-co-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff); outline-offset: 1px; }
.lucy-co-btn[data-active="true"] { border-color: var(--dsw-alias-brand-primary, #4c8dff); }
.lucy-co-err { color: var(--dsw-alias-state-error-primary, #e5484d); font-size: 11.5px; margin-top: 6px; }
.lucy-co-turn { margin-top: 6px; color: var(--dsw-alias-label-secondary, #9aa4b2); font-variant-numeric: tabular-nums; }
.lucy-co-hint { margin-top: 6px; font-size: 10.5px; color: var(--dsw-alias-label-caption, #6f7885); }
@media (prefers-reduced-motion: reduce) { .lucy-co-panel { transition: none; } }
`
    }

    function apply(ctx) {
      if (typeof document === 'undefined' || !document.body) return

      const style = document.createElement('style')
      style.dataset.lucyCompanion = '1'
      style.textContent = styles()
      document.head.append(style)

      const panel = document.createElement('div')
      panel.className = 'lucy-co-panel'
      panel.dataset.open = 'false'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', '露西 · 余额与用量')
      document.body.append(panel)

      let open = false
      let view = 'summary'
      let hideTimer = 0
      let lastSeq = null
      let data = { balance: null, records: null, turn: null, error: '' }

      const setOpen = (next) => {
        open = next
        panel.dataset.open = next ? 'true' : 'false'
      }

      function position(rect) {
        // leave room for the skin's own comic bubble right above her head
        panel.style.bottom = `${Math.round(window.innerHeight - rect.top + 58)}px`
        const half = panel.offsetWidth / 2 || 158
        const center = rect.left + rect.width / 2
        panel.style.left = `${Math.round(clamp(half + 8, center, window.innerWidth - half - 8))}px`
        panel.style.transform = 'translateX(-50%)' + (open ? '' : ' translateY(6px) scale(0.98)')
      }

      function summaryView() {
        const b = data.balance
        const records = data.records
        const today = records && records.today
        const days = (records && records.days7) || []
        const maxDay = Math.max(0.01, ...days.map((d) => Number(d.amount) || 0))
        const peak = b ? (b.isPeak ? '高峰' : '空闲') : '—'
        const nextChange = b && b.peakNextChangeAt ? countdown(b.peakNextChangeAt) : ''

        return `
<div class="lucy-co-head">
  <span class="lucy-co-name">露西 · 夜城信号</span>
  <span class="lucy-co-balance">${b ? money(b.totalBalance, b.currency) : '—'}</span>
</div>
<div class="lucy-co-row"><span>余额来源</span><span>${b ? escape(b.balanceSource === 'apikey' ? 'API key' : b.balanceSource || '—') : '—'}</span></div>
<div class="lucy-co-row"><span>今日已用</span><span>${today ? money(today.amount, today.currency) + ' · ' + escape(today.label || '') : '—'}</span></div>
<div class="lucy-co-row"><span>近 7 天</span><span>${records ? money(records.total7, records.total7Currency) : '—'}</span></div>
<div class="lucy-co-row"><span>峰谷</span><span class="${b && b.isPeak ? 'lucy-co-warn' : 'lucy-co-ok'}">${peak}${nextChange ? ' · ' + nextChange : ''}</span></div>
${data.turn ? `<div class="lucy-co-turn">上轮消耗 ${money(data.turn.amount, 'CNY')} · ${tokenText(data.turn.tokens)} tokens</div>` : ''}
<div class="lucy-co-bars">${days.map((d) => `<div class="lucy-co-bar" data-today="${String(!!(today && d.day === today.day))}" style="height:${Math.max(4, Math.round((Number(d.amount) || 0) / maxDay * 40))}px" title="${escape(d.day)} ${money(d.amount, d.currency)}"></div>`).join('')}</div>
<div class="lucy-co-axis">${days.map((d) => `<span>${escape(String(d.day).slice(5))}</span>`).join('')}</div>`
      }

      function ledgerView() {
        const records = data.records
        const events = (records && records.all && records.all.events) || []
        const days = ((records && records.all && records.all.days) || []).slice(-LEDGER_DAYS).reverse()
        if (!days.length) return '<div class="lucy-co-ledger"><div class="lucy-co-daynote">还没有记账记录</div></div>'
        return `<div class="lucy-co-ledger">${days.map((d) => {
          const models = (d.models || []).filter((m) => Number(m.cost) > 0)
          const dayTokens = events
            .filter((e) => e.day === d.day)
            .reduce((sum, e) => sum + (Number(e.tokens) || 0), 0)
          const review = /needs-review/.test(String(d.source)) && !/待核对/.test(String(d.label || ''))
            ? ' · 待核对余额调整'
            : ''
          return `
<div class="lucy-co-day">
  <div class="lucy-co-dayhead"><b>${escape(String(d.day).slice(5))}</b><span>${money(d.amount, d.currency)}</span></div>
  <div class="lucy-co-daynote">${escape(d.label || '')}${review}${dayTokens ? ' · ' + tokenText(dayTokens) + ' tokens' : ''}</div>
  ${models.map((m) => `<div class="lucy-co-model"><span>${escape(m.model)}</span><span>${money(m.cost, m.currency)}</span></div>`).join('')}
</div>`
        }).join('')}</div>`
      }

      function render() {
        panel.innerHTML = `
${view === 'ledger' ? ledgerView() : summaryView()}
${data.error ? `<div class="lucy-co-err">${escape(data.error)}</div>` : ''}
<div class="lucy-co-foot">
  <button class="lucy-co-btn" data-act="refresh" type="button">刷新</button>
  <button class="lucy-co-btn" data-act="ledger" type="button" data-active="${String(view === 'ledger')}">${view === 'ledger' ? '概览' : '明细'}</button>
  <button class="lucy-co-btn" data-act="settings" type="button">设置</button>
</div>
<div class="lucy-co-hint">数据来自 dsh-whale-widget 的管线；设置是它自己的菜单</div>`
      }

      async function load() {
        try {
          const [balance, records, turn] = await Promise.all([
            getJson('/balance.json'),
            getJson('/usage-records.json'),
            getJson('/last-turn.json').catch(() => null),
          ])
          data = { balance, records, turn, error: '' }
          if (turn && typeof turn.seq === 'number') lastSeq = turn.seq
        } catch (error) {
          data = { ...data, error: '读取失败：' + (error && error.message ? error.message : String(error)) }
        }
        render()
      }

      /** Hand over to the widget's own menu: it owns every remaining feature. */
      function openWhaleMenu() {
        const menuButton = document.querySelector('.dshwv-menu-btn')
        if (!menuButton) return false
        const menu = document.querySelector('.dshwv-menu')
        const wasVisible = menu && getComputedStyle(menu).opacity !== '0'
        menuButton.click()
        if (wasVisible) return true
        // the widget positions its menu from its own box; nudge it into view when
        // that lands off-screen
        window.setTimeout(() => {
          const box = menu && menu.getBoundingClientRect()
          if (!box) return
          if (box.top < 8 || box.left < 8) {
            const anchor = panel.getBoundingClientRect()
            menu.style.left = `${Math.round(Math.min(window.innerWidth - box.width - 12, Math.max(12, anchor.left)))}px`
            menu.style.top = `${Math.round(Math.max(12, anchor.bottom + 10))}px`
          }
        }, 30)
        return true
      }

      const onPanelClick = (event) => {
        const button = event.target.closest('.lucy-co-btn')
        if (!button) return
        event.preventDefault()
        event.stopPropagation()
        const act = button.dataset.act
        if (act === 'ledger') {
          view = view === 'ledger' ? 'summary' : 'ledger'
          render()
          return
        }
        if (act === 'settings') {
          if (!openWhaleMenu()) load()
          return
        }
        load()
      }
      panel.addEventListener('click', onPanelClick)

      const onPointerDown = (event) => {
        if (panel.contains(event.target)) return
        const rect = portraitRect()
        if (!rect) return
        const onGirl =
          event.clientX >= rect.left - 8 && event.clientX <= rect.right + 8 &&
          event.clientY >= rect.top - 8 && event.clientY <= rect.top + rect.height * 0.72
        if (onGirl) {
          position(rect)
          setOpen(!open)
          if (open) load()
          return
        }
        if (open) setOpen(false)
      }
      document.addEventListener('pointerdown', onPointerDown, true)

      const onKeyDown = (event) => {
        if (event.key === 'Escape' && open) setOpen(false)
      }
      document.addEventListener('keydown', onKeyDown)

      const onResize = () => {
        if (!open) return
        const rect = portraitRect()
        if (rect) position(rect)
      }
      window.addEventListener('resize', onResize)

      // one flash per finished turn, driven by the pipeline's own seq counter
      window.setInterval(async () => {
        try {
          const turn = await getJson('/last-turn.json')
          if (!turn || typeof turn.seq !== 'number') return
          if (lastSeq !== null && turn.seq > lastSeq) {
            const rect = portraitRect()
            if (rect) {
              position(rect)
              data.turn = turn
              view = 'summary'
              render()
              setOpen(true)
              await load()
              window.clearTimeout(hideTimer)
              hideTimer = window.setTimeout(() => setOpen(false), TURN_FLASH_MS)
            }
          }
          lastSeq = turn.seq
          if (open) load()
        } catch {
          /* pipeline absent: the whale plugin may be disabled */
        }
      }, TURN_POLL_MS)

      const cleanup = () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('resize', onResize)
        panel.removeEventListener('click', onPanelClick)
        window.clearTimeout(hideTimer)
        panel.remove()
        style.remove()
      }

      if (ctx && typeof ctx.on === 'function') ctx.on('dispose', cleanup)
      else if (ctx && typeof ctx.onCleanup === 'function') ctx.onCleanup(cleanup)
      else window.addEventListener('beforeunload', cleanup, { once: true })

      window.__lucyCompanion = {
        open: () => { const rect = portraitRect(); if (rect) { position(rect); setOpen(true); load() } },
        close: () => setOpen(false),
        ledger: () => { view = 'ledger'; render() },
        load,
      }
    }

    /** No client services required: this plugin talks to the DOM and the whale's routes. */
    const inject = []

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
