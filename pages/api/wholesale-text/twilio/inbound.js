import { createUnpaidInvoice } from '../../../../lib/square-invoices'
import { formParamsFromBody, publicRequestUrl } from '../../../../lib/twilio-webhook'
import { handleWholesaleInbound } from '../../../../lib/wholesale-text-inbound'

function headerValue(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const result = await handleWholesaleInbound({
    method: req.method,
    contentType: headerValue(req, 'content-type'),
    signature: headerValue(req, 'x-twilio-signature'),
    url: publicRequestUrl({ headers: req.headers, url: req.url }),
    params: formParamsFromBody(req.body),
    env: process.env,
    createInvoice: createUnpaidInvoice
  })
  if (result.allow) res.setHeader('Allow', result.allow)
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value)
    }
  }
  if (result.xml) {
    res.setHeader('Content-Type', 'text/xml; charset=utf-8')
    res.status(result.status).send(result.xml)
    return
  }
  res.status(result.status).json(result.json)
}
