const test = require('node:test')
const assert = require('node:assert/strict')

const { ensureResourceBelongsToBarbershop } = require('@/lib/security/guards')

test('bloqueia recurso fora do tenant atual', () => {
  assert.throws(() => ensureResourceBelongsToBarbershop('shop-konoha', 'shop-linha-nobre'), {
    name: 'AuthorizationError',
    message: 'Recurso fora do tenant atual.',
  })
})

test('aceita recurso do mesmo tenant', () => {
  assert.doesNotThrow(() =>
    ensureResourceBelongsToBarbershop('shop-linha-nobre', 'shop-linha-nobre')
  )
})
