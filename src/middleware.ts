import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { AUTHENTICATED_HOME_PATH, canRoleAccessPath } from '@/lib/auth-routes'

const PROTECTED_PATHS = [
  '/internal',
  '/dashboard',
  '/agendamentos',
  '/assistente',
  '/clientes',
  '/inteligencia',
  '/financeiro',
  '/equipe',
  '/precificacao',
  '/indicadores',
  '/configuracoes',
  '/desafios',
  '/onboarding',
  '/setup',
] as const

export default withAuth(
  function middleware(req) {
    const pathname = req.nextUrl.pathname
    const role = typeof req.nextauth.token?.role === 'string' ? req.nextauth.token.role : null
    const platformRole = typeof req.nextauth.token?.platformRole === 'string'
      ? req.nextauth.token.platformRole
      : null

    if ((role || platformRole) && !canRoleAccessPath(role, pathname, platformRole)) {
      const redirectUrl = req.nextUrl.clone()
      redirectUrl.pathname = AUTHENTICATED_HOME_PATH
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl)
    }

    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-pathname', pathname)
    requestHeaders.set('x-search', req.nextUrl.search)
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
  },
  {
    pages: {
      signIn: '/',
    },
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname
        if (PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
          return !!token
        }
        return true
      },
    },
  }
)

export const config = {
  matcher: [
    '/dashboard',
    '/internal',
    '/internal/:path*',
    '/agendamentos',
    '/agendamentos/:path*',
    '/assistente',
    '/assistente/:path*',
    '/clientes',
    '/clientes/:path*',
    '/inteligencia',
    '/inteligencia/:path*',
    '/financeiro',
    '/financeiro/:path*',
    '/equipe',
    '/equipe/:path*',
    '/precificacao',
    '/precificacao/:path*',
    '/indicadores',
    '/indicadores/:path*',
    '/configuracoes',
    '/configuracoes/:path*',
    '/desafios',
    '/desafios/:path*',
    '/onboarding',
    '/onboarding/:path*',
    '/setup',
    '/setup/:path*',
  ],
}
