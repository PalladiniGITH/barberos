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
    helper: 'Receita, lucro e meta claros em segundos.',
    icon: TrendingUp,
  },
  {
    label: 'Inteligencia',
    value: 'Analise automatica',
    helper: 'Prioridades e gargalos do mes sem planilha.',
    icon: BrainCircuit,
  },
  {
    label: 'Confianca',
    value: 'Base segura',
    helper: 'Tenant isolado e operacao centralizada.',
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
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-7xl overflow-hidden rounded-[2.35rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(15,23,42,0.36)] shadow-[0_36px_90px_-58px_rgba(2,6,23,0.86)] backdrop-blur-xl lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,540px)]">
        <section className="auth-dark-panel hidden p-8 lg:flex lg:flex-col lg:justify-between xl:p-10">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.06)] text-emerald-300">
                <Scissors className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white">BarberOS</p>
                <p className="text-xs text-slate-400">Gestao premium para barbearias</p>
              </div>
            </div>

            <div className="mt-12 max-w-2xl">
              <p className="spotlight-kicker">Painel comercial da operacao</p>
              <h1 className="mt-4 text-5xl font-semibold leading-[1.02] text-white">
                Um sistema que parece ferramenta de gestao, nao planilha bonita.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-slate-300">
                Controle financeiro, time, margem e inteligencia do negocio em uma experiencia clara,
                sofisticada e pronta para decidir rapido.
              </p>
            </div>

            <div className="mt-10 grid gap-4 xl:grid-cols-3">
              {highlights.map((item) => (
                <div key={item.label} className="auth-stat">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                      {item.label}
                    </p>
                    <item.icon className="h-4 w-4 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-lg font-semibold text-white">{item.value}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{item.helper}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between rounded-[1.6rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Experiencia de entrada
              </p>
              <p className="mt-2 text-sm text-slate-300">
                A mesma linguagem premium do produto inteiro, desde o primeiro acesso.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[rgba(255,255,255,0.06)] px-3 py-2 text-sm font-semibold text-white">
              Entrar
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-8 lg:px-10 xl:px-12">
          <div className="w-full max-w-md">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.92))] text-slate-100 shadow-[0_18px_34px_-22px_rgba(15,23,42,0.68)]">
                <Scissors className="h-5 w-5" />
              </span>
              <div>
                <p className="text-lg font-semibold text-foreground">BarberOS</p>
                <p className="text-sm text-muted-foreground">Gestao premium para barbearias</p>
              </div>
            </div>

            <div className="auth-panel p-6 sm:p-7">
              <p className="page-kicker">Acesso da operacao</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                Entre para ver o mes com clareza
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Use uma conta demo para navegar pelo produto completo com financeiro, equipe,
                precificacao e inteligencia do negocio.
              </p>

              <div className="mt-6">
                <LoginForm />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
