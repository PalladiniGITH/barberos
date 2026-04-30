const test = require('node:test')
const assert = require('node:assert/strict')

const nextCache = require('next/cache')
const auth = require('@/lib/auth')
const { prisma } = require('@/lib/prisma')
const platformAdminActions = require('@/actions/platform-admin')
const { buildBarbershopOnboardingChecklist } = require('@/lib/platform-admin')

const VALID_BARBERSHOP_ID = `c${'1'.repeat(24)}`
const OTHER_BARBERSHOP_ID = `c${'2'.repeat(24)}`
const VALID_PROFESSIONAL_ID = `c${'3'.repeat(24)}`
const VALID_SERVICE_ID = `c${'4'.repeat(24)}`
const VALID_CUSTOMER_ID = `c${'5'.repeat(24)}`

function withMockedRequireSession(mockImplementation, fn) {
  const originalRequireSession = auth.requireSession
  auth.requireSession = mockImplementation

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      auth.requireSession = originalRequireSession
    })
}

function withPatchedMethods(patches, fn) {
  const originals = patches.map(({ object, key }) => ({
    object,
    key,
    original: object[key],
  }))

  for (const patch of patches) {
    patch.object[patch.key] = patch.value
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const original of originals) {
        original.object[original.key] = original.original
      }
    })
}

function withMockedRevalidatePath(fn) {
  return withPatchedMethods(
    [
      {
        object: nextCache,
        key: 'revalidatePath',
        value: () => {},
      },
    ],
    fn
  )
}

function getPlatformSession(platformRole = 'PLATFORM_ADMIN') {
  return {
    user: {
      id: 'platform-user-1',
      role: 'OWNER',
      barbershopId: VALID_BARBERSHOP_ID,
      platformRole,
    },
  }
}

test('PLATFORM_ADMIN consegue atualizar dados principais da barbearia alvo', async () => {
  let updatePayload = null

  await withMockedRequireSession(
    async () => getPlatformSession(),
    async () => {
      await withMockedRevalidatePath(async () => {
        await withPatchedMethods(
          [
            {
              object: prisma.barbershop,
              key: 'findUnique',
              value: async () => ({
                id: VALID_BARBERSHOP_ID,
                slug: 'linha-nobre',
                name: 'Linha Nobre',
                timezone: 'America/Sao_Paulo',
                active: true,
                blockedAt: null,
              }),
            },
            {
              object: prisma.barbershop,
              key: 'findFirst',
              value: async () => null,
            },
            {
              object: prisma.barbershop,
              key: 'update',
              value: async (input) => {
                updatePayload = input
                return { id: VALID_BARBERSHOP_ID }
              },
            },
            {
              object: prisma.platformAuditLog,
              key: 'create',
              value: async () => ({ id: 'audit-1' }),
            },
          ],
          async () => {
            const result = await platformAdminActions.updatePlatformBarbershop({
              barbershopId: VALID_BARBERSHOP_ID,
              name: 'Linha Nobre Premium',
              slug: 'linha-nobre-premium',
              timezone: 'America/Sao_Paulo',
              active: true,
              phone: '11999990000',
              email: 'contato@linhanobre.com',
              address: 'Rua Premium, 100',
              billingEmail: 'financeiro@linhanobre.com',
              subscriptionPlan: 'Growth',
              subscriptionStatus: 'ACTIVE',
              trialEndsAt: '',
              blockedReason: '',
              whatsappEnabled: true,
              evolutionInstanceName: 'linha-nobre-prod',
            })

            assert.deepEqual(result, { success: true })
            assert.equal(updatePayload.where.id, VALID_BARBERSHOP_ID)
            assert.equal(updatePayload.data.slug, 'linha-nobre-premium')
            assert.equal(updatePayload.data.evolutionInstanceName, 'linha-nobre-prod')
          }
        )
      })
    }
  )
})

for (const blockedUser of [
  { role: 'MANAGER', platformRole: 'NONE', label: 'admin comum' },
  { role: 'BARBER', platformRole: 'NONE', label: 'barber' },
]) {
  test(`${blockedUser.label} nao consegue usar action interna`, async () => {
    await withMockedRequireSession(
      async () => ({
        user: {
          ...getPlatformSession().user,
          role: blockedUser.role,
          platformRole: blockedUser.platformRole,
        },
      }),
      async () => {
        await assert.rejects(
          () => platformAdminActions.updatePlatformBarbershop({
            barbershopId: VALID_BARBERSHOP_ID,
            name: 'Linha Nobre',
            slug: 'linha-nobre',
            timezone: 'America/Sao_Paulo',
            active: true,
            phone: '',
            email: '',
            address: '',
            billingEmail: '',
            subscriptionPlan: '',
            subscriptionStatus: 'ACTIVE',
            trialEndsAt: '',
            blockedReason: '',
            whatsappEnabled: false,
            evolutionInstanceName: '',
          }),
          /Sem permissao para acessar a operacao interna da plataforma\./
        )
      }
    )
  })
}

