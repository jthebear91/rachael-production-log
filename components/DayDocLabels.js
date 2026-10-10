import { useEffect, useState } from 'react'
import { DAY_DOC_CSS } from '../lib/day-doc-labels-css'
import {
  MAX_PREVIEW,
  MENU,
  clockRefreshOnEvent,
  currentInstant,
  labelsForUse,
  msUntilLocalMidnight
} from '../lib/day-doc-labels'

function LabelCard({ label }) {
  return (
    <div className="label">
      <div className="label-day-row">
        <div className="label-day">{label.day}</div>
        {label.counter ? <div className="label-counter">{label.counter}</div> : null}
      </div>
      <hr className="label-divider" />
      <div className="label-name">{label.printName}</div>
      <div className="label-made">{label.made}</div>
    </div>
  )
}

export default function DayDocLabels() {
  const [mounted, setMounted] = useState(false)
  const [clockTick, setClockTick] = useState(0)
  const [activeCat, setActiveCat] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [qty, setQty] = useState(1)
  const [qtyInput, setQtyInput] = useState('1')
  const [madeDateOverride, setMadeDateOverride] = useState(null)
  const [madeTimeOverride, setMadeTimeOverride] = useState(null)
  const [expChoice, setExpChoice] = useState(null)
  const [printing, setPrinting] = useState(false)
  const [printSnapshot, setPrintSnapshot] = useState(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let timer
    let cancelled = false
    const arm = () => {
      const delay = msUntilLocalMidnight(new Date())
      timer = setTimeout(() => {
        if (cancelled) return
        setClockTick(tick => tick + 1)
        arm()
      }, delay)
    }
    arm()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    function bump() {
      setClockTick(tick => tick + 1)
    }
    function onVisibility() {
      if (clockRefreshOnEvent('visibilitychange', document.visibilityState)) bump()
    }
    function onFocus() {
      if (clockRefreshOnEvent('focus', document.visibilityState)) bump()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (!printing) return undefined
    let restore
    const start = setTimeout(() => {
      window.print()
      restore = setTimeout(() => {
        setPrinting(false)
        setPrintSnapshot(null)
      }, 800)
    }, 100)
    return () => {
      clearTimeout(start)
      if (restore) clearTimeout(restore)
    }
  }, [printing])

  const overrides = {
    madeDate: madeDateOverride,
    madeTime: madeTimeOverride,
    exp: expChoice
  }
  const liveNow = mounted ? currentInstant(clockTick) : null
  const live = liveNow
    ? labelsForUse({ item: selectedItem, qty, now: liveNow, overrides })
    : null
  const view = printing && printSnapshot ? printSnapshot : live
  const clock = view ? view.clock : null
  const showCount = printing ? qty : Math.min(qty, MAX_PREVIEW)
  const shown = view ? view.labels.slice(0, showCount) : []
  const extra = qty - MAX_PREVIEW
  const moreText = extra > 0 ? `+ ${extra} more label${extra > 1 ? 's' : ''}` : ''
  const activeCategory = MENU.find(cat => cat.id === activeCat) || null

  function changeQty(delta) {
    setQty(current => {
      const next = Math.max(1, Math.min(99, current + delta))
      setQtyInput(String(next))
      return next
    })
  }

  function setQtyFromInput(val) {
    setQtyInput(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 1) setQty(Math.min(99, n))
  }

  function doPrint() {
    if (!selectedItem) return
    const atPrint = new Date()
    setPrintSnapshot(labelsForUse({ item: selectedItem, qty, now: atPrint, overrides }))
    setPrinting(true)
    setClockTick(tick => tick + 1)
  }

  return (
    <div className="day-doc">
      <style dangerouslySetInnerHTML={{ __html: DAY_DOC_CSS }} />
      <header>
        <div>
          <h1>Day Doc Labels</h1>
          <div className="header-sub">Kitchen Label Printer</div>
        </div>
        <nav className="site-tabs" aria-label="Sections">
          <a className="site-tab" href="/dashboard">Sales</a>
          <a className="site-tab" href="/">Daily Log</a>
          <a className="site-tab" href="/?screen=batches">Batch Tracker</a>
          <a className="site-tab active" href="/labels" aria-current="page">Day Doc Labels</a>
        </nav>
      </header>

      <div className="layout">
        <div className="controls">
          <div>
            <div className="block-label">1 — Select Category</div>
            <div className="cat-pills" id="catPills">
              {MENU.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  className={activeCat === cat.id ? 'cat-pill active' : 'cat-pill'}
                  onClick={() => {
                    setActiveCat(cat.id)
                    setSelectedItem(null)
                  }}
                >
                  <span>{cat.icon}</span>{cat.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="block-label">2 — Select Item</div>
            <div className="item-grid" id="itemGrid">
              {!activeCategory && <div className="no-items">Pick a category above</div>}
              {activeCategory && activeCategory.items.map(item => (
                <button
                  key={item}
                  type="button"
                  className={selectedItem === item ? 'item-btn selected' : 'item-btn'}
                  onClick={() => setSelectedItem(item)}
                >{item}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="block-label">3 — Date, Time &amp; Expires</div>
            <div className="date-row">
              <div className="field-wrap">
                <span className="block-label" style={{ marginBottom: 0 }}>Made</span>
                <input
                  type="date"
                  id="dateMade"
                  value={clock ? clock.madeDate : ''}
                  onChange={e => setMadeDateOverride(e.target.value)}
                />
              </div>
              <div className="field-wrap">
                <span className="block-label" style={{ marginBottom: 0 }}>Time</span>
                <input
                  type="time"
                  id="timeMade"
                  value={clock ? clock.madeTime : ''}
                  onChange={e => setMadeTimeOverride(e.target.value)}
                />
              </div>
              <div className="field-wrap">
                <span className="block-label" style={{ marginBottom: 0 }}>Expires</span>
                <input
                  type="date"
                  id="dateExp"
                  value={clock ? clock.expDate : ''}
                  onChange={e => setExpChoice({ kind: 'date', value: e.target.value })}
                />
              </div>
            </div>
            <div className="exp-chips">
              <button type="button" className={expChoice && expChoice.kind === 'offset' && expChoice.days === 0 ? 'exp-chip active' : 'exp-chip'} onClick={() => setExpChoice({ kind: 'offset', days: 0 })}>Today</button>
              <button type="button" className={expChoice && expChoice.kind === 'offset' && expChoice.days === 1 ? 'exp-chip active' : 'exp-chip'} onClick={() => setExpChoice({ kind: 'offset', days: 1 })}>+1 day</button>
              <button type="button" className={expChoice && expChoice.kind === 'offset' && expChoice.days === 3 ? 'exp-chip active' : 'exp-chip'} onClick={() => setExpChoice({ kind: 'offset', days: 3 })}>+3 days</button>
              <button type="button" className={expChoice && expChoice.kind === 'offset' && expChoice.days === 7 ? 'exp-chip active' : 'exp-chip'} onClick={() => setExpChoice({ kind: 'offset', days: 7 })}>+7 days</button>
            </div>
          </div>

          <div>
            <div className="block-label">4 — How many labels?</div>
            <div className="qty-row">
              <div className="qty-stepper">
                <button type="button" className="qty-btn" onClick={() => changeQty(-1)}>−</button>
                <input
                  className="qty-num"
                  id="qtyNum"
                  type="number"
                  value={qtyInput}
                  min="1"
                  max="99"
                  onChange={e => setQtyFromInput(e.target.value)}
                />
                <button type="button" className="qty-btn" onClick={() => changeQty(1)}>+</button>
              </div>
              <span className="qty-label" id="qtyHint">{qty === 1 ? 'label to print' : 'labels to print'}</span>
            </div>
          </div>

          <div>
            <button type="button" className="btn-print" id="printBtn" onClick={doPrint} disabled={!selectedItem}>
              {'🖨\u00A0 Print Labels'}
            </button>
          </div>
        </div>

        <div className="preview-panel">
          <div className="preview-title">Preview</div>
          <div className="preview-stack" id="previewStack">
            {!selectedItem && <div className="preview-empty">Select an item to preview</div>}
            {selectedItem && shown.map((label, index) => (
              <LabelCard key={`${label.printName}-${label.counter || 'single'}-${index}`} label={label} />
            ))}
          </div>
          <div className="preview-more" id="previewMore">{moreText}</div>
        </div>
      </div>
    </div>
  )
}
