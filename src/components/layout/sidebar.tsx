'use client'

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  LayoutDashboard,
  PanelLeft,
  Scissors,
  Settings,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNavigationFeedback } from '@/components/layout/navigation-feedback'

type NavSection = 'essencial' | 'modulos' | 'conta'

type SidebarItem = {
  href: string
  icon: ComponentType<{ className?: string }>
  label: string
  description: string
  section: NavSection
  exact?: boolean
  children?: SidebarItem[]
}

const sidebarItems: SidebarItem[] = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Painel',
    description: 'Leitura executiva do negocio.',
    section: 'essencial',
    exact: true,
  },
  {
    href: '/agendamentos',
    icon: CalendarClock,
    label: 'Agenda',
    description: 'Operacao do dia e da equipe.',
    section: 'essencial',
  },
  {
    href: '/clientes',
    icon: UserRound,
    label: 'Clientes',
    description: 'Historico, recorrencia e valor.',
    section: 'essencial',
  },
  {
    href: '/inteligencia',
    icon: BrainCircuit,
    label: 'Inteligencia',
    description: 'Leitura automatica e insights.',
    section: 'essencial',
  },
  {
    href: '/indicadores',
    icon: BarChart3,
    label: 'Indicadores',
    description: 'Margem, tendencia e saude.',
    section: 'essencial',
  },
  {
    href: '/financeiro',
    icon: Wallet,
    label: 'Financeiro',
    description: 'Receitas, despesas e caixa.',
    section: 'modulos',
    children: [
      {
        href: '/financeiro',
        icon: Wallet,
        label: 'Visao geral',
        description: 'Resumo financeiro.',
        section: 'modulos',
        exact: true,
      },
      {
        href: '/financeiro/receitas',
        icon: TrendingUp,
        label: 'Receitas',
        description: 'Entradas do periodo.',
        section: 'modulos',
      },
      {
        href: '/financeiro/despesas',
        icon: TrendingDown,
        label: 'Despesas',
        description: 'Saidas e custos.',
        section: 'modulos',
      },
      {
        href: '/financeiro/categorias',
        icon: BarChart3,
        label: 'Categorias',
        description: 'Organizacao financeira.',
        section: 'modulos',
      },
      {
        href: '/financeiro/fluxo-caixa',
        icon: BarChart3,
        label: 'Fluxo de caixa',
        description: 'Previsao e tendencia.',
        section: 'modulos',
      },
    ],
  },
  {
    href: '/equipe',
    icon: Users,
    label: 'Equipe',
    description: 'Metas, performance e time.',
    section: 'modulos',
    children: [
      {
        href: '/equipe',
        icon: Users,
        label: 'Visao geral',
        description: 'Leitura do time.',
        section: 'modulos',
        exact: true,
      },
      {
        href: '/equipe/desempenho',
        icon: BarChart3,
        label: 'Desempenho',
        description: 'Quem puxa o resultado.',
        section: 'modulos',
      },
      {
        href: '/equipe/profissionais',
        icon: Users,
        label: 'Profissionais',
        description: 'Base operacional do time.',
        section: 'modulos',
      },
      {
        href: '/equipe/metas',
        icon: Target,
        label: 'Metas',
        description: 'Meta da casa e individual.',
        section: 'modulos',
      },
      {
        href: '/desafios',
        icon: Trophy,
        label: 'Campanhas',
        description: 'Acoes de incentivo.',
        section: 'modulos',
      },
    ],
  },
  {
    href: '/precificacao',
    icon: Scissors,
    label: 'Precificacao',
    description: 'Catalogo, custo e margem.',
    section: 'modulos',
    children: [
      {
        href: '/precificacao',
        icon: Wallet,
        label: 'Visao geral',
        description: 'Resumo da margem.',
        section: 'modulos',
        exact: true,
      },
      {
        href: '/precificacao/resultado',
        icon: BarChart3,
        label: 'Resultado',
        description: 'Leitura consolidada.',
        section: 'modulos',
      },
      {
        href: '/precificacao/servicos',
        icon: Scissors,
        label: 'Servicos',
        description: 'Preco e margem.',
        section: 'modulos',
      },
      {
        href: '/precificacao/insumos',
        icon: Zap,
        label: 'Insumos',
        description: 'Custos e reposicao.',
        section: 'modulos',
      },
    ],
  },
  {
    href: '/configuracoes',
    icon: Settings,
    label: 'Configuracoes',
    description: 'Conta, acessos e operacao.',
    section: 'conta',
  },
]

const sectionLabels: Record<NavSection, string> = {
  essencial: 'Essencial',
  modulos: 'Modulos',
  conta: 'Conta',
}

function matchesPath(item: Pick<SidebarItem, 'href' | 'exact'>, currentPath: string) {
  return item.exact
    ? currentPath === item.href
    : currentPath === item.href || currentPath.startsWith(`${item.href}/`)
}