test('PLATFORM_ADMIN cria profissional para o barbershop alvo', async () => {
  let createPayload = null

  await withMockedRequireSession(
    async () => getPlatformSession(),
    async () => {
      await withMockedRevalidatePath(async () => {
        await withPatchedMethods(
          [
            {
              object: prisma.barbershop,
              key: 'findUnique',
              value: async () => ({
                id: VALID_BARBERSHOP_ID,
                slug: 'linha-nobre',
                name: 'Linha Nobre',
                timezone: 'America/Sao_Paulo',
                active: true,
                blockedAt: null,
              }),
            },
            {
              object: prisma.professional,
              key: 'create',
              value: async (input) => {
                createPayload = input
                return { id: VALID_PROFESSIONAL_ID }
              },
            },
            {
              object: prisma.platformAuditLog,
              key: 'create',
              value: async () => ({ id: 'audit-2' }),
            },
          ],
          async () => {
            const result = await platformAdminActions.createPlatformProfessional({
              barbershopId: VALID_BARBERSHOP_ID,
              name: 'Rafael Costa',
              email: '',
              phone: '11988887777',
              avatar: '',
              commissionRate: '45',
              haircutPrice: '55',
              beardPrice: '',
              comboPrice: '',
              attendanceScope: 'BOTH',
              active: true,
            })

            assert.deepEqual(result, { success: true, id: VALID_PROFESSIONAL_ID })
            assert.equal(createPayload.data.barbershopId, VALID_BARBERSHOP_ID)
            assert.equal(createPayload.data.name, 'Rafael Costa')
          }
        )
      })
    }
  )
})

test('PLATFORM_ADMIN nao cria profissional com dados invalidos', async () => {
  let createCalled = false

  await withMockedRequireSession(
    async () => getPlatformSession(),
    async () => {
      await withPatchedMethods(
        [
          {
            object: prisma.professional,
            key: 'create',
            value: async () => {
              createCalled = true
              return { id: VALID_PROFESSIONAL_ID }
            },
          },
        ],
        async () => {
          const result = await platformAdminActions.createPlatformProfessional({
            barbershopId: VALID_BARBERSHOP_ID,
            name: 'A',
            email: '',
            phone: '',
            avatar: '',
            commissionRate: '',
            haircutPrice: '',
            beardPrice: '',
            comboPrice: '',
            attendanceScope: 'BOTH',
            active: true,
          })

          assert.equal(result.success, false)
          assert.match(result.error, /Nome deve ter ao menos 2 caracteres/)
          assert.equal(createCalled, false)
        }
      )
    }
  )
})

test('PLATFORM_ADMIN cria servico para o barbershop alvo', async () => {
  let createPayload = null

  await withMockedRequireSession(
    async () => getPlatformSession(),
    async () => {
      await withMockedRevalidatePath(async () => {
        await withPatchedMethods(
          [
            {
              object: prisma.barbershop,
              key: 'findUnique',
              value: async () => ({
                id: VALID_BARBERSHOP_ID,
                slug: 'linha-nobre',
                name: 'Linha Nobre',
                timezone: 'America/Sao_Paulo',
                active: true,
                blockedAt: null,
              }),
            },
            {
              object: prisma.service,
              key: 'create',
              value: async (input) => {
                createPayload = input
                return { id: VALID_SERVICE_ID }
              },
            },
            {
              object: prisma.platformAuditLog,
              key: 'create',
              value: async () => ({ id: 'audit-3' }),
            },
          ],
          async () => {
            const result = await platformAdminActions.createPlatformService({
              barbershopId: VALID_BARBERSHOP_ID,
              name: 'Barba Terapia',
              description: 'Relaxamento e modelagem',
              price: '79.9',
              duration: '45',
              categoryId: '',
              active: true,
            })

            assert.deepEqual(result, { success: true, id: VALID_SERVICE_ID })
            assert.equal(createPayload.data.barbershopId, VALID_BARBERSHOP_ID)
            assert.equal(createPayload.data.duration, 45)
          }
        )
      })
    }
  )
})

