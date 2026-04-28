'use client'

import { Clock3, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { formatPeriodLabel } from '@/lib/utils'
import { PRODUCT_NAME } from '@/lib/branding'
import { AccountMenu } from '@/components/layout/account-menu'

export interface HeaderSessionUser {
  name?: string | null
  email?: string | null
  role?: string | null
  platformRole?: string | null
  barbershopName?: string | null
  barbershopSlug?: string | null
}

interface HeaderProps {
  currentPath: string
  currentSearch: string
  sessionUser: HeaderSessionUser
  focusMode: boolean
  sidebarPinned: boolean
  onToggleSidebar: () => void
}

function getPageMeta(pathname: string, role?: string | null) {
  if (pathname === '/internal') {
      return {
        breadcrumb: 'BarberEX Admin',
        title: 'Operação SaaS',
        helper: 'Tenants, uso de IA, WhatsApp, automações e sinais da plataforma em uma única leitura.',
      }
  }

  if (pathname.startsWith('/internal/barbershops/')) {
      return {
        breadcrumb: 'BarberEX Admin',
        title: 'Tenant em detalhe',
        helper: 'Saúde operacional, uso de IA, equipe, automações e sinais recentes dessa barbearia.',
      }
  }

  if (pathname === '/dashboard') {
    if (role === 'BARBER') {
      return {
        breadcrumb: 'Meu painel',
        title: 'Minha operação',
        helper: 'Agenda, meta, desempenho e leitura individual do seu período.',
      }
    }

    return {
      breadcrumb: 'Visão geral',
      title: 'Painel executivo',
      helper: 'Visão da operação com mais contraste, mais ritmo e menos ruído.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/agendamentos')) {
    return {
      breadcrumb: 'Minha agenda',
      title: 'Agenda pessoal',
      helper: 'Seus horários, encaixes e atendimentos do dia sem ruído administrativo.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/equipe/metas')) {
    return {
      breadcrumb: 'Minhas metas',
      title: 'Meta individual',
      helper: 'Seu objetivo do período, progresso atual e o que falta para fechar bem o mês.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/equipe/desempenho')) {
    return {
      breadcrumb: 'Meu desempenho',
      title: 'Resultado pessoal',
      helper: 'Ticket, comissão, produtos e leitura direta do seu desempenho.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/configuracoes')) {
    return {
      breadcrumb: 'Minha conta',
      title: 'Perfil e acesso',
      helper: 'Seus dados de acesso e o vínculo profissional usado na operação.',
    }
  }

  if (pathname.startsWith('/inteligencia')) {
    return {
      breadcrumb: 'Inteligência',
      title: 'Inteligência da operação',
      helper: 'Insights, contexto e sinais para agir com mais clareza.',
    }
  }

  if (pathname.startsWith('/agendamentos')) {
    return {
      breadcrumb: 'Agenda',
      title: 'Agenda operacional',
      helper: 'Grade operacional da equipe com foco em encaixe, conflitos e velocidade.',
    }
  }

  if (pathname.startsWith('/clientes')) {
    return {
      breadcrumb: 'Clientes',
      title: 'Base de clientes',
      helper: 'Histórico, recorrência e valor com leitura mais organizada.',
    }
  }

  if (pathname.startsWith('/financeiro')) {
    return {
      breadcrumb: 'Financeiro',
      title: 'Saúde financeira',
      helper: 'Receitas, despesas e caixa com menos ruído visual.',
    }
  }

  if (pathname.startsWith('/equipe')) {
    return {
      breadcrumb: 'Equipe',
      title: 'Leitura da equipe',
      helper: 'Metas, desempenho e operação do time.',
    }
  }

  if (pathname.startsWith('/precificacao')) {
    return {
      breadcrumb: 'Precificação',
      title: 'Margem e catálogo',
      helper: 'Preço, custo e rentabilidade do que a casa vende.',
    }
  }

  if (pathname.startsWith('/configuracoes')) {
    return {
      breadcrumb: 'Configurações',
      title: 'Conta e operação',
      helper: 'Ajustes da barbearia, acessos e estrutura.',
    }
  }

  return {
    breadcrumb: PRODUCT_NAME,
    title: 'Operação',
    helper: 'Acompanhe a barbearia em um painel mais claro e confiável.',
  }
}

function getPeriodLabel(currentSearch: string, currentPath: string) {
  const now = new Date()
  const query = currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch
  const searchParams = new URLSearchParams(query)

  const scheduleDate = searchParams.get('date')
  if (scheduleDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
    const baseDate = new Date(`${scheduleDate}T09:00:00`)

    if (!Number.isNaN(baseDate.getTime())) {
      return baseDate.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
      })
    }
  }

  if (currentPath.startsWith('/agendamentos')) {
    return now.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
    })
  }

  const rawMonth = Number(searchParams.get('month') ?? now.getMonth() + 1)
  const rawYear = Number(searchParams.get('year') ?? now.getFullYear())
  const month = rawMonth >= 1 && rawMonth <= 12 ? rawMonth : now.getMonth() + 1
  const year = rawYear >= 2020 && rawYear <= 2035 ? rawYear : now.getFullYear()

  return formatPeriodLabel(month, year)
}

export function Header({
  currentPath,
  currentSearch,
  sessionUser,
  focusMode,
  sidebarPinned,
  onToggleSidebar,
}: HeaderProps) {
  const pathname = usePathname() ?? currentPath
  const searchParams = useSearchParams()
  const search = searchParams?.toString()
  const currentQuery = search ? `?${search}` : currentSearch
  const pageMeta = getPageMeta(pathname, sessionUser.role)
  const periodLabel = getPeriodLabel(currentQuery, pathname)

  return (
    <header className="border-b border-[rgba(255,255,255,0.04)] bg-[rgba(17,18,23,0.84)] px-4 py-2.5 backdrop-blur-xl sm:px-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex items-start gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] text-muted-foreground transition-colors hover:border-[rgba(124,58,237,0.14)] hover:bg-[rgba(124,58,237,0.08)] hover:text-foreground"
            aria-label={sidebarPinned ? 'Soltar barra lateral' : 'Fixar barra lateral'}
          >
            {sidebarPinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {pageMeta.breadcrumb}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="truncate text-[1.65rem] font-semibold leading-tight tracking-tight text-foreground">
                {pageMeta.title}
              </h2>
              {sessionUser.barbershopName && (
                <span className="text-sm text-muted-foreground">
                  {sessionUser.barbershopName}
                </span>
              )}
            </div>
            {!focusMode && (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                {pageMeta.helper}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="hidden min-w-[190px] items-center gap-2 rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-sm xl:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-[0.8rem] border border-[rgba(124,58,237,0.12)] bg-[rgba(124,58,237,0.1)] text-primary">
              <Clock3 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {pathname.startsWith('/agendamentos') ? 'Janela' : 'Período'}
              </p>
              <p className="truncate text-sm font-medium text-foreground">{periodLabel}</p>
            </div>
          </div>

          <AccountMenu
            user={{
              name: sessionUser.name,
              email: sessionUser.email,
              role: sessionUser.role,
              platformRole: sessionUser.platformRole,
              barbershopName: sessionUser.barbershopName,
            }}
          />
        </div>
      </div>
    </header>
  )
}
