import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const pathname = req.nextUrl.pathname
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
        const protectedPaths = [
          '/dashboard',
          '/inteligencia',
          '/financeiro',
          '/equipe',
          '/precificacao',
          '/indicadores',
          '/configuracoes',
          '/desafios',
        ]
        if (protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
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
  ],
}
