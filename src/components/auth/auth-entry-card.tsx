'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { AUTHENTICATED_HOME_PATH } from '@/lib/auth-routes'
import { PRODUCT_POSITIONING } from '@/lib/branding'

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
    <main className="auth-shell min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-5xl items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center xl:grid-cols-[minmax(0,1.08fr)_420px]">
        <section className="dashboard-spotlight relative overflow-hidden p-7 sm:p-8 lg:p-9">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[1.05rem] border border-[rgba(124,92,255,0.16)] bg-[linear-gradient(180deg,rgba(124,92,255,0.18),rgba(62,44,112,0.14))] text-sm font-semibold tracking-[0.26em] text-violet-50 shadow-[0_22px_44px_-28px_rgba(76,29,149,0.52)]">
                BX
              </div>
              <div>
                <h1 className="text-[1.35rem] font-semibold tracking-tight text-foreground">BarberEX</h1>
                <p className="mt-1 text-sm text-slate-300">Operacao premium para barbearias que rodam o dia no detalhe.</p>
              </div>
            </div>

            <div className="mt-7 max-w-2xl">
              <p className="text-[2.2rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.65rem] lg:text-[2.95rem] lg:leading-[1.02]">
                Agenda, clientes, financeiro e IA na mesma superficie de trabalho.
              </p>
              <p className="mt-4 max-w-xl text-[15px] leading-8 text-muted-foreground">
                {PRODUCT_POSITIONING} Entre para acompanhar recepcao, equipe, margem e relacionamento sem quebrar o ritmo da operacao.
              </p>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
              <div className="hero-stat-card min-h-[148px] p-5">
                <p className="text-[1rem] font-semibold leading-7 text-foreground">
                  Fluxo real de agenda com bloqueios, remanejamentos e encaixes no mesmo grid.
                </p>
                <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">
                  A recepcao nao precisa trocar de modulo para operar o dia com seguranca.
                </p>
              </div>

              <div className="grid gap-3">
                <div className="hero-stat-card p-4">
                  <p className="executive-label">Inteligencia aplicada</p>
                  <p className="mt-3 text-sm font-semibold leading-6 text-foreground">
                    Margem, sinais de clientes e operacao visiveis no primeiro acesso.
                  </p>
                </div>

                <div className="hero-stat-card p-4">
                  <p className="executive-label">Camada de IA</p>
                  <p className="mt-3 text-sm font-semibold leading-6 text-foreground">
                    WhatsApp com IA e BarberEX IA integrados ao trabalho da equipe.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="surface-tier-low p-4">
                <p className="executive-label">Agenda operacional</p>
                <p className="mt-3 text-sm font-semibold leading-6 text-foreground">
                  Horarios, barbeiros, bloqueios e origem dos atendimentos na mesma leitura.
                </p>
              </div>
              <div className="surface-tier-low p-4">
                <p className="executive-label">BarberEX IA</p>
                <p className="mt-3 text-sm font-semibold leading-6 text-foreground">
                  Um copiloto nativo para agenda, clientes, metas e numeros da barbearia.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-panel w-full self-center p-6 sm:p-8 lg:justify-self-end">
          {isAuthenticated ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {userName ? `Bem-vindo de volta, ${userName}.` : 'Sessao ativa.'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Sua sessao ja esta autenticada. Quando quiser, voce pode voltar direto para o painel.
                </p>
              </div>
              <Link href={AUTHENTICATED_HOME_PATH} className="action-button-primary mt-2 w-full justify-center">
                Ir para o dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  Entrar na plataforma
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Use seu email e senha para acessar o painel da barbearia.
                </p>
              </div>

              {errorMessage && (
                <div className="rounded-[1rem] border border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.12)] px-4 py-3 text-sm font-medium text-rose-200">
                  {errorMessage}
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-foreground">Email</span>
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
                <span className="mb-2 block text-sm font-medium text-foreground">Senha</span>
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

              <p className="text-xs leading-6 text-muted-foreground">
                O acesso leva voce direto para <strong className="font-semibold text-foreground">/dashboard</strong> apos autenticacao valida.
              </p>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
