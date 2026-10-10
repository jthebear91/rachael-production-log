// Screen and print CSS for Day Doc Labels. Label metrics match the
// standalone printer page. The site header is hidden when printing.

const DAY_DOC_CSS = `
.day-doc {
  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.day-doc header {
  background: var(--text);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 24px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.day-doc header h1 {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 26px;
  letter-spacing: 2px;
  font-weight: 400;
}
.day-doc .header-sub {
  font-size: 11px;
  color: #aaa;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-top: 1px;
}

.day-doc .site-tabs {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.day-doc .site-tab {
  background: none;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  color: #999;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  padding: 7px 16px;
  min-height: 38px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  transition: all 0.12s;
}
.day-doc .site-tab.active {
  background: #fff;
  color: #1c1c1c;
  border-color: #fff;
}

.day-doc .setup-banner {
  background: #fffbe6;
  border-bottom: 1px solid #f0d070;
  padding: 10px 24px;
  font-size: 13px;
  color: #6b5a00;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.day-doc .setup-banner strong { color: #4a3d00; }
.day-doc .banner-dismiss {
  margin-left: auto;
  background: none;
  border: 1px solid #c8a800;
  border-radius: 4px;
  font-size: 11px;
  color: #6b5a00;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.day-doc .banner-dismiss:hover { background: #f0d070; }

.day-doc .layout {
  display: grid;
  grid-template-columns: 1fr 300px;
  flex: 1;
  gap: 0;
}

.day-doc .controls {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  border-right: 1px solid var(--border);
}

.day-doc .block-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}

.day-doc .cat-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.day-doc .cat-pill {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  padding: 7px 16px;
  cursor: pointer;
  color: var(--text);
  transition: all 0.12s;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Inter', sans-serif;
}
.day-doc .cat-pill:hover { border-color: #999; }
.day-doc .cat-pill.active { background: var(--active-bg, #1c1c1c); border-color: var(--active-bg, #1c1c1c); color: #fff; }

.day-doc .item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.day-doc .item-btn {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  padding: 11px 10px;
  cursor: pointer;
  color: var(--text);
  text-align: center;
  transition: all 0.12s;
  line-height: 1.3;
  font-family: 'Inter', sans-serif;
}
.day-doc .item-btn:hover { border-color: #999; background: #f9f9f7; }
.day-doc .item-btn.selected { background: #1c1c1c; border-color: #1c1c1c; color: #fff; font-weight: 600; }
.day-doc .no-items { color: var(--muted); font-size: 13px; padding: 4px 0; }

.day-doc .date-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.day-doc .field-wrap { display: flex; flex-direction: column; gap: 6px; }

.day-doc input[type="date"],
.day-doc input[type="time"] {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 7px;
  color: var(--text);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 10px;
  outline: none;
  width: 100%;
  transition: border-color 0.12s;
}
.day-doc input[type="date"]:focus,
.day-doc input[type="time"]:focus { border-color: var(--text); }
.day-doc input::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.5; }

.day-doc .exp-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.day-doc .exp-chip {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.12s;
  font-family: 'Inter', sans-serif;
}
.day-doc .exp-chip:hover { border-color: #999; color: var(--text); }
.day-doc .exp-chip.active { background: var(--text); border-color: var(--text); color: #fff; }

.day-doc .qty-row { display: flex; align-items: center; gap: 14px; }
.day-doc .qty-stepper {
  display: flex;
  align-items: center;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface);
}
.day-doc .qty-btn {
  background: none;
  border: none;
  font-size: 22px;
  font-weight: 300;
  color: var(--text);
  width: 44px;
  height: 44px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
  font-family: 'Inter', sans-serif;
}
.day-doc .qty-btn:hover { background: var(--bg); }
.day-doc .qty-num {
  font-size: 22px;
  font-weight: 700;
  width: 56px;
  text-align: center;
  border-left: 1.5px solid var(--border);
  border-right: 1.5px solid var(--border);
  height: 44px;
  line-height: 44px;
  background: none;
  border-top: none;
  border-bottom: none;
  color: var(--text);
  font-family: 'Inter', sans-serif;
  outline: none;
  -moz-appearance: textfield;
}
.day-doc .qty-num::-webkit-inner-spin-button,
.day-doc .qty-num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.day-doc .qty-label { font-size: 13px; color: var(--muted); }

.day-doc .btn-print {
  background: var(--text);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 2px;
  padding: 14px 28px;
  cursor: pointer;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  gap: 10px;
}
.day-doc .btn-print:hover { opacity: 0.85; }
.day-doc .btn-print:disabled { opacity: 0.3; cursor: not-allowed; }

.day-doc .print-hint {
  font-size: 11px;
  color: var(--muted);
  margin-top: 6px;
  line-height: 1.5;
}
.day-doc .print-hint code {
  background: #eee;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 11px;
  color: #333;
}

.day-doc .preview-panel {
  background: #e8e6e1;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.day-doc .preview-title { font-size: 10px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; color: var(--muted); }
.day-doc .preview-stack { display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; }
.day-doc .preview-empty { color: #aaa; font-size: 13px; text-align: center; padding: 30px 0; }
.day-doc .preview-more { font-size: 11px; color: var(--muted); text-align: center; }

.day-doc .label {
  background: #fff;
  border-radius: 4px;
  padding: 7px 9px 6px;
  width: 130px;
  height: 130px;
  font-family: 'Inter', sans-serif;
  border: 1px dashed #ccc;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
}

.day-doc .label-day {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  letter-spacing: 1px;
  line-height: 1;
  color: #111;
}

.day-doc .label-day-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-top: 8px;
}
.day-doc .label-counter {
  font-size: 10px;
  font-weight: 600;
  color: #bbb;
  white-space: nowrap;
  padding-left: 6px;
}

.day-doc .label-divider { border: none; border-top: 1px solid #e8e8e8; margin: 5px 0 4px; }

.day-doc .label-name {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  letter-spacing: 1px;
  line-height: 1;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
  display: block;
  width: 100%;
}

.day-doc .label-made {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  font-weight: 400;
  color: #555;
  margin-top: 4px;
  letter-spacing: 1px;
  line-height: 1;
}

@media print {
  @page {
    size: 0.9in 0.9in;
    margin: 0;
  }
  html, body, #__next {
    background: white !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    display: block !important;
  }
  .day-doc {
    background: white !important;
    min-height: 0 !important;
    height: auto !important;
    display: block !important;
  }

  .day-doc header,
  .day-doc .site-tabs,
  .day-doc .setup-banner,
  .day-doc .controls,
  .day-doc .preview-title,
  .day-doc .preview-more { display: none !important; }

  .day-doc .layout { display: block; }

  .day-doc .preview-panel {
    background: white;
    padding: 0;
    gap: 0;
    overflow: visible;
  }

  .day-doc .preview-stack { gap: 0; display: block; }

  .day-doc .label {
    border: none !important;
    border-radius: 0;
    page-break-after: always;
    break-after: page;
    width: 0.9in;
    height: 0.9in;
    padding: 0.03in 0.05in 0.02in;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    box-shadow: none !important;
    margin: 0;
    overflow: hidden;
  }
  .day-doc .label:last-child {
    page-break-after: avoid;
    break-after: avoid;
  }
  .day-doc .label-day      { font-size: 18px; letter-spacing: 0.5px; }
  .day-doc .label-day-row  { align-items: baseline; padding-top: 0.09in; }
  .day-doc .label-divider  { margin: 1px 0; }
  .day-doc .label-name     { font-size: 18px; letter-spacing: 0.3px; line-height: 1; white-space: nowrap; overflow: hidden; margin-top: 1px; }
  .day-doc .label-made     { font-size: 18px; margin-top: 2px; letter-spacing: 0.3px; color: #444; font-family: 'Bebas Neue', sans-serif; }
  .day-doc .label-counter  { font-size: 6px; display: inline; }
}
`

module.exports = { DAY_DOC_CSS }
