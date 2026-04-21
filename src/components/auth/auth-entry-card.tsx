'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { ArrowRight, Loader2, LockKeyhole, Scissors } from 'lucide-react'
import { AUTHENTICATED_HOME_PATH } from '@/lib/auth-routes'

interface AuthEntryCardProps {
  callbackUrl: string
  error: string | null
  isAuthenticated: boolean
  userName: string | null
}

function resolveErrorMessage(error: string | null) {
  if (!error) {
    return null
  }

  if (error === 'CredentialsSignin') {
    return 'Email ou senha invalidos.'
  }

  return 'Nao foi possivel entrar agora. Tente novamente.'
}

export function AuthEntryCard({
  callbackUrl,
  error,
  isAuthenticated,
  userName,
}: AuthEntryCardProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const errorMessage = resolveErrorMessage(error)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)

    await signIn('credentials', {
      email,
      password,
      callbackUrl,
    })
  }

  return (
    <main className="auth-shell min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-6 lg:grid-cols-[minmax(0,1.15fr)_440px]">
        <section className="premium-shell p-8 sm:p-10 lg:p-12">
          <div className="spotlight-chip">
            <Scissors className="h-3.5 w-3.5" />
            BarberOS
          </div>
          <h1 className="spotlight-title max-w-xl">
            Operacao, agenda e inteligencia para a rotina da barbearia.
          </h1>
          <p className="spotlight-copy max-w-2xl">
            Entre para acompanhar a agenda, ajustar a operacao do time e manter os agendamentos
            centralizados sem sair do fluxo do dia.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="hero-stat-card">
              <p className="executive-label">Agenda</p>
              <p className="mt-2 text-lg font-semibold text-foreground">Bloqueios e remanejamentos no mesmo grid</p>
            </div>
            <div className="hero-stat-card">
              <p className="executive-label">Financeiro</p>
              <p className="mt-2 text-lg font-semibold text-foreground">Indicadores e margem visiveis logo no primeiro acesso</p>
            </div>
            <div className="hero-stat-card">
              <p className="executive-label">WhatsApp</p>
              <p className="mt-2 text-lg font-semibold text-foreground">Fluxo de agendamento alinhado com a operacao real</p>
            </div>
          </div>
        </section>

        <section className="premium-block p-6 sm:p-8">
          <div className="surface-chip">
            <LockKeyhole className="h-3.5 w-3.5" />
            Acesso seguro
          </div>

          {isAuthenticated ? (
            <div className="mt-6 space-y-4">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {userName ? `Bem-vindo de volta, ${userName}.` : 'Sessao ativa.'}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Sua sessao ja esta autenticada. Quando quiser, voce pode voltar direto para o painel.
              </p>
              <Link href={AUTHENTICATED_HOME_PATH} className="action-button-primary mt-2 w-full justify-center">
                Ir para o dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  Entrar na plataforma
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Use seu email e senha para acessar o painel da barbearia.
                </p>
              </div>

              {errorMessage && (
              <div className="rounded-[1rem] border border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.12)] px-4 py-3 text-sm font-medium text-rose-200">
                {errorMessage}
              </div>
              )}

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="auth-input rounded-[1rem] px-3.5 py-3 text-sm"
                  placeholder="voce@barbearia.com"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Senha</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="auth-input rounded-[1rem] px-3.5 py-3 text-sm"
                  placeholder="Sua senha"
                  required
                />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="action-button-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Entrar
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
