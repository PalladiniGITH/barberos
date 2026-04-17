import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ArrowUpRight, BrainCircuit, Scissors, ShieldCheck, TrendingUp } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { LoginForm } from '@/components/auth/login-form'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Entrar' }

const highlights = [
  {
    label: 'Faturamento',
    value: 'Leitura executiva',
    helper: 'Receita, lucro e meta organizados para decidir rapido.',
    icon: TrendingUp,
  },
  {
    label: 'Inteligencia',
    value: 'Analise automatica',
    helper: 'Prioridades e gargalos do mes sem depender de planilha.',
    icon: BrainCircuit,
  },
  {
    label: 'Confianca',
    value: 'Operacao segura',
    helper: 'Tenant isolado e contexto da barbearia preservado.',
    icon: ShieldCheck,
  },
] as const

export default async function LoginPage() {
  const session = await getSession()

  if (session?.user?.barbershopId) {
    const barbershop = await prisma.barbershop.findUnique({
      where: { id: session.user.barbershopId },
      select: { onboardingCompletedAt: true },
    })

    redirect(barbershop?.onboardingCompletedAt ? '/dashboard' : '/onboarding')
  }

  return (
    <div className="auth-shell min-h-screen px-5 py-5 sm:px-7 sm:py-7">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-7xl overflow-hidden rounded-[2.35rem] border border-[rgba(58,47,86,0.08)] bg-[rgba(255,255,255,0.52)] shadow-[0_40px_110px_-56px_rgba(22,16,39,0.26)] backdrop-blur-xl lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,540px)]">
        <section className="hidden border-r border-[rgba(58,47,86,0.08)] bg-[linear-gradient(180deg,rgba(244,241,249,0.98),rgba(239,236,245,0.96))] p-8 lg:flex lg:flex-col lg:justify-between xl:p-10">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-[rgba(91,33,182,0.08)] bg-white px-4 py-2 shadow-[0_18px_34px_-24px_rgba(22,16,39,0.12)]">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#4c1d95,#6d28d9)] text-white shadow-[0_14px_24px_-18px_rgba(91,33,182,0.42)]">
                <Scissors className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">BarberOS</p>
                <p className="text-xs text-muted-foreground">Gestao premium para barbearias</p>
              </div>
            </div>

            <div className="mt-12 max-w-2xl">
              <p className="page-kicker">Software operacional para barbearia premium</p>
              <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-tight text-foreground">
                Clareza de operacao, financeiro e agenda em uma interface de verdade.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-muted-foreground">
                Um produto mais refinado para recepcao, time e gestao enxergarem o negocio com contraste, contexto e seguranca.
              </p>
            </div>

            <div className="mt-10 grid gap-4 xl:grid-cols-3">
              {highlights.map((item) => (
                <div key={item.label} className="auth-stat">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      {item.label}
                    </p>
                    <item.icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="mt-3 text-lg font-semibold text-foreground">{item.value}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.helper}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 rounded-[1.6rem] border border-[rgba(58,47,86,0.08)] bg-white/78 px-5 py-4 shadow-[0_18px_36px_-28px_rgba(22,16,39,0.12)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="page-kicker">Experiencia de entrada</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  A mesma linguagem do produto inteiro desde o primeiro acesso: mais legivel, mais firme e menos lavada.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(91,33,182,0.1)] bg-[rgba(91,33,182,0.06)] px-3 py-2 text-sm font-semibold text-primary">
                Entrar
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-8 lg:px-10 xl:px-12">
          <div className="w-full max-w-md">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#4c1d95,#6d28d9)] text-white shadow-[0_18px_34px_-22px_rgba(91,33,182,0.42)]">
                <Scissors className="h-5 w-5" />
              </span>
              <div>
                <p className="text-lg font-semibold text-foreground">BarberOS</p>
                <p className="text-sm text-muted-foreground">Gestao premium para barbearias</p>
              </div>
            </div>

            <div className="auth-panel p-7 sm:p-8">
              <p className="page-kicker">Acesso da operacao</p>
              <h2 className="mt-3 text-[2rem] font-semibold tracking-tight text-foreground">
                Entre no painel com leitura forte e clara
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Use uma conta demo para navegar pelo produto com agenda, financeiro, equipe, inteligencia e operacao do dia.
              </p>

              <div className="mt-7">
                <LoginForm />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
