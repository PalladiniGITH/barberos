'use client'

import { Clock3, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { formatPeriodLabel } from '@/lib/utils'
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

function getPageMeta(pathname: string) {
  if (pathname === '/dashboard') {
    return {
      breadcrumb: 'Visao geral',
      title: 'Painel do negocio',
      helper: 'Os numeros que definem o mes e o que merece atencao agora.',
    }
  }

  if (pathname.startsWith('/inteligencia')) {
    return {
      breadcrumb: 'Inteligencia',
      title: 'Relatorio do negocio',
      helper: 'Leitura automatica do mes com foco no que agir primeiro.',
    }
  }

  if (pathname.startsWith('/indicadores')) {
    return {
      breadcrumb: 'Indicadores',
      title: 'Saude do negocio',
      helper: 'Margem, tendencia e consistencia da operacao.',
    }
  }

  if (pathname.startsWith('/agendamentos')) {
    return {
      breadcrumb: 'Agenda',
      title: 'Agendamentos',
      helper: 'A agenda do dia e da equipe, com foco em confirmacao e encaixe.',
    }
  }

  if (pathname === '/clientes') {
    return {
      breadcrumb: 'Clientes',
      title: 'Base de clientes',
      helper: 'Leitura operacional e executiva da carteira, com historico, valor e recorrencia.',
    }
  }

  if (pathname.startsWith('/clientes/')) {
    return {
      breadcrumb: 'Clientes / Perfil',
      title: 'Visao do cliente',
      helper: 'Historico, frequencia, margem estimada e comportamento recente em um unico painel.',
    }
  }

  if (pathname === '/financeiro') {
    return {
      breadcrumb: 'Financeiro',
      title: 'Visao financeira',
      helper: 'Receita, despesa, caixa e ritmo do periodo.',
    }
  }

  if (pathname.startsWith('/financeiro/receitas')) {
    return {
      breadcrumb: 'Financeiro / Receitas',
      title: 'Receitas',
      helper: 'Entradas do periodo e leitura de ticket.',
    }
  }

  if (pathname.startsWith('/financeiro/despesas')) {
    return {
      breadcrumb: 'Financeiro / Despesas',
      title: 'Despesas',
      helper: 'Custos e impactos no caixa.',
    }
  }

  if (pathname.startsWith('/financeiro/categorias')) {
    return {
      breadcrumb: 'Financeiro / Categorias',
      title: 'Categorias',
      helper: 'Organizacao do financeiro para leitura rapida.',
    }
  }

  if (pathname.startsWith('/financeiro/fluxo-caixa')) {
    return {
      breadcrumb: 'Financeiro / Fluxo de caixa',
      title: 'Fluxo de caixa',
      helper: 'Tendencia mensal e previsao simples.',
    }
  }

  if (pathname === '/equipe') {
    return {
      breadcrumb: 'Equipe',
      title: 'Visao da equipe',
      helper: 'Quem sustenta o resultado e onde acelerar.',
    }
  }

  if (pathname.startsWith('/equipe/desempenho')) {
    return {
      breadcrumb: 'Equipe / Desempenho',
      title: 'Desempenho',
      helper: 'Leitura do time por receita, meta e constancia.',
    }
  }

  if (pathname.startsWith('/equipe/profissionais')) {
    return {
      breadcrumb: 'Equipe / Profissionais',
      title: 'Profissionais',
      helper: 'Base operacional e acompanhamento individual.',
    }
  }

  if (pathname.startsWith('/equipe/metas')) {
    return {
      breadcrumb: 'Equipe / Metas',
      title: 'Metas',
      helper: 'Meta da casa e meta por profissional.',
    }
  }

  if (pathname.startsWith('/desafios')) {
    return {
      breadcrumb: 'Equipe / Campanhas',
      title: 'Campanhas',
      helper: 'Acoes de incentivo para o time.',
    }
  }

  if (pathname === '/precificacao') {
    return {
      breadcrumb: 'Precificacao',
      title: 'Visao da margem',
      helper: 'Catalogo, custo e margem com leitura comercial.',
    }
  }

  if (pathname.startsWith('/precificacao/resultado')) {
    return {
      breadcrumb: 'Precificacao / Resultado',
      title: 'Resultado da precificacao',
      helper: 'Onde a margem esta forte e onde precisa de ajuste.',
    }
  }

  if (pathname.startsWith('/precificacao/servicos')) {
    return {
      breadcrumb: 'Precificacao / Servicos',
      title: 'Servicos',
      helper: 'Preco e margem por servico.',
    }
  }

  if (pathname.startsWith('/precificacao/insumos')) {
    return {
      breadcrumb: 'Precificacao / Insumos',
      title: 'Insumos',
      helper: 'Custos, reposicao e base para precificar.',
    }
  }

  if (pathname.startsWith('/configuracoes')) {
    return {
      breadcrumb: 'Configuracoes',
      title: 'Conta e operacao',
      helper: 'Conta, acessos e estrutura da barbearia.',
    }
  }

  return {
    breadcrumb: 'BarberOS',
    title: 'Operacao',
    helper: 'Acompanhe a barbearia em um painel unico.',
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
  const pageMeta = getPageMeta(pathname)
  const periodLabel = getPeriodLabel(currentQuery, pathname)

  return (
    <header className="border-b border-[rgba(255,255,255,0.05)] bg-[rgba(10,15,28,0.82)] px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex items-start gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] text-slate-300 transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
            aria-label={sidebarPinned ? 'Soltar barra lateral' : 'Fixar barra lateral'}
          >
            {sidebarPinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>

          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
              {pageMeta.breadcrumb}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="truncate text-[1.55rem] font-semibold tracking-tight text-slate-50">
                {pageMeta.title}
              </h2>
              {sessionUser.barbershopName && (
                <span className="text-sm text-slate-500">
                  {sessionUser.barbershopName}
                </span>
              )}
            </div>
            {!focusMode && (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                {pageMeta.helper}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="hidden min-w-[170px] items-center gap-2 rounded-[1rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-slate-300 xl:flex">
            <Clock3 className="h-4 w-4 text-slate-500" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                {pathname.startsWith('/agendamentos') ? 'Janela' : 'Periodo'}
              </p>
              <p className="truncate text-sm font-medium text-slate-100">{periodLabel}</p>
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
