const test = require('node:test')
const assert = require('node:assert/strict')

const auth = require('@/lib/auth')
const { prisma } = require('@/lib/prisma')
const avatarRoute = require('@/app/api/professionals/[professionalId]/avatar/route')
const avatarFileRoute = require('@/app/uploads/professionals/[barbershopId]/[fileName]/route')
const {
  isProfessionalAvatarUrl,
  normalizeProfessionalAvatarUrl,
} = require('@/lib/professionals/avatar')

function withMockedAuth(mockImplementation, fn) {
  const originalRequireSession = auth.requireSession
  auth.requireSession = mockImplementation

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      auth.requireSession = originalRequireSession
    })
}

function withMockedProfessionalFindUnique(mockImplementation, fn) {
  const originalFindUnique = prisma.professional.findUnique
  prisma.professional.findUnique = mockImplementation

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      prisma.professional.findUnique = originalFindUnique
    })
}

test('rejeita avatar URL suspeita e aceita caminhos seguros', () => {
  assert.equal(isProfessionalAvatarUrl('/uploads/professionals/shop/prof-1.webp'), true)
  assert.equal(isProfessionalAvatarUrl('https://cdn.barberex.com/avatar.png'), true)
  assert.equal(isProfessionalAvatarUrl('/../../evil.png'), false)
  assert.equal(isProfessionalAvatarUrl('/uploads/../../evil.png'), false)
  assert.equal(isProfessionalAvatarUrl('javascript:alert(1)'), false)
  assert.equal(isProfessionalAvatarUrl('data:image/svg+xml,<svg></svg>'), false)
  assert.equal(isProfessionalAvatarUrl('https://cdn.barberex.com/avatar.svg'), false)
  assert.equal(normalizeProfessionalAvatarUrl('/uploads/professionals/shop/prof-1.webp'), '/uploads/professionals/shop/prof-1.webp')
  assert.equal(normalizeProfessionalAvatarUrl('/../../evil.png'), null)
})

test('rota de upload exige sessao autenticada', async () => {
  await withMockedAuth(
    async () => {
      throw new auth.AuthenticationRequiredError()
    },
    async () => {
      const response = await avatarRoute.POST(
        { formData: async () => new FormData() },
        { params: { professionalId: 'prof-1' } }
      )

      assert.equal(response.status, 401)
      assert.match(await response.text(), /Sessao expirada/)
    }
  )
})

test('rota de upload bloqueia profissional de outro tenant', async () => {
  await withMockedAuth(
    async () => ({
      user: {
        id: 'user-1',
        role: 'OWNER',
        barbershopId: 'shop-linha-nobre',
      },
    }),
    async () => {
      await withMockedProfessionalFindUnique(
        async () => ({
          id: 'prof-1',
          barbershopId: 'shop-konoha',
          avatar: null,
        }),
        async () => {
          const response = await avatarRoute.POST(
            { formData: async () => new FormData() },
            { params: { professionalId: 'prof-1' } }
          )

          assert.equal(response.status, 403)
          assert.match(await response.text(), /Profissional nao encontrado para este tenant/)
        }
      )
    }
  )
})

test('rota publica de avatar rejeita path traversal no nome do arquivo', async () => {
  const response = await avatarFileRoute.GET(
    new Request('http://localhost/uploads/professionals/shop/../../evil.png'),
    {
      params: {
        barbershopId: 'cmbarber123',
        fileName: '../../evil.png',
      },
    }
  )

  assert.equal(response.status, 400)
  assert.match(await response.text(), /Arquivo de avatar invalido/)
})
