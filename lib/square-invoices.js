// Unpaid wholesale Square invoices. Never calls CreatePayment / CompletePayment.

import { httpError, resolveAccount, resolveLocationId, squareFetch } from './square-client'
import {
  assertSquareWritePath,
  buildPublishInvoiceBody,
  buildUnpaidInvoiceBody,
  buildUnpaidOrderBody,
  parseInvoiceWriteRequest
} from './invoice-write'

async function guardedFetch(fetchImpl, args) {
  assertSquareWritePath(args.path)
  return fetchImpl(args)
}

function assertVariation(catalog, catalogObjectId) {
  const object = catalog && catalog.object
  if (!object || object.type !== 'ITEM_VARIATION' || object.is_deleted) {
    throw httpError(400, `catalogObjectId must be a Square catalog item variation (${catalogObjectId})`)
  }
  if (object.id && object.id !== catalogObjectId) {
    throw httpError(400, `catalogObjectId must be a Square catalog item variation (${catalogObjectId})`)
  }
}

export async function createUnpaidInvoice(body, deps = {}) {
  const fetchImpl = deps.squareFetch || squareFetch
  const resolve = deps.resolveAccount || resolveAccount
  const resolveLoc = deps.resolveLocationId || resolveLocationId
  const now = deps.now || new Date()

  const parsed = parseInvoiceWriteRequest(body, now)
  if (!parsed.ok) throw httpError(parsed.status, parsed.error)
  const request = parsed.value

  const account = resolve('wholesale')
  if (account.account !== 'wholesale') {
    throw httpError(400, 'Invoice writes are limited to the wholesale Square account')
  }
  const locationId = resolveLoc(request.locationId, account)

  for (const line of request.lines) {
    const catalog = await guardedFetch(fetchImpl, {
      token: account.token,
      path: `/catalog/object/${encodeURIComponent(line.catalogObjectId)}`
    })
    assertVariation(catalog, line.catalogObjectId)
  }

  const orderResult = await guardedFetch(fetchImpl, {
    token: account.token,
    path: '/orders',
    method: 'POST',
    body: buildUnpaidOrderBody({
      idempotencyKey: request.idempotencyKey,
      locationId,
      customerId: request.customerId,
      lines: request.lines
    })
  })
  const order = orderResult && orderResult.order
  if (!order || !order.id) throw httpError(502, 'Square did not return an order')
  if (Array.isArray(order.tenders) && order.tenders.length > 0) {
    throw httpError(502, 'Refusing to invoice an order that already has a tender')
  }

  const created = await guardedFetch(fetchImpl, {
    token: account.token,
    path: '/invoices',
    method: 'POST',
    body: buildUnpaidInvoiceBody({
      idempotencyKey: request.idempotencyKey,
      locationId,
      customerId: request.customerId,
      orderId: order.id,
      dueDate: request.dueDate,
      title: request.title,
      description: request.description
    })
  })
  const draft = created && created.invoice
  if (!draft || !draft.id || !Number.isInteger(draft.version)) {
    throw httpError(502, 'Square did not return a draft invoice')
  }

  const published = await guardedFetch(fetchImpl, {
    token: account.token,
    path: `/invoices/${encodeURIComponent(draft.id)}/publish`,
    method: 'POST',
    body: buildPublishInvoiceBody({
      idempotencyKey: request.idempotencyKey,
      version: draft.version
    })
  })
  const invoice = (published && published.invoice) || draft
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number || null,
    orderId: order.id,
    status: invoice.status || null,
    publicUrl: invoice.public_url || null
  }
}
