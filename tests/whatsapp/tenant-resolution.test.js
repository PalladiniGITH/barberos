const test = require('node:test')
const assert = require('node:assert/strict')

const { prisma } = require('@/lib/prisma')
const { normalizeEvolutionWebhookPayload } = require('@/lib/integrations/evolution')
const { __testing: handlerTesting } = require('@/lib/whatsapp-handler')
const {
  resolveWhatsAppOutboundIntegration,
  resolveWhatsAppTenantFromEvolutionPayload,
} = require('@/lib/whatsapp-tenant')

const BARBERSHOPS = [
  {
    id: 'shop-ln',
    name: 'Linha Nobre',
    slug: 'linha-nobre',
    timezone: 'America/Sao_Paulo',
    active: true,
    whatsappEnabled: true,
    evolutionInstanceName: 'barberex',
  },
  {
    id: 'shop-konoha',
    name: 'Konoha',
    slug: 'konoha',
    timezone: 'America/Sao_Paulo',
    active: true,
    whatsappEnabled: true,
    evolutionInstanceName: 'konoha',
  },
]

function withTenantEnv(overrides = {}) {
  const originals = {
    EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK: process.env.EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK,
    EVOLUTION_BARBERSHOP_SLUG: process.env.EVOLUTION_BARBERSHOP_SLUG,
    EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE,
  }

  process.env.EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK = overrides.EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK ?? ''
  process.env.EVOLUTION_BARBERSHOP_SLUG = overrides.EVOLUTION_BARBERSHOP_SLUG ?? ''
  process.env.EVOLUTION_INSTANCE = overrides.EVOLUTION_INSTANCE ?? ''

  const restoreValue = (key, value) => {
    if (typeof value === 'string') {
      process.env[key] = value
      return
    }

    delete process.env[key]
  }

  return () => {
    restoreValue(
      'EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK',
      originals.EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK
    )
    restoreValue('EVOLUTION_BARBERSHOP_SLUG', originals.EVOLUTION_BARBERSHOP_SLUG)
    restoreValue('EVOLUTION_INSTANCE', originals.EVOLUTION_INSTANCE)
  }
}

function withTenantPrismaMocks(mocks, fn) {
  const originals = {
    barbershopFindMany: prisma.barbershop.findMany,
    barbershopFindUnique: prisma.barbershop.findUnique,
    customerFindMany: prisma.customer.findMany,
    customerCreate: prisma.customer.create,
    customerUpdate: prisma.customer.update,
    whatsappConversationUpsert: prisma.whatsappConversation.upsert,
  }

  prisma.barbershop.findMany = mocks.barbershopFindMany ?? originals.barbershopFindMany
  prisma.barbershop.findUnique = mocks.barbershopFindUnique ?? originals.barbershopFindUnique
  prisma.customer.findMany = mocks.customerFindMany ?? originals.customerFindMany
  prisma.customer.create = mocks.customerCreate ?? originals.customerCreate
  prisma.customer.update = mocks.customerUpdate ?? originals.customerUpdate
  prisma.whatsappConversation.upsert = mocks.whatsappConversationUpsert ?? originals.whatsappConversationUpsert

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      prisma.barbershop.findMany = originals.barbershopFindMany
      prisma.barbershop.findUnique = originals.barbershopFindUnique
      prisma.customer.findMany = originals.customerFindMany
      prisma.customer.create = originals.customerCreate
      prisma.customer.update = originals.customerUpdate
      prisma.whatsappConversation.upsert = originals.whatsappConversationUpsert
    })
}

