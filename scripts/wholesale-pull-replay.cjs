#!/usr/bin/env node
'use strict'

// Dry-run a wholesale Square sale into a Takeout pick list.
// Does not send anything to a printer. --apply creates the Todoist task.
//
// Hebert's Maurice practice sale (around Sep 22–23 CT):
//   order   gcEI0dtLc3OaueVCwjKKet9vxZRZY
//   payment 968pb1sI3vrL7m7sM77fNWumZtNZY
//
//   node scripts/wholesale-pull-replay.cjs --heberts --out /tmp/heberts-pick-list.pdf
//   node scripts/wholesale-pull-replay.cjs --heberts --force
//   node scripts/wholesale-pull-replay.cjs --heberts --apply
//
// Local preview (this checkout's PDF, including the WHOLESALE banner).
// Does not call production and does not write Todoist:
//   node scripts/wholesale-pull-replay.cjs --local --invoice-number 000225 --out /tmp/nunu-000225.pdf
//   node scripts/wholesale-pull-replay.cjs --local --heberts --out /tmp/heberts-pick-list.pdf
//
// The hosted replay requires BRIDGE_API_KEY. APP_BASE_URL defaults to production.
// --local uses SQUARE_WHOLESALE_TOKEN (or SQUARE_TOKEN) from the environment.

const fs = require('fs')
const { PRACTICE_HEBERTS_MAURICE, handleReplay } = require('../lib/wholesale-pull')
const SQUARE_VERSION = '2024-02-22'
const SQUARE_BASE = 'https://connect.squareup.com/v2'

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] || ''
}

function has(name) {
  return process.argv.includes(name)
}

