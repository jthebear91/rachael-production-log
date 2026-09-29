// Fractional order keys, same lexicographic scheme Todoist uses for `order_key`.
// A key that sorts before every sibling key places the task at the top.
// Digits and integer-length rules match Todoist's fractional indexing.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function integerLength(head) {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  const err = new Error('invalid order key')
  err.code = 'ORDER_KEY'
  throw err
}

function integerPart(key) {
  if (!key || typeof key !== 'string') {
    const err = new Error('invalid order key')
    err.code = 'ORDER_KEY'
    throw err
  }
  const len = integerLength(key.charAt(0))
  if (len > key.length) {
    const err = new Error('invalid order key')
    err.code = 'ORDER_KEY'
    throw err
  }
  const head = key.slice(0, len)
  for (let i = 1; i < head.length; i++) {
    if (!DIGITS.includes(head.charAt(i))) {
      const err = new Error('invalid order key')
      err.code = 'ORDER_KEY'
      throw err
    }
  }
  return head
}

const SMALLEST_INTEGER = `A${'0'.repeat(integerLength('A') - 1)}`

function decrementInteger(value) {
  const head = value.charAt(0)
  const digs = value.slice(1).split('')
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const next = DIGITS.indexOf(digs[i]) - 1
    if (next === -1) {
      digs[i] = DIGITS[DIGITS.length - 1]
    } else {
      digs[i] = DIGITS[next]
      borrow = false
    }
  }
  if (!borrow) return head + digs.join('')
  if (head === 'a') return `Z${DIGITS[DIGITS.length - 1]}`
  if (head === 'A') return null
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1)
  if (nextHead < 'Z') digs.push(DIGITS[DIGITS.length - 1])
  else digs.pop()
  return nextHead + digs.join('')
}

// Key strictly less than `orderKey`. Null/empty means the column is empty (`a0`).
function orderKeyBefore(orderKey) {
  if (orderKey == null || orderKey === '') return 'a0'
  const ib = integerPart(orderKey)
  const fraction = orderKey.slice(ib.length)
  if (fraction && ib < orderKey && ib !== SMALLEST_INTEGER) return ib
  if (ib === SMALLEST_INTEGER && !fraction) {
    const err = new Error('order key is already first')
    err.code = 'ORDER_KEY_FLOOR'
    throw err
  }
  if (ib === SMALLEST_INTEGER && fraction) return ib
  const dec = decrementInteger(ib)
  if (!dec || !(dec < orderKey)) {
    const err = new Error('order key is already first')
    err.code = 'ORDER_KEY_FLOOR'
    throw err
  }
  return dec
}

module.exports = {
  DIGITS,
  SMALLEST_INTEGER,
  decrementInteger,
  integerPart,
  orderKeyBefore
}
