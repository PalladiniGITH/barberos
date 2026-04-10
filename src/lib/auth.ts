import { NextAuthOptions, getServerSession } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { prisma } from '@/lib/prisma'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
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
        session.user.barbershopId = token.barbershopId as string
        session.user.barbershopName = token.barbershopName as string
        session.user.barbershopSlug = token.barbershopSlug as string
      }
      return session
    },
  },
}

export const getSession = cache(() => getServerSession(authOptions))

export async function requireSession() {
  const session = await getSession()
  if (!session?.user?.barbershopId) {
    redirect('/login')
  }
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
