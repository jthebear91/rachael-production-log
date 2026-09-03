import { useState, useEffect, useCallback } from 'react'

// Categories hidden from the Daily Log screen's Category row. These still
// exist in Square — they're just not shown here. Edit this list to change
// what's hidden (name match is case-insensitive).
const HIDDEN_CATEGORIES = [
  'Dry Goods',
  'Cajun Market Meats Products',
  'Battered Freezer',
  'Raw Goods (frozen)',
  'Raw Goods (Refrigerated)',
  'Uncategorized',
  'Vegetables'
]

export default function App() {
  // ── SCREEN ─────────────────────────────────────
  const [screen, setScreen] = useState('log') // 'log' | 'batches'

  // ── CATALOG ────────────────────────────────────
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')

  // ── LOG SCREEN ─────────────────────────────────
  const [activeCat, setActiveCat] = useState(null)
  const [activeItem, setActiveItem] = useState(null)
  const [qty, setQty] = useState(1)
  const [log, setLog] = useState([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState(null) // 'success' | 'error'
  const [pushError, setPushError] = useState('')

  // ── TODOIST CATEGORY (Daily Log) ────────────────
  // Everything for a Todoist-sourced batch happens right here: pick one or
  // more same-item tasks, enter the cases produced, and it's logged as a
  // finished ("packaged") batch in one step — Batch Tracker just displays
  // the result afterward.
  const TODOIST_CAT_ID = 'todoist'
  const [todoistItems, setTodoistItems] = useState([])
  const [todoistLoading, setTodoistLoading] = useState(false)
  const [todoistError, setTodoistError] = useState('')
  const [loggingTodoist, setLoggingTodoist] = useState(false)
  const [selectedTodoistIds, setSelectedTodoistIds] = useState([])
  const [selectedTodoistItemName, setSelectedTodoistItemName] = useState('')
  const [todoistCasesInput, setTodoistCasesInput] = useState('')

  // ── BATCH SCREEN (read-only display) ───────────
  const [batches, setBatches] = useState([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchTab, setBatchTab] = useState('pending') // 'pending' | 'history' | 'byItem'
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null) // item_name or null

  // ── STATUS TOAST ───────────────────────────────
  const [toast, setToast] = useState({ msg: '', type: '' })

  function showToast(msg, type = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '', type: '' }), 5000)
  }

  // ── LOAD CATALOG ───────────────────────────────
  useEffect(() => {
    fetch('/api/catalog')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setCatalogError(data.error); return }
        setCategories(data.categories || [])
        setItems(data.items || [])
        setCatalogLoading(false)
      })
      .catch(e => { setCatalogError(e.message); setCatalogLoading(false) })
  }, [])

  // ── LOAD BATCHES ───────────────────────────────
  const loadBatches = useCallback(async () => {
    setBatchLoading(true)
    try {
      const r = await fetch('/api/get-batches')
      const data = await r.json()
      setBatches(Array.isArray(data) ? data : [])
    } catch (e) {
      setBatches([])
    }
    setBatchLoading(false)
  }, [])

  useEffect(() => {
    if (screen === 'batches') loadBatches()
  }, [screen, loadBatches])

  // ── LOAD TODOIST ITEMS (for the red category) ──
  const loadTodoistItems = useCallback(async () => {
    setTodoistLoading(true)
    setTodoistError('')
    try {
      const r = await fetch('/api/todoist-tasks')
      const data = await r.json()
      setTodoistItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setTodoistError('Could not load Todoist tasks')
      setTodoistItems([])
    }
    setTodoistLoading(false)
  }, [])

  useEffect(() => {
    if (activeCat === TODOIST_CAT_ID) loadTodoistItems()
  }, [activeCat, loadTodoistItems])

  function resetSelections() {
    setActiveItem(null)
    setSelectedTodoistIds([])
    setSelectedTodoistItemName('')
    setTodoistCasesInput('')
  }

  // ── LOG HELPERS (catalog items) ─────────────────
  function addToLog() {
    if (!activeItem) return
    const n = parseInt(qty) || 1
    const existing = log.findIndex(e => e.variationId === activeItem.variationId)
    if (existing >= 0) {
      const updated = [...log]
      updated[existing].qty += n
      setLog(updated)
    } else {
      setLog([...log, { ...activeItem, qty: n }])
    }
    setActiveItem(null)
    setQty(1)
  }

  // ── TODOIST SELECTION ───────────────────────────
  // Tapping an item toggles it in/out of the selection. Selecting items of
  // a different name than what's already picked starts a fresh selection —
  // you can only combine batches of the SAME item together.
  function toggleTodoistItem(item) {
    setSelectedTodoistIds(prev => {
      if (prev.includes(item.taskId)) {
        const next = prev.filter(id => id !== item.taskId)
        if (next.length === 0) setSelectedTodoistItemName('')
        return next
      }
      if (prev.length > 0 && selectedTodoistItemName !== item.itemName) {
        setSelectedTodoistItemName(item.itemName)
        return [item.taskId]
      }
      setSelectedTodoistItemName(item.itemName)
      return [...prev, item.taskId]
    })
  }

  // ── LOG (AND PACKAGE) SELECTED TODOIST BATCHES ──
  async function logTodoistBatches() {
    if (!selectedTodoistIds.length || !todoistCasesInput) return
    setLoggingTodoist(true)
    try {
      const firstItem = todoistItems.find(t => selectedTodoistIds.includes(t.taskId))
      const r = await fetch('/api/log-todoist-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskIds: selectedTodoistIds,
          itemName: selectedTodoistItemName,
          batchSize: firstItem?.batchSize || '1 Batch',
          casesProduced: parseInt(todoistCasesInput)
        })
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      showToast(
        `Logged ${selectedTodoistIds.length} batch${selectedTodoistIds.length !== 1 ? 'es' : ''} of ${selectedTodoistItemName} — ${todoistCasesInput} cases`,
        'info'
      )
      setTodoistItems(prev => prev.filter(t => !selectedTodoistIds.includes(t.taskId)))
      setSelectedTodoistIds([])
      setSelectedTodoistItemName('')
      setTodoistCasesInput('')
    } catch (e) {
      showToast('Could not log batch: ' + e.message, 'error')
    }
    setLoggingTodoist(false)
  }

  function removeFromLog(i) {
    setLog(log.filter((_, idx) => idx !== i))
  }

  async function pushToSquare() {
    setPushing(true)
    try {
      const r = await fetch('/api/push-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: log })
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setPushResult('success')
    } catch (e) {
      setPushError(e.message)
      setPushResult('error')
    }
    setPushing(false)
    setShowConfirm(false)
  }

  function clearLog() {
    setLog([])
    setPushResult(null)
    setPushError('')
  }

  // ── DATE HELPERS ───────────────────────────────
  function fmtDate(str) {
    if (!str) return '—'
    const d = new Date(str)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const today = new Date()
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' })
  const dateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const filteredItems = items.filter(i => i.categoryIds.includes(activeCat))
  const activeCatObj = categories.find(c => c.id === activeCat)
  const visibleCategories = categories.filter(
    cat => !HIDDEN_CATEGORIES.some(hidden => hidden.toLowerCase() === (cat.name || '').toLowerCase())
  )
  const pendingBatches = batches.filter(b => b.status === 'cooked')
  const historyBatches = batches.filter(b => b.status === 'packaged')
  const totalUnits = log.reduce((s, e) => s + e.qty, 0)

  // ── BY-ITEM HISTORY (Batch Tracker "By Item" tab) ──
  // Groups every logged batch by item name so you can see everything you've
  // ever made, then drill into one item for its date-by-date history.
  const itemNames = [...new Set(batches.map(b => b.item_name))].sort()
  function batchesForItem(name) {
    return batches
      .filter(b => b.item_name === name)
      .sort((a, b) => new Date(b.packaged_at || b.cooked_at) - new Date(a.packaged_at || a.cooked_at))
  }
  function averageCasesFor(name) {
    const packaged = batches.filter(b => b.item_name === name && b.status === 'packaged' && b.cases_produced != null)
    if (!packaged.length) return null
    const sum = packaged.reduce((s, b) => s + Number(b.cases_produced), 0)
    return (sum / packaged.length).toFixed(1)
  }

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── HEADER ── */}
      <header style={s.header}>
        <div>
          <div style={s.h1}>Production Log</div>
          <div style={s.hsub}>Rachael's Wholesale LLC</div>
        </div>
        <div style={s.hright}>
          <span style={s.hdate}>{dayName}, {dateStr}</span>
          <button
            style={{ ...s.tabBtn, ...(screen === 'log' ? s.tabActive : {}) }}
            onClick={() => setScreen('log')}
          >Daily Log</button>
          <button
            style={{ ...s.tabBtn, ...(screen === 'batches' ? s.tabActive : {}) }}
            onClick={() => setScreen('batches')}
          >Batch Tracker</button>
        </div>
      </header>

      {/* ── TOAST ── */}
      {toast.msg && (
        <div style={{ ...s.toast, ...(toast.type === 'error' ? s.toastErr : s.toastInfo) }}>
          {toast.msg}
        </div>
      )}

      {/* ══════════════════════════════════════════
          SCREEN: DAILY LOG
      ══════════════════════════════════════════ */}
      {screen === 'log' && (
        <div style={s.layout}>

          {/* LEFT */}
          <div style={s.controls}>

            {/* Categories */}
            <div>
              <div style={s.sectionLabel}>Category</div>
              {catalogLoading && <div style={s.placeholder}>Loading your Square catalog…</div>}
              {catalogError && <div style={{ ...s.placeholder, color: 'var(--red)' }}>{catalogError}</div>}
              {!catalogLoading && !catalogError && (
                <div style={s.pills}>
                  <button
                    style={{ ...s.pill, ...s.pillTodoist, ...(activeCat === TODOIST_CAT_ID ? s.pillTodoistActive : {}) }}
                    onClick={() => { setActiveCat(TODOIST_CAT_ID); resetSelections() }}
                  >Todoist</button>
                  {visibleCategories.map(cat => (
                    <button
                      key={cat.id}
                      style={{ ...s.pill, ...(activeCat === cat.id ? s.pillActive : {}) }}
                      onClick={() => { setActiveCat(cat.id); resetSelections() }}
                    >{cat.name}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Items */}
            <div>
              <div style={s.sectionLabel}>Item</div>
              {!activeCat && <div style={s.placeholder}>Pick a category above</div>}

              {/* TODOIST ITEMS */}
              {activeCat === TODOIST_CAT_ID && (
                <>
                  {todoistLoading && <div style={s.placeholder}>Loading Todoist tasks…</div>}
                  {todoistError && <div style={{ ...s.placeholder, color: 'var(--red)' }}>{todoistError}</div>}
                  {!todoistLoading && !todoistError && todoistItems.length === 0 && (
                    <div style={s.placeholder}>Nothing pending on Todoist right now.</div>
                  )}
                  {!todoistLoading && todoistItems.length > 0 && (
                    <>
                      <div style={{ ...s.placeholder, marginBottom: 8 }}>
                        Tap one or more batches of the SAME item to combine them, then enter the cases produced below.
                      </div>
                      <div style={s.itemGrid}>
                        {todoistItems.map(item => {
                          const sel = selectedTodoistIds.includes(item.taskId)
                          return (
                            <button
                              key={item.taskId}
                              style={{ ...s.itemBtn, ...s.itemBtnTodoist, ...(sel ? s.itemBtnSelected : {}) }}
                              onClick={() => toggleTodoistItem(item)}
                            >{sel ? '✓ ' : ''}{item.batchSize} — {item.itemName}</button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* CATALOG ITEMS */}
              {activeCat && activeCat !== TODOIST_CAT_ID && filteredItems.length === 0 && <div style={s.placeholder}>No items in this category</div>}
              {activeCat && activeCat !== TODOIST_CAT_ID && filteredItems.length > 0 && (
                <div style={s.itemGrid}>
                  {filteredItems.map(item => (
                    <button
                      key={item.variationId}
                      style={{ ...s.itemBtn, ...(activeItem?.variationId === item.variationId ? s.itemActive : {}) }}
                      onClick={() => setActiveItem({ ...item, categoryName: activeCatObj?.name || 'Uncategorized' })}
                    >{item.name}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom panel — Todoist cases input, or catalog qty/add */}
            {activeCat === TODOIST_CAT_ID ? (
              selectedTodoistIds.length > 0 && (
                <>
                  <div>
                    <div style={s.sectionLabel}>Cases Produced</div>
                    <div style={s.placeholder}>
                      {selectedTodoistIds.length} batch{selectedTodoistIds.length !== 1 ? 'es' : ''} of <strong>{selectedTodoistItemName}</strong> selected. Enter the total cases made — this logs it as packaged and checks the task{selectedTodoistIds.length !== 1 ? 's' : ''} off in Todoist.
                    </div>
                    <input
                      style={{ ...s.modalInput, fontSize: 24, fontWeight: 700, textAlign: 'center', padding: '14px', marginTop: 10 }}
                      type="number" min="1"
                      value={todoistCasesInput}
                      onChange={e => setTodoistCasesInput(e.target.value)}
                      placeholder="0"
                      autoFocus
                    />
                  </div>
                  <button
                    style={{ ...s.btnGreen, opacity: (loggingTodoist || !todoistCasesInput) ? 0.5 : 1, cursor: (loggingTodoist || !todoistCasesInput) ? 'not-allowed' : 'pointer' }}
                    onClick={logTodoistBatches}
                    disabled={loggingTodoist || !todoistCasesInput}
                  >{loggingTodoist ? 'Logging…' : '✓ Log & Package'}</button>
                </>
              )
            ) : (
              <>
                <div>
                  <div style={s.sectionLabel}>Quantity Produced</div>
                  <div style={s.qtyRow}>
                    <div style={s.stepper}>
                      <button style={s.stepBtn} onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                      <input
                        style={s.stepNum}
                        type="number" min="1" max="999"
                        value={qty}
                        onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                      />
                      <button style={s.stepBtn} onClick={() => setQty(q => Math.min(999, q + 1))}>+</button>
                    </div>
                    <span style={s.qtyUnit}>cases / units</span>
                  </div>
                </div>

                <button
                  style={{ ...s.btnGreen, opacity: activeItem ? 1 : 0.35, cursor: activeItem ? 'pointer' : 'not-allowed' }}
                  onClick={addToLog}
                  disabled={!activeItem}
                >+ Add to Today's Log</button>
              </>
            )}

          </div>

          {/* RIGHT: LOG PANEL */}
          <div style={s.logPanel}>
            <div style={s.logTop}>
              <span style={s.sectionLabel}>Today's Production</span>
              <span style={s.tally}>{log.length} item{log.length !== 1 ? 's' : ''}</span>
            </div>

            <div style={s.logList}>
              {log.length === 0 && (
                <div style={s.logEmpty}>Nothing logged yet.<br /><br />Select an item and tap<br />"Add to Today's Log".</div>
              )}
              {log.map((entry, i) => (
                <div key={i} style={s.logEntry}>
                  <div style={s.entryQty}>{entry.qty}</div>
                  <div style={s.entryMeta}>
                    <div style={s.entryName}>{entry.name}</div>
                    <div style={s.entryCat}>{entry.categoryName}</div>
                  </div>
                  <button style={s.entryDel} onClick={() => removeFromLog(i)}>×</button>
                </div>
              ))}
            </div>

            <div style={s.logFooter}>
              {log.length > 0 && (
                <div style={s.logTotal}>
                  <span style={{ color: 'var(--muted)' }}>Total Units</span>
                  <span style={{ fontWeight: 700, fontSize: 17 }}>{totalUnits}</span>
                </div>
              )}
              <button
                style={{ ...s.btnGreen, opacity: log.length ? 1 : 0.3, cursor: log.length ? 'pointer' : 'not-allowed' }}
                onClick={() => setShowConfirm(true)}
                disabled={!log.length}
              >📦 Add to Square Inventory</button>
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════
          SCREEN: BATCH TRACKER (read-only display)
      ══════════════════════════════════════════ */}
      {screen === 'batches' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Batch toolbar */}
          <div style={s.batchToolbar}>
            <div style={s.batchTabs}>
              <button
                style={{ ...s.batchTab, ...(batchTab === 'pending' ? s.batchTabActive : {}) }}
                onClick={() => setBatchTab('pending')}
              >Pending ({pendingBatches.length})</button>
              <button
                style={{ ...s.batchTab, ...(batchTab === 'history' ? s.batchTabActive : {}) }}
                onClick={() => setBatchTab('history')}
              >Yield History ({historyBatches.length})</button>
              <button
                style={{ ...s.batchTab, ...(batchTab === 'byItem' ? s.batchTabActive : {}) }}
                onClick={() => setBatchTab('byItem')}
              >By Item ({itemNames.length})</button>
            </div>
          </div>

          {/* Batch list */}
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {batchLoading && <div style={s.placeholder}>Loading batches…</div>}

            {/* PENDING */}
            {batchTab === 'pending' && !batchLoading && (
              <>
                {pendingBatches.length === 0 && (
                  <div style={s.logEmpty}>No pending batches.<br /><br />Batches you log from the Daily Log's Todoist category are packaged right away — this tab is only for anything still waiting on a case count.</div>
                )}
                <div style={s.batchGrid}>
                  {pendingBatches.map(b => (
                    <div key={b.id} style={s.batchCard}>
                      <div style={s.batchCardName}>{b.item_name}</div>
                      <div style={s.batchCardSize}>{b.batch_size}</div>
                      <div style={s.batchCardDate}>Cooked {fmtDate(b.cooked_at)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* HISTORY */}
            {batchTab === 'history' && !batchLoading && (
              <>
                {historyBatches.length === 0 && (
                  <div style={s.logEmpty}>No packaging history yet.<br /><br />Log a batch from the Daily Log's Todoist category to start tracking yields.</div>
                )}
                <div style={s.historyTable}>
                  {historyBatches.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)' }}>
                          {['Item', 'Batch Size', 'Cooked', 'Packaged', 'Cases'].map(h => (
                            <th key={h} style={s.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {historyBatches.map((b, i) => (
                          <tr key={b.id} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                            <td style={s.td}>{b.item_name}</td>
                            <td style={s.td}>{b.batch_size}</td>
                            <td style={s.td}>{fmtDate(b.cooked_at)}</td>
                            <td style={s.td}>{fmtDate(b.packaged_at)}</td>
                            <td style={{ ...s.td, fontWeight: 700, color: 'var(--green)', textAlign: 'center' }}>{b.cases_produced}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}

            {/* BY ITEM */}
            {batchTab === 'byItem' && !batchLoading && (
              <>
                {itemNames.length === 0 && (
                  <div style={s.logEmpty}>Nothing made yet.<br /><br />Once you log batches from Daily Log, every item you've made will show up here.</div>
                )}
                <div style={s.batchGrid}>
                  {itemNames.map(name => {
                    const entries = batchesForItem(name)
                    const avg = averageCasesFor(name)
                    return (
                      <div
                        key={name}
                        style={{ ...s.batchCard, cursor: 'pointer' }}
                        onClick={() => setSelectedHistoryItem(name)}
                      >
                        <div style={s.batchCardName}>{name}</div>
                        <div style={s.batchCardSize}>{entries.length} batch{entries.length !== 1 ? 'es' : ''}</div>
                        <div style={s.batchCardDate}>{avg ? `Avg ${avg} cases/batch` : 'No packaged batches yet'}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── ITEM HISTORY MODAL ── */}
      {selectedHistoryItem && (
        <div style={s.overlay} onClick={() => setSelectedHistoryItem(null)}>
          <div style={{ ...s.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <h2 style={s.modalH}>{selectedHistoryItem}</h2>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--muted)' }}>Average</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: 'var(--green)', letterSpacing: 1 }}>
                  {averageCasesFor(selectedHistoryItem) || '—'} {averageCasesFor(selectedHistoryItem) ? 'cases' : ''}
                </div>
              </div>
            </div>
            <div style={{ ...s.historyTable, marginTop: 16, maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Date', 'Batch Size', 'Amount Made'].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batchesForItem(selectedHistoryItem).map((b, i) => (
                    <tr key={b.id} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                      <td style={s.td}>{fmtDate(b.packaged_at || b.cooked_at)}</td>
                      <td style={s.td}>{b.batch_size}</td>
                      <td style={s.td}>{b.status === 'packaged' ? `${b.cases_produced} cases` : 'Not packaged yet'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={s.modalBtns}>
              <button style={s.btnGhost} onClick={() => setSelectedHistoryItem(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFIRM MODAL ── */}
      {showConfirm && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h2 style={s.modalH}>Confirm Push to Square</h2>
            <p style={s.modalSub}>These items will be added as stock received. This cannot be undone.</p>
            <div style={s.confirmList}>
              {log.map((e, i) => (
                <div key={i} style={s.confirmRow}>
                  <span style={{ fontWeight: 500 }}>{e.name}</span>
                  <span style={s.confirmQty}>+{e.qty}</span>
                </div>
              ))}
            </div>
            <div style={s.modalBtns}>
              <button style={s.btnGhost} onClick={() => setShowConfirm(false)}>Cancel</button>
              <button style={s.btnConfirm} onClick={pushToSquare} disabled={pushing}>
                {pushing ? 'Pushing…' : '✓ Push to Square'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SUCCESS MODAL ── */}
      {pushResult === 'success' && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, textAlign: 'center' }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
            <h2 style={s.modalH}>Inventory Updated!</h2>
            <p style={{ ...s.modalSub, textAlign: 'center' }}>
              {log.length} item type{log.length !== 1 ? 's' : ''} · {totalUnits} total units added to Square.
            </p>
            <button style={{ ...s.btnConfirm, marginTop: 24 }} onClick={clearLog}>Clear Log &amp; Start New Day</button>
          </div>
        </div>
      )}

      {/* ── ERROR MODAL ── */}
      {pushResult === 'error' && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h2 style={{ ...s.modalH, color: 'var(--red)' }}>Push Failed</h2>
            <p style={s.modalSub}>{pushError}</p>
            <div style={s.modalBtns}>
              <button style={s.btnGhost} onClick={() => setPushResult(null)}>Close</button>
              <button style={s.btnConfirm} onClick={() => { setPushResult(null); setShowConfirm(true) }}>Try Again</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ══════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════
const s = {
  header: {
    background: '#1c1c1c', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '13px 24px', flexShrink: 0, gap: 16, flexWrap: 'wrap'
  },
  h1: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 2.5 },
  hsub: { fontSize: 10, color: '#999', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 1 },
  hright: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  hdate: { fontSize: 12, color: '#aaa', whiteSpace: 'nowrap' },
  tabBtn: {
    background: 'none', border: '1px solid #3a3a3a', borderRadius: 6,
    color: '#999', fontSize: 13, fontWeight: 600, padding: '7px 16px',
    transition: 'all 0.12s', minHeight: 38
  },
  tabActive: { background: '#fff', color: '#1c1c1c', borderColor: '#fff' },

  toast: {
    padding: '10px 24px', fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0
  },
  toastInfo: { background: '#e8f5ee', borderBottom: '1px solid #b8ddc8', color: '#1a6b3a' },
  toastErr:  { background: '#fdf2f2', borderBottom: '1px solid #f5c0b8', color: '#c0392b' },

  layout: { display: 'grid', gridTemplateColumns: '1fr 340px', flex: 1, minHeight: 0, overflow: 'hidden' },

  controls: {
    padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 22,
    overflowY: 'auto', borderRight: '1px solid #e0ddd8'
  },

  sectionLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: '#888', marginBottom: 10, display: 'block' },
  placeholder: { color: '#888', fontSize: 13 },

  pills: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  pill: {
    background: '#fff', border: '1.5px solid #e0ddd8', borderRadius: 999,
    fontSize: 13, fontWeight: 600, padding: '8px 18px', minHeight: 40, color: '#1c1c1c'
  },
  pillActive: { background: '#1c1c1c', borderColor: '#1c1c1c', color: '#fff' },
  pillTodoist: { background: '#c0392b', borderColor: '#c0392b', color: '#fff', fontWeight: 700 },
  pillTodoistActive: { background: '#8e2a1f', borderColor: '#8e2a1f' },

  itemGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 8 },
  itemBtn: {
    background: '#fff', border: '1.5px solid #e0ddd8', borderRadius: 8,
    fontSize: 13, fontWeight: 500, padding: '12px 10px', minHeight: 52,
    color: '#1c1c1c', textAlign: 'center', lineHeight: 1.3
  },
  itemActive: { background: '#1c1c1c', borderColor: '#1c1c1c', color: '#fff', fontWeight: 600 },
  itemBtnTodoist: { borderColor: '#e6b3ac' },
  itemBtnSelected: { background: '#1a6b3a', borderColor: '#1a6b3a', color: '#fff', fontWeight: 700 },

  qtyRow: { display: 'flex', alignItems: 'center', gap: 14 },
  stepper: { display: 'flex', alignItems: 'center', border: '1.5px solid #e0ddd8', borderRadius: 8, background: '#fff', overflow: 'hidden' },
  stepBtn: { background: 'none', border: 'none', fontSize: 24, fontWeight: 300, width: 52, height: 52, color: '#1c1c1c', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: 24, fontWeight: 700, width: 70, height: 52, textAlign: 'center', border: 'none', borderLeft: '1.5px solid #e0ddd8', borderRight: '1.5px solid #e0ddd8', background: 'none', color: '#1c1c1c', outline: 'none' },
  qtyUnit: { fontSize: 13, color: '#888' },

  btnGreen: { background: '#1a6b3a', border: 'none', borderRadius: 8, color: '#fff', fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 2, padding: '14px 16px', width: '100%', minHeight: 52 },
  btnGreenSm: { background: '#1a6b3a', border: 'none', borderRadius: 6, color: '#fff', fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: 1.5, padding: '9px 16px', minHeight: 38, whiteSpace: 'nowrap' },
  btnOutline: { background: 'none', border: '1.5px solid #e0ddd8', borderRadius: 6, color: '#1c1c1c', fontSize: 13, fontWeight: 600, padding: '8px 14px', minHeight: 38, whiteSpace: 'nowrap' },

  logPanel: { background: '#e8e6e1', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  logTop: { padding: '14px 18px 12px', borderBottom: '1px solid #d0cec9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  tally: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: 1, color: '#1a6b3a' },
  logList: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  logEmpty: { color: '#aaa', fontSize: 13, textAlign: 'center', padding: '50px 16px', lineHeight: 1.7 },
  logEntry: { background: '#fff', border: '1px solid #e0ddd8', borderRadius: 8, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 12 },
  entryQty: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, lineHeight: 1, color: '#1a6b3a', minWidth: 40, textAlign: 'center' },
  entryMeta: { flex: 1, minWidth: 0 },
  entryName: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  entryCat: { fontSize: 11, color: '#888', marginTop: 2 },
  entryDel: { background: 'none', border: 'none', color: '#ccc', fontSize: 20, minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, padding: 6 },
  logFooter: { padding: '13px 14px', borderTop: '1px solid #d0cec9', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 },
  logTotal: { background: '#fff', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 },

  batchToolbar: { padding: '14px 20px', borderBottom: '1px solid #e0ddd8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', flexShrink: 0, background: '#fff' },
  batchTabs: { display: 'flex', gap: 4 },
  batchTab: { background: 'none', border: '1.5px solid #e0ddd8', borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '7px 16px', color: '#888', minHeight: 38 },
  batchTabActive: { background: '#1c1c1c', borderColor: '#1c1c1c', color: '#fff' },

  batchGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  batchCard: { background: '#fff', border: '1.5px solid #e0ddd8', borderRadius: 10, padding: '16px', position: 'relative', minHeight: 110 },
  batchCardName: { fontSize: 15, fontWeight: 700, marginBottom: 6, paddingRight: 24, lineHeight: 1.2 },
  batchCardSize: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: '#1a6b3a', letterSpacing: 1, marginBottom: 8 },
  batchCardDate: { fontSize: 11, color: '#888' },

  historyTable: { background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0ddd8' },
  th: { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#888' },
  td: { padding: '12px 16px', fontSize: 14 },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 },
  modal: { background: '#fff', borderRadius: 14, padding: 32, maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' },
  modalH: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 2, marginBottom: 6 },
  modalSub: { fontSize: 14, color: '#888', lineHeight: 1.6, marginBottom: 4 },
  confirmList: { background: '#f5f4f1', borderRadius: 8, padding: '10px 14px', margin: '16px 0', maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 },
  confirmRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '8px 0', borderBottom: '1px solid #e0ddd8' },
  confirmQty: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: '#1a6b3a', letterSpacing: 1, paddingLeft: 12 },
  modalBtns: { display: 'flex', gap: 10, marginTop: 24 },
  modalInput: { width: '100%', padding: '12px 14px', border: '1.5px solid #e0ddd8', borderRadius: 8, fontSize: 14, color: '#1c1c1c', background: '#fff', outline: 'none' },
  btnGhost: { background: 'none', color: '#1c1c1c', border: '1.5px solid #e0ddd8', borderRadius: 8, fontSize: 14, fontWeight: 600, padding: '13px 20px', whiteSpace: 'nowrap' },
  btnConfirm: { background: '#1a6b3a', color: '#fff', border: 'none', borderRadius: 8, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 1.5, padding: '13px 24px', flex: 1 },
}
