import type { Metadata } from 'next'
import { Manrope, Sora } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
})

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: { default: 'BarberOS', template: '%s | BarberOS' },
  description: 'Gestao inteligente para barbearias modernas',
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
