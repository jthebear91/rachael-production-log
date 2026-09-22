const { findAllowlistEntry, loadAllowlist, parseNotifyPhoneList } = require('./wholesale-text-allowlist')
const { parseWholesaleText } = require('./wholesale-text-parse')
const { evaluateTwilioAuth, twimlMessage } = require('./twilio-webhook')

const UNAUTHORIZED_REPLY = 'Number not authorized'

function reviewReply(entry, parsed) {
  const label = entry.label || 'your account'
  const recognized = (parsed.lines || []).filter(line => line && line.name)
  if (recognized.length === 0) {
    return `Got it for ${label}. This order needs staff review. No invoice was created.`
  }
  const summary = recognized.map(line => `${line.quantity}x ${line.name}`).join(', ').slice(0, 180)
  return `Got it for ${label}: ${summary}. This order needs staff review. No invoice was created.`
}

function idempotencyFromSid(messageSid) {
  const sid = String(messageSid || '').replace(/[^A-Za-z0-9]/g, '')
  if (sid.length < 8) return null
  return `sms${sid}`.slice(0, 128)
}

function billableLines(parsed) {
  return (parsed.lines || []).filter(line => {
    return line && line.catalogObjectId && line.quantity && !line.needsReview
  })
}

// Jordan lock: create the unpaid invoice, then SMS the crew.
// v1 parser always sets needs_review, so this returns review and does not invoice.
function decideInbound({ entry, parsed, messageSid }) {
  if (!entry) {
    return { action: 'reject', reply: UNAUTHORIZED_REPLY }
  }
  const lines = billableLines(parsed)
  const idempotencyKey = idempotencyFromSid(messageSid)
  if (!parsed || parsed.needs_review || lines.length === 0 || !entry.squareCustomerId || !idempotencyKey) {
    return { action: 'review', reply: reviewReply(entry, parsed || { lines: [] }) }
  }
  return {
    action: 'invoice',
    invoiceRequest: {
      account: 'wholesale',
      customerId: entry.squareCustomerId,
      lines: lines.map(line => ({
        catalogObjectId: line.catalogObjectId,
        quantity: String(line.quantity)
      })),
      idempotencyKey,
      description: entry.label ? `Wholesale text — ${entry.label}` : 'Wholesale text'
    }
  }
}

function crewPhones(entry, env) {
  const phones = [
    ...(entry.notifyPhones || []),
    ...parseNotifyPhoneList(env.WHOLESALE_TEXT_NOTIFY_PHONES)
  ]
  return [...new Set(phones)]
}

async function notifyCrew({ env, entry, summary, fetchImpl }) {
  const to = crewPhones(entry, env)
  console.log(JSON.stringify({
    event: 'wholesale_text_notify',
    label: entry.label || '',
    phone: entry.phone,
    summary,
    to
  }))
  const from = String(env.TWILIO_FROM_NUMBER || '').trim()
  const sid = String(env.TWILIO_ACCOUNT_SID || '').trim()
  const token = String(env.TWILIO_AUTH_TOKEN || '').trim()
  if (!from || !sid || !token || to.length === 0) {
    return { logged: true, sent: 0 }
  }
  const fetchFn = fetchImpl || globalThis.fetch
  let sent = 0
  for (const phone of to) {
    try {
      const body = new URLSearchParams({ To: phone, From: from, Body: summary }).toString()
      const res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      })
      if (res && res.ok) sent += 1
    } catch (err) {
      console.log(JSON.stringify({
        event: 'wholesale_text_notify_failed',
        phone,
        message: String(err && err.message ? err.message : 'notify failed').slice(0, 200)
      }))
    }
  }
  return { logged: true, sent }
}

function xmlResult(status, text, devBypass) {
  const headers = {}
  if (devBypass) headers['X-Wholesale-Text-Dev-Bypass'] = '1'
  return { status, xml: twimlMessage(text), headers }
}

async function handleWholesaleInbound({
  method,
  contentType,
  signature,
  url,
  params,
  env = process.env,
  createInvoice,
  fetchImpl
}) {
  if (method !== 'POST') {
    return { status: 405, allow: 'POST', json: { error: 'Method not allowed' } }
  }
  if (!String(contentType || '').toLowerCase().includes('application/x-www-form-urlencoded')) {
    return { status: 415, json: { error: 'Expected application/x-www-form-urlencoded' } }
  }

  const gate = evaluateTwilioAuth({ env, signature, url, params })
  if (!gate.ok) return { status: gate.status, json: { error: gate.error } }
  if (gate.devBypass) {
    console.log(JSON.stringify({
      event: 'wholesale_text_dev_bypass',
      message: 'Twilio signature was not validated because WHOLESALE_TEXT_DEV_BYPASS=1 and NODE_ENV is not production'
    }))
  }

  const loaded = loadAllowlist(env)
  if (!loaded.ok) return { status: 503, json: { error: loaded.error } }

  const entry = findAllowlistEntry(params.From, loaded.entries)
  const parsed = parseWholesaleText(params.Body)
  const decision = decideInbound({
    entry,
    parsed,
    messageSid: params.MessageSid
  })

  if (decision.action === 'reject') {
    return xmlResult(200, decision.reply, gate.devBypass)
  }

  if (decision.action === 'review') {
    await notifyCrew({
      env,
      entry,
      summary: decision.reply,
      fetchImpl
    })
    return xmlResult(200, decision.reply, gate.devBypass)
  }

  if (typeof createInvoice !== 'function') {
    const reply = reviewReply(entry, parsed)
    await notifyCrew({ env, entry, summary: reply, fetchImpl })
    return xmlResult(200, reply, gate.devBypass)
  }

  try {
    const data = await createInvoice(decision.invoiceRequest)
    const number = data && data.invoiceNumber ? data.invoiceNumber : data && data.invoiceId
    const reply = number
      ? `Unpaid invoice ${number} created for ${entry.label || 'your account'}.`
      : `Unpaid invoice created for ${entry.label || 'your account'}.`
    await notifyCrew({ env, entry, summary: reply, fetchImpl })
    return xmlResult(200, reply, gate.devBypass)
  } catch (err) {
    console.log(JSON.stringify({
      event: 'wholesale_text_invoice_failed',
      message: String(err && err.message ? err.message : 'invoice failed').slice(0, 200)
    }))
    const reply = reviewReply(entry, parsed)
    await notifyCrew({ env, entry, summary: reply, fetchImpl })
    return xmlResult(200, reply, gate.devBypass)
  }
}

module.exports = {
  UNAUTHORIZED_REPLY,
  reviewReply,
  decideInbound,
  notifyCrew,
  handleWholesaleInbound
}
