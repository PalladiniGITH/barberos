import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const allowedRoles = new Set(['NONE', 'PLATFORM_ADMIN', 'PLATFORM_OWNER'])

function readArg(name) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length).trim() : ''
}

async function main() {
  const email = readArg('email')
  const role = (readArg('role') || 'PLATFORM_ADMIN').toUpperCase()

  if (!email) {
    throw new Error('Informe o email com --email=usuario@dominio.com')
  }

  if (!allowedRoles.has(role)) {
    throw new Error(`Role invalida. Use uma destas: ${Array.from(allowedRoles).join(', ')}`)
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      platformRole: true,
    },
  })

  if (!user) {
    throw new Error(`Usuario nao encontrado para ${email}`)
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      platformRole: role,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      platformRole: true,
    },
  })

  console.info('[platform-role] updated', updated)
}

main()
  .catch((error) => {
    console.error('[platform-role] failed', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
