const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getProfessionalInitials,
  isProfessionalAvatarUrl,
  normalizeProfessionalAvatarUrl,
} = require('@/lib/professionals/avatar')

test('gera iniciais curtas e consistentes para fallback de profissional', () => {
  assert.equal(getProfessionalInitials('Joao Silva'), 'JS')
  assert.equal(getProfessionalInitials('  Maria  '), 'M')
  assert.equal(getProfessionalInitials(''), 'PR')
})

test('aceita apenas urls seguras para avatar de profissional', () => {
  assert.equal(isProfessionalAvatarUrl('https://cdn.barberex.com/avatar.png'), true)
  assert.equal(isProfessionalAvatarUrl('/uploads/professionals/konoha/avatar.webp'), true)
  assert.equal(isProfessionalAvatarUrl('data:image/png;base64,abc'), false)
  assert.equal(isProfessionalAvatarUrl('javascript:alert(1)'), false)
})

test('normaliza avatar vazio ou invalido para null', () => {
  assert.equal(normalizeProfessionalAvatarUrl('   '), null)
  assert.equal(normalizeProfessionalAvatarUrl('ftp://example.com/avatar.png'), null)
  assert.equal(normalizeProfessionalAvatarUrl('https://barberex.com/avatar.png'), 'https://barberex.com/avatar.png')
})
