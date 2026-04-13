import { MessagingProvider, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface CliFilters {
  slug: string | null
  phoneDigits: string | null
}

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, '')
}

function printHelp() {
  console.log(`
Uso:
  npm run whatsapp:reset:test
  npm run whatsapp:reset:test -- --slug=linha-nobre
  npm run whatsapp:reset:test -- --phone=554196860137
  npm run whatsapp:reset:test -- --slug=linha-nobre --phone=554196860137

Escopo:
  - apaga somente WhatsappConversation
  - apaga somente MessagingEvent com provider EVOLUTION
  - nunca apaga Customer, Appointment, Professional, Service ou Barbershop
`)
}

function parseArgs(argv: string[]): CliFilters {
  let slug: string | null = null
  let phoneDigits: string | null = null

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }

    if (arg.startsWith('--slug=')) {
      const value = arg.slice('--slug='.length).trim()
      if (!value) {
        throw new Error('O parametro --slug precisa ter um valor.')
      }

      slug = value
      continue
    }

    if (arg.startsWith('--phone=')) {
      const rawValue = arg.slice('--phone='.length).trim()
      const normalized = normalizePhoneDigits(rawValue)

      if (!normalized) {
        throw new Error('O parametro --phone precisa conter um telefone valido.')
      }

      if (normalized.length < 8 || normalized.length > 15) {
        throw new Error('O parametro --phone precisa ter entre 8 e 15 digitos.')
      }

      phoneDigits = normalized
      continue
    }

    throw new Error(`Parametro nao suportado: ${arg}`)
  }

  return { slug, phoneDigits }
}

async function resolveBarbershopScope(slug: string | null) {
  if (!slug) {
    return {
      barbershopIds: null as string[] | null,
      barbershopLabel: 'todas as barbearias',
    }
  }

  const barbershop = await prisma.barbershop.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  })

  if (!barbershop) {
    throw new Error(`Nao encontrei barbearia com slug "${slug}".`)
  }

  return {
    barbershopIds: [barbershop.id],
    barbershopLabel: `${barbershop.name} (${barbershop.slug})`,
  }
}

async function findCustomerIdsByPhone(input: {
  phoneDigits: string | null
  barbershopIds: string[] | null
}) {
  if (!input.phoneDigits) {
    return {
      customerIds: null as string[] | null,
      matchedCustomers: 0,
    }
  }

  const customers = await prisma.customer.findMany({
    where: {
      phone: { not: null },
      barbershopId: input.barbershopIds ? { in: input.barbershopIds } : undefined,
    },
    select: {
      id: true,
      phone: true,
    },
  })

  const customerIds = customers
    .filter((customer) => normalizePhoneDigits(customer.phone ?? '') === input.phoneDigits)
    .map((customer) => customer.id)

  return {
    customerIds,
    matchedCustomers: customerIds.length,
  }
}

async function findConversationIdsToDelete(input: {
  barbershopIds: string[] | null
  phoneDigits: string | null
  customerIds: string[] | null
}) {
  const conversations = await prisma.whatsappConversation.findMany({
    where: {
      barbershopId: input.barbershopIds ? { in: input.barbershopIds } : undefined,
    },
    select: {
      id: true,
      phone: true,
      customerId: true,
    },
  })

  const ids = conversations
    .filter((conversation) => {
      if (!input.phoneDigits) {
        return true
      }

      const conversationPhone = normalizePhoneDigits(conversation.phone ?? '')
      const customerMatch = Boolean(input.customerIds?.includes(conversation.customerId))
      return conversationPhone === input.phoneDigits || customerMatch
    })
    .map((conversation) => conversation.id)

  return ids
}

async function findMessagingEventIdsToDelete(input: {
  barbershopIds: string[] | null
  phoneDigits: string | null
  customerIds: string[] | null
}) {
  const events = await prisma.messagingEvent.findMany({
    where: {
      provider: MessagingProvider.EVOLUTION,
      barbershopId: input.barbershopIds ? { in: input.barbershopIds } : undefined,
    },
    select: {
      id: true,
      remotePhone: true,
      customerId: true,
    },
  })

  const ids = events
    .filter((event) => {
      if (!input.phoneDigits) {
        return true
      }

      const remotePhone = normalizePhoneDigits(event.remotePhone ?? '')
      const customerMatch = Boolean(event.customerId && input.customerIds?.includes(event.customerId))
      return remotePhone === input.phoneDigits || customerMatch
    })
    .map((event) => event.id)

  return ids
}

async function main() {
  const filters = parseArgs(process.argv.slice(2))
  const { barbershopIds, barbershopLabel } = await resolveBarbershopScope(filters.slug)
  const { customerIds, matchedCustomers } = await findCustomerIdsByPhone({
    phoneDigits: filters.phoneDigits,
    barbershopIds,
  })

  const [conversationIds, messagingEventIds] = await Promise.all([
    findConversationIdsToDelete({
      barbershopIds,
      phoneDigits: filters.phoneDigits,
      customerIds,
    }),
    findMessagingEventIdsToDelete({
      barbershopIds,
      phoneDigits: filters.phoneDigits,
      customerIds,
    }),
  ])

  const [conversationDeleteCount, messagingDeleteCount] = await prisma.$transaction(async (tx) => {
    const deletedConversations = conversationIds.length > 0
      ? await tx.whatsappConversation.deleteMany({
          where: { id: { in: conversationIds } },
        })
      : { count: 0 }

    const deletedMessagingEvents = messagingEventIds.length > 0
      ? await tx.messagingEvent.deleteMany({
          where: {
            id: { in: messagingEventIds },
            provider: MessagingProvider.EVOLUTION,
          },
        })
      : { count: 0 }

    return [deletedConversations.count, deletedMessagingEvents.count] as const
  })

  console.log('Reset de testes do WhatsApp concluido.')
  console.log(`Escopo da barbearia: ${barbershopLabel}`)
  console.log(`Filtro de telefone: ${filters.phoneDigits ?? 'nenhum'}`)
  console.log(`Clientes localizados pelo telefone: ${filters.phoneDigits ? matchedCustomers : 'nao aplicavel'}`)
  console.log(`WhatsappConversation apagadas: ${conversationDeleteCount}`)
  console.log(`MessagingEvent EVOLUTION apagados: ${messagingDeleteCount}`)
}

main()
  .catch((error) => {
    console.error('[whatsapp-reset-test] erro', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