test('instanceName=konoha resolve Konoha sem cair no slug legado global', async () => {
  const restoreEnv = withTenantEnv({
    EVOLUTION_BARBERSHOP_SLUG: 'linha-nobre',
    EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK: 'false',
    EVOLUTION_INSTANCE: 'barberex',
  })

  try {
    await withTenantPrismaMocks(
      {
        barbershopFindMany: async () => BARBERSHOPS,
      },
      async () => {
        const result = await resolveWhatsAppTenantFromEvolutionPayload({
          instanceName: 'konoha',
        })

        assert.equal(result.status, 'resolved')
        assert.equal(result.barbershopSlug, 'konoha')
        assert.equal(result.instanceName, 'konoha')
        assert.equal(result.matchedBy, 'instance')
      }
    )
  } finally {
    restoreEnv()
  }
})

test('instanceName=barberex resolve Linha Nobre pela configuracao persistida', async () => {
  const restoreEnv = withTenantEnv({
    EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK: 'false',
  })

  try {
    await withTenantPrismaMocks(
      {
        barbershopFindMany: async () => BARBERSHOPS,
      },
      async () => {
        const result = await resolveWhatsAppTenantFromEvolutionPayload({
          instanceName: 'barberex',
        })

        assert.equal(result.status, 'resolved')
        assert.equal(result.barbershopSlug, 'linha-nobre')
        assert.equal(result.instanceName, 'barberex')
      }
    )
  } finally {
    restoreEnv()
  }
})

test('instance desconhecida e ignorada com seguranca', async () => {
  const restoreEnv = withTenantEnv()

  try {
    await withTenantPrismaMocks(
      {
        barbershopFindMany: async () => BARBERSHOPS,
      },
      async () => {
        const result = await resolveWhatsAppTenantFromEvolutionPayload({
          instanceName: 'teste-inexistente',
        })

        assert.equal(result.status, 'ignored')
        assert.equal(result.reason, 'unknown_instance')
        assert.equal(result.barbershopId, null)
      }
    )
  } finally {
    restoreEnv()
  }
})

test('route slug e instance coerentes resolvem o mesmo tenant', async () => {
  const restoreEnv = withTenantEnv()

  try {
    await withTenantPrismaMocks(
      {
        barbershopFindMany: async () => BARBERSHOPS,
      },
      async () => {
        const result = await resolveWhatsAppTenantFromEvolutionPayload({
          instanceName: 'konoha',
          routeBarbershopSlug: 'konoha',
        })

        assert.equal(result.status, 'resolved')
        assert.equal(result.barbershopSlug, 'konoha')
      }
    )
  } finally {
    restoreEnv()
  }
})

test('route slug divergente do instanceName gera mismatch e nao processa', async () => {
  const restoreEnv = withTenantEnv()

  try {
    await withTenantPrismaMocks(
      {
        barbershopFindMany: async () => BARBERSHOPS,
      },
      async () => {
        const result = await resolveWhatsAppTenantFromEvolutionPayload({
          instanceName: 'barberex',
          routeBarbershopSlug: 'konoha',
        })

        assert.equal(result.status, 'error')
        assert.equal(result.reason, 'slug_instance_mismatch')
        assert.equal(result.barbershopSlug, 'linha-nobre')
      }
    )
  } finally {
    restoreEnv()
  }
})

test('sem instanceName e com fallback legado desligado o evento nao e processado', async () => {
  const restoreEnv = withTenantEnv({
    EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK: 'false',
    EVOLUTION_BARBERSHOP_SLUG: 'linha-nobre',
    EVOLUTION_INSTANCE: 'barberex',
  })

  try {
    await withTenantPrismaMocks(
      {
        barbershopFindMany: async () => BARBERSHOPS,
      },
      async () => {
        const result = await resolveWhatsAppTenantFromEvolutionPayload({})

        assert.equal(result.status, 'ignored')
        assert.equal(result.reason, 'tenant_not_resolved')
      }
    )
  } finally {
    restoreEnv()
  }
})

