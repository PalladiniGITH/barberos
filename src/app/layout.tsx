import type { Metadata } from 'next'
import { Manrope, Sora } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/branding'

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
})

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  applicationName: PRODUCT_NAME,
  title: { default: PRODUCT_NAME, template: `%s | ${PRODUCT_NAME}` },
  description: PRODUCT_TAGLINE,
  icons: {
    icon: [{ url: '/favicon.png', type: 'image/png' }],
    shortcut: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${manrope.variable} ${sora.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