function getSelfScore(item: Pick<SidebarItem, 'href' | 'exact'>, currentPath: string) {
  return matchesPath(item, currentPath)
    ? (item.exact ? 10_000 : 0) + item.href.length
    : -1
}

function getItemScore(item: SidebarItem, currentPath: string): number {
  const ownScore = getSelfScore(item, currentPath)
  const childScore = Math.max(
    ...((item.children ?? []).map((child) => getItemScore(child, currentPath))),
    -1
  )

  return Math.max(ownScore, childScore)
}

function isItemActive(item: SidebarItem, currentPath: string) {
  return getItemScore(item, currentPath) >= 0
}

function resolveActiveHref(items: SidebarItem[], currentPath: string) {
  const matches = items
    .map((item) => ({ href: item.href, score: getItemScore(item, currentPath) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)

  return matches[0]?.href ?? null
}

function SidebarLink({
  item,
  expanded,
  active,
  level,
  childrenVisible,
  loading,
  onNavigate,
  onPreview,
  children,
}: {
  item: SidebarItem
  expanded: boolean
  active: boolean
  level: number
  childrenVisible: boolean
  loading: boolean
  onNavigate: (href: string) => void
  onPreview: (href: string | null) => void
  children?: ReactNode
}) {
  const compact = !expanded

  return (
    <div
      className={cn('min-w-0', level === 0 ? 'space-y-1.5' : '')}
      onMouseEnter={() => {
        if (level === 0) {
          onPreview(item.children ? item.href : null)
        }
      }}
      onMouseLeave={() => {
        if (level === 0) {
          onPreview(null)
        }
      }}
    >
      <Link
        href={item.href}
        title={`${item.label}: ${item.description}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(item.href)}
        className={cn(
          'group relative flex min-w-0 items-center gap-3 transition-all duration-200',
          compact
            ? 'mx-auto h-12 w-12 justify-center rounded-2xl'
            : level === 0
              ? 'min-h-[3.75rem] rounded-[1.1rem] px-3.5 py-3'
              : 'ml-4 min-h-[3.1rem] rounded-[0.95rem] px-3 py-2',
          active
            ? 'bg-[linear-gradient(135deg,rgba(91,33,182,0.14),rgba(91,33,182,0.05))] text-[hsl(var(--foreground))] shadow-[0_14px_28px_-22px_rgba(91,33,182,0.28),inset_0_0_0_1px_rgba(91,33,182,0.1)]'
            : 'text-muted-foreground hover:bg-[rgba(91,33,182,0.045)] hover:text-foreground',
          loading ? 'opacity-80' : ''
        )}
      >
        {active && !compact && (
          <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,#7c3aed,#c084fc)]" />
        )}

        <span
          className={cn(
            'relative flex flex-shrink-0 items-center justify-center rounded-[0.95rem] border transition-colors',
            compact ? 'h-10 w-10' : level === 0 ? 'h-10 w-10' : 'h-9 w-9',
            active
              ? 'border-[rgba(91,33,182,0.1)] bg-[rgba(91,33,182,0.11)] text-primary'
              : 'border-[rgba(58,47,86,0.06)] bg-[rgba(255,255,255,0.86)] text-muted-foreground group-hover:border-[rgba(91,33,182,0.1)] group-hover:text-primary'
          )}
        >
          <item.icon className={cn(compact ? 'h-[1rem] w-[1rem]' : 'h-[1rem] w-[1rem]')} />
        </span>

        <div
          className={cn(
            'min-w-0 flex-1 transition-[opacity,transform,max-width] duration-200',
            compact ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-full translate-x-0 opacity-100'
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={cn('truncate font-semibold', level === 0 ? 'text-sm' : 'text-[13px]')}>
                {item.label}
              </p>
              {level === 0 && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>

            {item.children && (
              <ChevronRight
                className={cn(
                  'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200',
                  childrenVisible ? 'rotate-90 text-primary' : ''
                )}
              />
            )}
          </div>
        </div>
      </Link>

      {item.children && expanded && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity,transform] duration-200',
            childrenVisible ? 'grid-rows-[1fr] translate-y-0 opacity-100' : 'grid-rows-[0fr] -translate-y-1 opacity-0'
          )}
        >
          <div className="overflow-hidden">
            <div className="space-y-1.5 pt-1">{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export function Sidebar({
  fallbackPath,
  pinned,
  focusMode,
  onPinnedChange,
}: {
  fallbackPath: string
  pinned: boolean
  focusMode: boolean
  onPinnedChange: (value: boolean) => void
}) {
  const pathname = usePathname() ?? fallbackPath
  const { startNavigation, targetHref } = useNavigationFeedback()
  const [hovered, setHovered] = useState(false)
  const [previewModuleHref, setPreviewModuleHref] = useState<string | null>(null)
  const expanded = pinned || hovered
  const activeTopLevelHref = resolveActiveHref(sidebarItems, pathname)
  const openModuleHref = expanded ? previewModuleHref ?? activeTopLevelHref : null

  useEffect(() => {
    setPreviewModuleHref(null)
  }, [pathname])

  const sections = useMemo(
    () =>
      (Object.keys(sectionLabels) as NavSection[]).map((section) => ({
        section,
        label: sectionLabels[section],
        items: sidebarItems.filter((item) => item.section === section),
      })),
    []
  )

  function renderItems(items: SidebarItem[], level = 0): ReactNode {
    return items.map((item) => {
      const active = level === 0 ? activeTopLevelHref === item.href : isItemActive(item, pathname)
      const childrenVisible = Boolean(item.children && openModuleHref === item.href)

      return (
        <SidebarLink
          key={item.href}
          item={item}
          expanded={expanded}
          active={active}
          level={level}
          childrenVisible={childrenVisible}
          loading={targetHref === item.href}
          onNavigate={startNavigation}
          onPreview={setPreviewModuleHref}
        >
          {item.children ? renderItems(item.children, level + 1) : null}
        </SidebarLink>
      )
    })
  }

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHovered(false)
          setPreviewModuleHref(null)
        }
      }}
      onMouseLeave={() => {
        setHovered(false)
        setPreviewModuleHref(null)
      }}
      className={cn(
        'hidden min-h-screen shrink-0 border-r border-[rgba(58,47,86,0.08)] bg-[linear-gradient(180deg,rgba(249,248,252,0.98),rgba(243,241,247,0.98))] transition-[width] duration-300 ease-out lg:flex',
        expanded ? 'w-[320px]' : 'w-[88px]',
        focusMode && !expanded ? 'opacity-95' : ''
      )}
    >
      <div className="flex h-full min-w-0 flex-1 flex-col px-3 py-4">
        <div className="overflow-hidden rounded-[1.6rem] border border-[rgba(91,33,182,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,239,248,0.96))] p-3.5 shadow-[0_24px_50px_-38px_rgba(24,18,41,0.16)]">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              onClick={() => startNavigation('/dashboard')}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[1rem] bg-[linear-gradient(135deg,#4c1d95,#6d28d9)] text-white shadow-[0_16px_32px_-20px_rgba(91,33,182,0.48)]"
              title="Painel executivo"
            >
              <Scissors className="h-4 w-4" />
            </Link>

            <div
              className={cn(
                'min-w-0 transition-[opacity,transform,max-width] duration-200',
                expanded ? 'max-w-full translate-x-0 opacity-100' : 'max-w-0 -translate-x-2 opacity-0'
              )}
            >
              <p className="truncate text-sm font-semibold text-foreground">BarberOS</p>
              <p className="truncate text-xs text-muted-foreground">SaaS operacional para barbearias premium</p>
            </div>
          </div>

          {expanded && (
            <div className="mt-3 rounded-[1.1rem] border border-[rgba(91,33,182,0.08)] bg-[linear-gradient(180deg,rgba(248,246,252,0.98),rgba(255,255,255,0.94))] px-3 py-3 text-xs leading-5 text-muted-foreground">
              Produto operacional para recepcao, agenda, time e resultado em um unico fluxo.
            </div>
          )}
        </div>

        <div className="mt-5 min-h-0 flex-1">
          <nav className="h-full overflow-y-auto overscroll-y-contain pr-1" style={{ scrollbarGutter: 'stable both-edges' }}>
            <div className="space-y-5 pb-4">
              {sections.map((section) => (
                <section
                  key={section.section}
                  className={cn(
                    'space-y-2',
                    expanded && 'rounded-[1.3rem] border border-[rgba(58,47,86,0.06)] bg-[rgba(255,255,255,0.62)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]'
                  )}
                >
                  <div
                    className={cn(
                      'px-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground transition-[opacity,transform,height] duration-200',
                      expanded ? 'h-auto translate-x-0 opacity-100' : 'h-0 -translate-x-2 overflow-hidden opacity-0'
                    )}
                  >
                    {section.label}
                  </div>
                  <div className="space-y-1.5">{renderItems(section.items)}</div>
                </section>
              ))}
            </div>
          </nav>
        </div>

        <div className="mt-3 shrink-0 border-t border-[rgba(58,47,86,0.08)] pt-3">
          <button
            type="button"
            onClick={() => onPinnedChange(!pinned)}
            className={cn(
              'flex w-full items-center gap-3 rounded-[1rem] px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-[rgba(91,33,182,0.05)] hover:text-foreground',
              expanded ? 'justify-start' : 'justify-center px-0'
            )}
            title={pinned ? 'Soltar lateral' : 'Fixar lateral'}
          >
            <PanelLeft className="h-4 w-4 flex-shrink-0" />
            <span
              className={cn(
                'truncate transition-[opacity,transform,max-width] duration-200',
                expanded ? 'max-w-full translate-x-0 opacity-100' : 'max-w-0 -translate-x-2 opacity-0'
              )}
            >
              {pinned ? 'Sidebar fixa' : 'Fixar sidebar'}
            </span>
          </button>
        </div>
      </div>
    </aside>
  )
}
