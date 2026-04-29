'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { AUTHENTICATED_HOME_PATH } from '@/lib/auth-routes'
import { PRODUCT_POSITIONING } from '@/lib/branding'
import { BarberExLogo } from '@/components/brand/barberex-logo'

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
    return 'Email ou senha inválidos.'
  }

  return 'Não foi possível entrar agora. Tente novamente.'
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
    <main className="auth-shell min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1120px] items-center gap-4 lg:grid-cols-[minmax(0,0.96fr)_400px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="dashboard-spotlight relative overflow-hidden p-6 sm:p-7 lg:p-8">
          <div className="max-w-2xl">
            <div className="max-w-[17.5rem] sm:max-w-[19.5rem]">
              <BarberExLogo
                variant="full"
                tone="white"
                className="w-[220px] sm:w-[248px] lg:w-[268px]"
                sizes="(max-width: 640px) 220px, (max-width: 1024px) 248px, 268px"
                priority
                fetchPriority="high"
              />
            </div>

            <div className="mt-6 max-w-xl">
              <p className="text-[1.95rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.2rem] lg:text-[2.45rem] lg:leading-[1.03]">
                Agenda, clientes, financeiro e IA na mesma superficie de trabalho.
              </p>
              <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">
                {PRODUCT_POSITIONING} Entre para acompanhar recepcao, equipe, margem e relacionamento sem quebrar o ritmo da operacao.
              </p>
            </div>

            <div className="mt-6 max-w-xl rounded-[1.05rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-4">
              <ul className="space-y-3 text-sm leading-6 text-slate-200">
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-violet-300" />
                  <span>Agenda, clientes e financeiro conectados em uma leitura operacional unica.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-violet-300" />
                  <span>WhatsApp com IA integrado ao fluxo real de atendimento da equipe.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-violet-300" />
                  <span>Indicadores, metas e margem em uma camada clara para decidir rapido.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="auth-panel w-full self-center p-6 sm:p-7 lg:justify-self-end">
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
