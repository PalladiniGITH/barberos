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
  if (pathname === '/dashboard') {
    if (role === 'BARBER') {
      return {
        breadcrumb: 'Meu painel',
        title: 'Minha operacao',
        helper: 'Agenda, meta, desempenho e leitura individual do seu periodo.',
      }
    }

    return {
      breadcrumb: 'Visao geral',
      title: 'Painel executivo',
      helper: 'Leitura executiva da operacao com mais contraste, mais ritmo e menos ruido.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/agendamentos')) {
    return {
      breadcrumb: 'Minha agenda',
      title: 'Agenda pessoal',
      helper: 'Seus horarios, encaixes e atendimentos do dia sem ruido administrativo.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/equipe/metas')) {
    return {
      breadcrumb: 'Minhas metas',
      title: 'Meta individual',
      helper: 'Seu objetivo do periodo, progresso atual e o que falta para fechar bem o mes.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/equipe/desempenho')) {
    return {
      breadcrumb: 'Meu desempenho',
      title: 'Resultado pessoal',
      helper: 'Ticket, comissao, produtos e leitura direta do seu desempenho.',
    }
  }

  if (role === 'BARBER' && pathname.startsWith('/configuracoes')) {
    return {
      breadcrumb: 'Minha conta',
      title: 'Perfil e acesso',
      helper: 'Seus dados de acesso e o vinculo profissional usado na operacao.',
    }
  }

  if (pathname.startsWith('/inteligencia')) {
    return {
      breadcrumb: 'Inteligencia',
      title: 'Leitura estrategica',
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
      helper: 'Historico, recorrencia e valor com leitura mais organizada.',
    }
  }

  if (pathname.startsWith('/financeiro')) {
    return {
      breadcrumb: 'Financeiro',
      title: 'Saude financeira',
      helper: 'Receitas, despesas e caixa com menos ruido visual.',
    }
  }

  if (pathname.startsWith('/equipe')) {
    return {
      breadcrumb: 'Equipe',
      title: 'Leitura da equipe',
      helper: 'Metas, desempenho e operacao do time.',
    }
  }

  if (pathname.startsWith('/precificacao')) {
    return {
      breadcrumb: 'Precificacao',
      title: 'Margem e catalogo',
      helper: 'Preco, custo e rentabilidade do que a casa vende.',
    }
  }

  if (pathname.startsWith('/configuracoes')) {
    return {
      breadcrumb: 'Configuracoes',
      title: 'Conta e operacao',
      helper: 'Ajustes da barbearia, acessos e estrutura.',
    }
  }

  return {
    breadcrumb: PRODUCT_NAME,
    title: 'Operacao',
    helper: 'Acompanhe a barbearia em um painel mais claro e confiavel.',
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
    <header className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(21,24,33,0.88)] px-4 py-2.5 backdrop-blur-xl sm:px-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex items-start gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground"
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
          <div className="hidden min-w-[190px] items-center gap-2 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm xl:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-[0.8rem] bg-[rgba(124,58,237,0.16)] text-primary">
              <Clock3 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {pathname.startsWith('/agendamentos') ? 'Janela' : 'Periodo'}
              </p>
              <p className="truncate text-sm font-medium text-foreground">{periodLabel}</p>
            </div>
          </div>

          <AccountMenu
            user={{
              name: sessionUser.name,
              email: sessionUser.email,
              role: sessionUser.role,
              barbershopName: sessionUser.barbershopName,
            }}
          />
        </div>
      </div>
    </header>
  )
}