function invoiceNumberMatches(invoice, wanted) {
  const raw = String(invoice && invoice.invoice_number || '').trim()
  const target = String(wanted || '').trim().replace(/^#/, '')
  if (!raw || !target) return false
  if (raw === target) return true
  const rawDigits = raw.replace(/\D/g, '').replace(/^0+/, '')
  const targetDigits = target.replace(/\D/g, '').replace(/^0+/, '')
  return rawDigits !== '' && rawDigits === targetDigits
}

async function findInvoiceIdByNumber(token, locationId, number) {
  let cursor = null
  for (let page = 0; page < 25; page++) {
    const body = {
      query: {
        filter: { location_ids: [locationId] },
        sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' }
      },
      limit: 200
    }
    if (cursor) body.cursor = cursor
    const res = await fetch(`${SQUARE_BASE}/invoices/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = json.errors && json.errors[0] && (json.errors[0].detail || json.errors[0].code)
      throw new Error(detail || `Square invoice search failed (${res.status})`)
    }
    const hit = (json.invoices || []).find(invoice => invoiceNumberMatches(invoice, number))
    if (hit && hit.id) return hit.id
    cursor = json.cursor
    if (!cursor) return null
  }
  return null
}

async function localPreview({ orderId, paymentId, invoiceId, invoiceNumber, force, out }) {
  const token = process.env.SQUARE_WHOLESALE_TOKEN || process.env.SQUARE_TOKEN
  const locationId = process.env.SQUARE_WHOLESALE_LOCATION_ID || process.env.SQUARE_LOCATION_ID
  if (!token || !locationId) {
    console.error('Local preview needs SQUARE_WHOLESALE_TOKEN and SQUARE_WHOLESALE_LOCATION_ID.')
    process.exit(1)
  }
  let resolvedInvoiceId = invoiceId
  if (invoiceNumber) {
    resolvedInvoiceId = await findInvoiceIdByNumber(token, locationId, invoiceNumber)
    if (!resolvedInvoiceId) {
      console.error(`No wholesale invoice numbered ${invoiceNumber}.`)
      process.exit(1)
    }
  }
  async function squareFetch({ token: squareToken, path, method = 'GET' }) {
    const res = await fetch(`${SQUARE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${squareToken}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json'
      }
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data.errors && data.errors[0] && (data.errors[0].detail || data.errors[0].code)
      const err = new Error(detail || `Square request failed (${res.status})`)
      err.status = res.status
      throw err
    }
    return data
  }
  const result = await handleReplay({
    env: process.env,
    squareFetch,
    body: {
      apply: false,
      force: force === true,
      ...(orderId ? { orderId } : {}),
      ...(paymentId ? { paymentId } : {}),
      ...(resolvedInvoiceId ? { invoiceId: resolvedInvoiceId } : {})
    }
  })
  const json = result.json || {}
  if (out && json.pdfBase64) fs.writeFileSync(out, Buffer.from(json.pdfBase64, 'base64'))
  const summary = { ...json, local: true }
  delete summary.pdfBase64
  if (json.pdfBase64) summary.pdfBytes = Buffer.from(json.pdfBase64, 'base64').length
  if (out && json.pdfBase64) summary.pdfFile = out
  if (invoiceNumber) summary.invoiceNumber = invoiceNumber
  summary.lineCount = Array.isArray(json.lines) ? json.lines.length : 0
  console.log(JSON.stringify(summary, null, 2))
  if (result.status !== 200 || json.skipped) process.exit(1)
}

async function main() {
  if (has('--help')) {
    console.log('Usage: node scripts/wholesale-pull-replay.cjs [--local] [--heberts | --order-id ID | --payment-id ID | --invoice-id ID | --invoice-number N] [--force] [--apply] [--out file.pdf]')
    console.log('Default is a dry run. It does not create a Todoist task and it does not print.')
    console.log('--local builds the PDF in this checkout (WHOLESALE banner) and never writes Todoist.')
    process.exit(0)
  }

  const heberts = has('--heberts')
  const local = has('--local')
  const orderId = heberts ? PRACTICE_HEBERTS_MAURICE.orderId : arg('--order-id')
  const paymentId = heberts ? null : arg('--payment-id')
  const invoiceId = heberts ? null : arg('--invoice-id')
  const invoiceNumber = heberts ? null : arg('--invoice-number')
  if (heberts && has('--payment')) {
    console.error('Use --heberts for the order, or --payment-id for the Hebert\'s payment. Do not combine --heberts and --payment.')
    process.exit(1)
  }
  if (local && has('--apply')) {
    console.error('--local is a preview. It does not write a Todoist task. Omit --apply.')
    process.exit(1)
  }
  const ids = [orderId, paymentId, invoiceId, invoiceNumber].filter(Boolean)
  if (ids.length !== 1) {
    console.error('Provide one of --heberts, --order-id, --payment-id, --invoice-id, or --invoice-number.')
    process.exit(1)
  }
  if (invoiceNumber && !local) {
    console.error('--invoice-number is only available with --local.')
    process.exit(1)
  }
  if (local) {
    await localPreview({
      orderId,
      paymentId,
      invoiceId,
      invoiceNumber,
      force: has('--force'),
      out: arg('--out')
    })
    return
  }

  const key = process.env.BRIDGE_API_KEY
  if (!key) {
    console.error('BRIDGE_API_KEY is not set.')
    process.exit(1)
  }
  const base = (process.env.APP_BASE_URL || 'https://rachael-production-log.vercel.app').replace(/\/+$/, '')
  const body = { apply: has('--apply'), force: has('--force') }
  if (orderId) body.orderId = orderId
  if (paymentId) body.paymentId = paymentId
  if (invoiceId) body.invoiceId = invoiceId

  const res = await fetch(`${base}/api/wholesale-pull/replay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  const pdfBase64 = json.pdfBase64
  const out = arg('--out')
  if (out && pdfBase64) fs.writeFileSync(out, Buffer.from(pdfBase64, 'base64'))
  const summary = { ...json }
  delete summary.pdfBase64
  if (pdfBase64) summary.pdfBytes = Buffer.from(pdfBase64, 'base64').length
  if (out && pdfBase64) summary.pdfFile = out
  if (heberts) {
    summary.practice = {
      label: PRACTICE_HEBERTS_MAURICE.label,
      orderId: PRACTICE_HEBERTS_MAURICE.orderId,
      paymentId: PRACTICE_HEBERTS_MAURICE.paymentId
    }
  }
  console.log(JSON.stringify(summary, null, 2))
  if (!res.ok) process.exit(1)
}

main().catch(err => {
  console.error(err && err.message ? err.message : err)
  process.exit(1)
})
