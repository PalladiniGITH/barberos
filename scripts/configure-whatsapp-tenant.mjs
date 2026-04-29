import process from 'node:process'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function readArg(name) {
  const prefix = `--${name}=`
  const match = process.argv.find((value) => value.startsWith(prefix))
  return match ? match.slice(prefix.length).trim() : null
}

function humanizeSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function main() {
  const slug = readArg('slug')
  const instance = readArg('instance')
  const explicitName = readArg('name')
  const timezone = readArg('timezone') || 'America/Sao_Paulo'

  if (!slug || !instance) {
    throw new Error('Uso: npm run whatsapp:configure:tenant -- --slug=konoha --instance=konoha [--name=Konoha]')
  }

  const barbershop = await prisma.barbershop.upsert({
    where: { slug },
    update: {
      active: true,
      whatsappEnabled: true,
      evolutionInstanceName: instance,
      ...(explicitName ? { name: explicitName } : {}),
      ...(timezone ? { timezone } : {}),
    },
    create: {
      slug,
      name: explicitName || humanizeSlug(slug),
      active: true,
      whatsappEnabled: true,
      evolutionInstanceName: instance,
      timezone,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      active: true,
      whatsappEnabled: true,
      evolutionInstanceName: true,
      timezone: true,
    },
  })

  console.info('[whatsapp-tenant] tenant configured', barbershop)
}

main()
  .catch((error) => {
    console.error('[whatsapp-tenant] configure failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
