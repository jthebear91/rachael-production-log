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
// Requires BRIDGE_API_KEY. APP_BASE_URL defaults to production.

const fs = require('fs')
const { PRACTICE_HEBERTS_MAURICE } = require('../lib/wholesale-pull')

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] || ''
}

function has(name) {
  return process.argv.includes(name)
}

async function main() {
  if (has('--help')) {
    console.log('Usage: node scripts/wholesale-pull-replay.cjs [--heberts | --order-id ID | --payment-id ID | --invoice-id ID] [--force] [--apply] [--out file.pdf]')
    console.log('Default is a dry run. It does not create a Todoist task and it does not print.')
    process.exit(0)
  }

  const heberts = has('--heberts')
  const orderId = heberts ? PRACTICE_HEBERTS_MAURICE.orderId : arg('--order-id')
  const paymentId = heberts ? null : arg('--payment-id')
  const invoiceId = heberts ? null : arg('--invoice-id')
  if (heberts && has('--payment')) {
    console.error('Use --heberts for the order, or --payment-id for the Hebert\'s payment. Do not combine --heberts and --payment.')
    process.exit(1)
  }
  const ids = [orderId, paymentId, invoiceId].filter(Boolean)
  if (ids.length !== 1) {
    console.error('Provide one of --heberts, --order-id, --payment-id, or --invoice-id.')
    process.exit(1)
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
