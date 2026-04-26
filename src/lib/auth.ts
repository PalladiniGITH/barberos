import { NextAuthOptions, getServerSession } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import {
  AUTH_ENTRY_PATH,
  normalizeAppRole,
  normalizePlatformRole,
  type AppRole,
  type PlatformRole,
} from '@/lib/auth-routes'

const withStableCache: typeof cache = typeof cache === 'function'
  ? cache
  : ((factory: Parameters<typeof cache>[0]) => factory) as typeof cache

export class AuthenticationRequiredError extends Error {
  constructor(message = 'Sessao autenticada obrigatoria para continuar.') {
    super(message)
    this.name = 'AuthenticationRequiredError'
  }
}

export class AuthorizationError extends Error {
  constructor(message = 'Sem permissao para executar esta operacao.') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: 'jwt' },
  pages: {
    signIn: AUTH_ENTRY_PATH,
    error: AUTH_ENTRY_PATH,
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { barbershop: true },
        })

        if (!user || !user.passwordHash || !user.active) return null

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          platformRole: user.platformRole,
          barbershopId: user.barbershopId,
          barbershopName: user.barbershop.name,
          barbershopSlug: user.barbershop.slug,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.platformRole = (user as any).platformRole
        token.barbershopId = (user as any).barbershopId
        token.barbershopName = (user as any).barbershopName
        token.barbershopSlug = (user as any).barbershopSlug
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.platformRole = token.platformRole as string
        session.user.barbershopId = token.barbershopId as string
        session.user.barbershopName = token.barbershopName as string
        session.user.barbershopSlug = token.barbershopSlug as string
      }
      return session
    },
  },
}

export const getSession = withStableCache(() => getServerSession(authOptions))

/**
 * Assegura que a sessao autenticada existe para codigo server-side.
 * Nao executa redirects de navegacao: o middleware e o guard oficial das rotas privadas.
 */
export async function requireSession() {
  const session = await getSession()
  if (!session?.user?.barbershopId) {
    throw new AuthenticationRequiredError(
      'Sessao ausente em contexto server-side protegido. O middleware deve bloquear a navegacao antes desta camada.'
    )
  }
  return session
}

export function assertRoleAllowed(
  role: string | null | undefined,
  allowedRoles: AppRole[],
  message = 'Sem permissao para executar esta operacao.'
): AppRole {
  const normalizedRole = normalizeAppRole(role)

  if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
    throw new AuthorizationError(message)
  }

  return normalizedRole
}

export function assertAdministrativeRole(
  role: string | null | undefined,
  message = 'Sem permissao para acessar dados administrativos.'
) {
  return assertRoleAllowed(role, ['OWNER', 'MANAGER', 'FINANCIAL'], message)
}

export function assertPlatformRoleAllowed(
  platformRole: string | null | undefined,
  allowedRoles: PlatformRole[] = ['PLATFORM_ADMIN', 'PLATFORM_OWNER'],
  message = 'Sem permissao para acessar a operacao interna da plataforma.'
) {
  const normalizedRole = normalizePlatformRole(platformRole)

  if (!normalizedRole || normalizedRole === 'NONE' || !allowedRoles.includes(normalizedRole)) {
    throw new AuthorizationError(message)
  }

  return normalizedRole
}

export async function requirePlatformSession() {
  const session = await requireSession()
  assertPlatformRoleAllowed(session.user.platformRole)
  return session
}

/**
 * Valida que um ID pertence ao barbershopId do tenant atual.
 * Lança erro 403 se o recurso não existir ou for de outro tenant.
 */
export async function assertOwnership(
  barbershopId: string,
  table: 'professional' | 'service' | 'financialCategory' | 'supply' | 'customer',
  id: string | null | undefined
) {
  if (!id) return
  const record = await (prisma[table] as any).findUnique({ where: { id }, select: { barbershopId: true } })
  if (!record || record.barbershopId !== barbershopId) {
    throw new Error(`Acesso negado: recurso ${table}#${id} não pertence ao tenant`)
  }
}