test('servico com duracao invalida e rejeitado no backend interno', async () => {
  let createCalled = false

  await withMockedRequireSession(
    async () => getPlatformSession(),
    async () => {
      await withPatchedMethods(
        [
          {
            object: prisma.service,
            key: 'create',
            value: async () => {
              createCalled = true
              return { id: VALID_SERVICE_ID }
            },
          },
        ],
        async () => {
          const result = await platformAdminActions.createPlatformService({
            barbershopId: VALID_BARBERSHOP_ID,
            name: 'Servico invalido',
            description: '',
            price: '10',
            duration: '0',
            categoryId: '',
            active: true,
          })

          assert.equal(result.success, false)
          assert.match(result.error, /Duracao deve ser positiva/)
          assert.equal(createCalled, false)
        }
      )
    }
  )
})

test('PLATFORM_ADMIN cria cliente para o barbershop alvo', async () => {
  let createPayload = null

  await withMockedRequireSession(
    async () => getPlatformSession(),
    async () => {
      await withMockedRevalidatePath(async () => {
        await withPatchedMethods(
          [
            {
              object: prisma.barbershop,
              key: 'findUnique',
              value: async () => ({
                id: VALID_BARBERSHOP_ID,
                slug: 'linha-nobre',
                name: 'Linha Nobre',
                timezone: 'America/Sao_Paulo',
                active: true,
                blockedAt: null,
              }),
            },
            {
              object: prisma.customer,
              key: 'create',
              value: async (input) => {
                createPayload = input
                return { id: VALID_CUSTOMER_ID }
              },
            },
            {
              object: prisma.platformAuditLog,
              key: 'create',
              value: async () => ({ id: 'audit-4' }),
            },
          ],
          async () => {
            const result = await platformAdminActions.createPlatformCustomer({
              barbershopId: VALID_BARBERSHOP_ID,
              name: 'Cliente Premium',
              phone: '11977776666',
              email: 'cliente@teste.com',
              notes: 'Migrado manualmente',
              type: 'WALK_IN',
              preferredProfessionalId: '',
              active: true,
              marketingOptOut: false,
              subscriptionStatus: '',
              subscriptionPrice: '',
              subscriptionStartedAt: '',
            })

            assert.deepEqual(result, { success: true, id: VALID_CUSTOMER_ID })
            assert.equal(createPayload.data.barbershopId, VALID_BARBERSHOP_ID)
            assert.equal(createPayload.data.name, 'Cliente Premium')
          }
        )
      })
    }
  )
})

test('actions internas validam que o recurso pertence ao barbershop correto', async () => {
  let updateCalled = false

  await withMockedRequireSession(
    async () => getPlatformSession(),
    async () => {
      await withPatchedMethods(
        [
          {
            object: prisma.professional,
            key: 'findUnique',
            value: async () => ({
              id: VALID_PROFESSIONAL_ID,
              barbershopId: OTHER_BARBERSHOP_ID,
              avatar: null,
              email: null,
              active: true,
              acceptsSubscription: true,
              acceptsWalkIn: true,
            }),
          },
          {
            object: prisma.professional,
            key: 'update',
            value: async () => {
              updateCalled = true
              return { id: VALID_PROFESSIONAL_ID }
            },
          },
        ],
        async () => {
          const result = await platformAdminActions.updatePlatformProfessional(VALID_PROFESSIONAL_ID, {
            barbershopId: VALID_BARBERSHOP_ID,
            name: 'Rafael Costa',
            email: '',
            phone: '',
            avatar: '',
            commissionRate: '',
            haircutPrice: '',
            beardPrice: '',
            comboPrice: '',
            attendanceScope: 'BOTH',
            active: true,
          })

          assert.equal(result.success, false)
          assert.match(result.error, /Profissional nao encontrado\./)
          assert.equal(updateCalled, false)
        }
      )
    }
  )
})

test('checklist de implantacao calcula pendencias e itens completos com base nos dados reais', () => {
  const checklist = buildBarbershopOnboardingChecklist({
    barbershop: {
      name: 'Linha Nobre',
      slug: 'linha-nobre',
      timezone: 'America/Sao_Paulo',
      whatsappEnabled: true,
      evolutionInstanceName: '',
    },
    metrics: {
      activeProfessionals: 0,
      activeServices: 2,
      customers: 0,
      upcomingAppointments: 0,
      financialCategories: 1,
      whatsappLastEventAt: null,
    },
  })

  const operationGroup = checklist.groups.find((group) => group.id === 'operation')
  const whatsappGroup = checklist.groups.find((group) => group.id === 'whatsapp')

  assert.ok(operationGroup)
  assert.ok(whatsappGroup)
  assert.equal(operationGroup.items.find((item) => item.id === 'professionals')?.status, 'pending')
  assert.equal(operationGroup.items.find((item) => item.id === 'services')?.status, 'complete')
  assert.equal(whatsappGroup.items.find((item) => item.id === 'whatsapp-enabled')?.status, 'complete')
  assert.ok(checklist.summary.total > 0)
  assert.ok(checklist.summary.pending > 0)
})