test('sem instanceName e com fallback legado ligado usa o slug legado com warning controlado', async () => {
  const restoreEnv = withTenantEnv({
    EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK: 'true',
    EVOLUTION_BARBERSHOP_SLUG: 'linha-nobre',
    EVOLUTION_INSTANCE: 'barberex',
  })

  try {
    await withTenantPrismaMocks(
      {
        barbershopFindMany: async () => BARBERSHOPS,
      },
      async () => {
        const result = await resolveWhatsAppTenantFromEvolutionPayload({})

        assert.equal(result.status, 'resolved')
        assert.equal(result.barbershopSlug, 'linha-nobre')
        assert.equal(result.instanceName, 'barberex')
        assert.equal(result.matchedBy, 'legacy_env_slug')
      }
    )
  } finally {
    restoreEnv()
  }
})

test('outbound carrega a instancia correta por barbearia', async () => {
  await withTenantPrismaMocks(
    {
      barbershopFindUnique: async ({ where }) => BARBERSHOPS.find((item) => item.id === where.id) ?? null,
    },
    async () => {
      const konoha = await resolveWhatsAppOutboundIntegration({
        barbershopId: 'shop-konoha',
      })
      const linhaNobre = await resolveWhatsAppOutboundIntegration({
        barbershopId: 'shop-ln',
      })

      assert.equal(konoha.status, 'resolved')
      assert.equal(konoha.instanceName, 'konoha')
      assert.equal(linhaNobre.status, 'resolved')
      assert.equal(linhaNobre.instanceName, 'barberex')
    }
  )
})

test('mesmo telefone em tenants diferentes continua isolado por barbershopId na busca de cliente e conversa', async () => {
  const customerQueries = []
  const conversationKeys = []
  let createdCustomerCount = 0

  await withTenantPrismaMocks(
    {
      customerFindMany: async ({ where }) => {
        customerQueries.push(where.barbershopId)
        return []
      },
      customerCreate: async ({ data }) => {
        createdCustomerCount += 1
        return {
          id: `customer-${createdCustomerCount}`,
          name: data.name,
        }
      },
      customerUpdate: async () => null,
      whatsappConversationUpsert: async ({ where }) => {
        conversationKeys.push(where.barbershopId_customerId)
        return {
          id: `conv-${conversationKeys.length}`,
          state: 'IDLE',
          messageBuffer: null,
          lastMessageTimestamp: null,
          updatedAt: new Date('2026-04-28T12:00:00.000Z'),
        }
      },
    },
    async () => {
      const linhaNobreCustomer = await handlerTesting.findOrCreateCustomerFromInbound({
        barbershopId: 'shop-ln',
        phone: '5541996860137',
        contactName: 'Bruno Linha Nobre',
      })
      const konohaCustomer = await handlerTesting.findOrCreateCustomerFromInbound({
        barbershopId: 'shop-konoha',
        phone: '5541996860137',
        contactName: 'Bruno Konoha',
      })

      await handlerTesting.getOrCreateWhatsappConversation({
        barbershopId: 'shop-ln',
        customerId: linhaNobreCustomer.id,
        phone: '5541996860137',
      })
      await handlerTesting.getOrCreateWhatsappConversation({
        barbershopId: 'shop-konoha',
        customerId: konohaCustomer.id,
        phone: '5541996860137',
      })

      assert.deepEqual(customerQueries, ['shop-ln', 'shop-konoha'])
      assert.deepEqual(conversationKeys, [
        { barbershopId: 'shop-ln', customerId: 'customer-1' },
        { barbershopId: 'shop-konoha', customerId: 'customer-2' },
      ])
    }
  )
})

test('dedupeKey inbound nao colide entre tenants quando o messageId e o mesmo', () => {
  const payloadBase = {
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        id: 'msg-123',
        remoteJid: '5541996860137@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: 'oi',
      },
    },
  }

  const konoha = normalizeEvolutionWebhookPayload({
    ...payloadBase,
    instanceName: 'konoha',
  })
  const linhaNobre = normalizeEvolutionWebhookPayload({
    ...payloadBase,
    instanceName: 'barberex',
  })

  assert.notEqual(konoha.dedupeKey, linhaNobre.dedupeKey)
})
