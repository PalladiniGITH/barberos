'use client'

import { memo, useCallback, useEffect, useMemo, useState, type ComponentType, type FocusEvent, type ReactNode } from 'react'
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
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { hasPlatformAccess, isBarberRole } from '@/lib/auth-routes'
import { cn } from '@/lib/utils'
import { BarberExLogo } from '@/components/brand/barberex-logo'
import { useNavigationFeedback } from '@/components/layout/navigation-feedback'

type NavSection = 'plataforma' | 'essencial' | 'modulos' | 'conta'

type SidebarItem = {
  href: string
  icon: ComponentType<{ className?: string }>
  label: string
  description: string
  section: NavSection
  exact?: boolean
  children?: SidebarItem[]
}

const defaultSidebarItems: SidebarItem[] = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Painel',
    description: 'Visão geral do negócio.',
    section: 'essencial',
    exact: true,
  },
  {
    href: '/agendamentos',
    icon: CalendarClock,
    label: 'Agenda',
    description: 'Operação do dia e da equipe.',
    section: 'essencial',
  },
  {
    href: '/clientes',
    icon: UserRound,
    label: 'Clientes',
    description: 'Histórico, recorrência e valor.',
    section: 'essencial',
  },
  {
    href: '/inteligencia',
    icon: BrainCircuit,
    label: 'Inteligência',
    description: 'Leitura automática e insights.',
    section: 'essencial',
  },
  {
    href: '/indicadores',
    icon: BarChart3,
    label: 'Indicadores',
    description: 'Margem, tendência e saúde.',
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
        label: 'Visão geral',
        description: 'Resumo financeiro.',
        section: 'modulos',
        exact: true,
      },
      {
        href: '/financeiro/receitas',
        icon: TrendingUp,
        label: 'Receitas',
        description: 'Entradas do período.',
        section: 'modulos',
      },
      {
        href: '/financeiro/despesas',
        icon: TrendingDown,
        label: 'Despesas',
        description: 'Saídas e custos.',
        section: 'modulos',
      },
      {
        href: '/financeiro/categorias',
        icon: BarChart3,
        label: 'Categorias',
        description: 'Organização financeira.',
        section: 'modulos',
      },
      {
        href: '/financeiro/fluxo-caixa',
        icon: BarChart3,
        label: 'Fluxo de caixa',
        description: 'Previsão e tendência.',
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
        label: 'Visão geral',
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
        description: 'Ações de incentivo.',
        section: 'modulos',
      },
    ],
  },
  {
    href: '/precificacao',
    icon: Scissors,
    label: 'Precificação',
    description: 'Catálogo, custo e margem.',
    section: 'modulos',
    children: [
      {
        href: '/precificacao',
        icon: Wallet,
        label: 'Visão geral',
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
        label: 'Serviços',
        description: 'Preço e margem.',
        section: 'modulos',
      },
      {
        href: '/precificacao/insumos',
        icon: Zap,
        label: 'Insumos',
        description: 'Custos e reposição.',
        section: 'modulos',
      },
    ],
  },
  {
    href: '/configuracoes',
    icon: Settings,
    label: 'Configurações',
    description: 'Conta, acessos e operação.',
    section: 'conta',
  },
]

const barberSidebarItems: SidebarItem[] = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Minha operação',
    description: 'Resumo pessoal do seu dia e do período.',
    section: 'essencial',
    exact: true,
  },
  {
    href: '/agendamentos',
    icon: CalendarClock,
    label: 'Minha agenda',
    description: 'Seus horários, encaixes e atendimentos.',
    section: 'essencial',
  },
  {
    href: '/equipe/metas',
    icon: Target,
    label: 'Minhas metas',
    description: 'Objetivo individual e leitura do período.',
    section: 'essencial',
  },
  {
    href: '/equipe/desempenho',
    icon: BarChart3,
    label: 'Meu desempenho',
    description: 'Ticket, comissão e ritmo do seu resultado.',
    section: 'essencial',
  },
  {
    href: '/configuracoes',
    icon: Settings,
    label: 'Minha conta',
    description: 'Perfil, configurações pessoais e vínculo profissional.',
    section: 'conta',
  },
]

const sectionLabels: Record<NavSection, string> = {
  plataforma: 'BarberEX',
  essencial: 'Essencial',
  modulos: 'Módulos',
  conta: 'Conta',
}

const barberSectionLabels: Record<NavSection, string> = {
  plataforma: 'BarberEX',
  essencial: 'Minha operação',
  modulos: 'Módulos',
  conta: 'Conta',
}

const platformSidebarItem: SidebarItem = {
  href: '/internal',
  icon: ShieldCheck,
  label: 'BarberEX Admin',
  description: 'Tenants, IA, custos e saúde operacional da plataforma.',
  section: 'plataforma',
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

const SidebarLink = memo(function SidebarLink({
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
  const isTopLevel = level === 0
  const compact = !expanded
  const iconSizeClass = compact
    ? 'h-10 w-10 rounded-[0.95rem]'
    : level === 0
      ? 'h-10 w-10 rounded-[1rem]'
      : 'h-[2.3rem] w-[2.3rem] rounded-[0.9rem]'

  return (
    <div
      className={cn('min-w-0', isTopLevel ? 'space-y-1.5' : '')}
      onMouseEnter={() => {
        if (isTopLevel && expanded) {
          onPreview(item.children ? item.href : null)
        }
      }}
      onMouseLeave={() => {
        if (isTopLevel && expanded) {
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
          'group relative isolate flex min-w-0 items-center gap-3 border transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 ease-out',
          compact
            ? 'mx-auto h-[3.35rem] w-[3.35rem] justify-center rounded-[1rem] border-transparent bg-transparent p-0 shadow-none overflow-visible'
            : 'min-h-[3.55rem] w-full rounded-[1.1rem] px-2.5 py-2.5 overflow-hidden',
          level === 1 && !compact ? 'ml-4 min-h-[3.15rem] rounded-[1rem] pr-2' : '',
          !compact && active
            ? 'border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] text-white shadow-[0_20px_34px_-30px_rgba(2,6,23,0.74)]'
            : !compact
              ? 'border-transparent text-slate-400 hover:border-[rgba(255,255,255,0.045)] hover:bg-[rgba(255,255,255,0.03)] hover:text-slate-100'
              : 'text-slate-400 hover:text-slate-100',
          loading ? 'bg-[rgba(255,255,255,0.06)] text-slate-100' : ''
        )}
      >
        {active && expanded && isTopLevel && (
          <span className="absolute left-1.5 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,rgba(124,58,237,0.9),rgba(91,33,182,0.46))] shadow-[0_0_14px_rgba(91,33,182,0.22)]" />
        )}
        {active && !compact && (
          <span
            className={cn(
              'absolute inset-[1px] border border-[rgba(255,255,255,0.04)]',
              level === 1 ? 'rounded-[calc(1rem-1px)]' : 'rounded-[calc(1.1rem-1px)]'
            )}
          />
        )}
        <span
          className={cn(
            'relative z-10 flex flex-shrink-0 items-center justify-center border transition-[border-color,background-color,color,box-shadow,opacity,transform] duration-150 ease-out',
            iconSizeClass,
            active
              ? cn(
                  'border-[rgba(124,58,237,0.14)] bg-[linear-gradient(135deg,rgba(124,58,237,0.14),rgba(15,23,42,0.92))] text-violet-100 shadow-[0_16px_24px_-22px_rgba(91,33,182,0.3)]',
                  compact ? 'shadow-[0_16px_28px_-22px_rgba(91,33,182,0.42)]' : ''
                )
              : 'border-[rgba(255,255,255,0.045)] bg-[rgba(255,255,255,0.025)] text-slate-400 group-hover:border-[rgba(255,255,255,0.06)] group-hover:bg-[rgba(255,255,255,0.04)] group-hover:text-slate-100',
            loading ? 'scale-[0.97] opacity-80' : ''
          )}
        >
          <span
            className={cn(
              'absolute inset-[1px] transition-opacity duration-150 ease-out',
              compact
                ? 'rounded-[calc(0.95rem-1px)]'
                : level === 0
                  ? 'rounded-[calc(1rem-1px)]'
                  : 'rounded-[calc(0.9rem-1px)]',
              active
                ? 'opacity-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                : 'opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] group-hover:opacity-100'
            )}
          />
          <item.icon
            className={cn(
              'relative transition-transform duration-150 ease-out',
              compact ? 'h-[1.02rem] w-[1.02rem]' : level === 0 ? 'h-[1.02rem] w-[1.02rem]' : 'h-[0.95rem] w-[0.95rem]',
              loading ? 'scale-95' : ''
            )}
          />
        </span>

        <div
          className={cn(
            'min-w-0 flex-1 transition-[opacity,transform,max-width] duration-150 ease-out',
            compact ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-full translate-x-0 opacity-100'
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={cn('truncate font-medium leading-none', level === 0 ? 'text-sm' : 'text-[13px]')}>
                {item.label}
              </p>
              {level === 0 && (
                <p className="mt-1.5 truncate text-xs leading-none text-slate-500 transition-colors duration-200 group-hover:text-slate-400">
                  {item.description}
                </p>
              )}
            </div>

            {item.children && (
              <ChevronRight
                className={cn(
                  'h-4 w-4 flex-shrink-0 text-slate-500 transition-transform duration-150 ease-out',
                  childrenVisible ? 'rotate-90 text-slate-300' : ''
                )}
              />
            )}
          </div>
        </div>
      </Link>

      {item.children && expanded && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity,transform] duration-150 ease-out',
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
})

export function Sidebar({
  fallbackPath,
  pinned,
  focusMode,
  role,
  platformRole,
  homeHref = '/dashboard',
  onPinnedChange,
}: {
  fallbackPath: string
  pinned: boolean
  focusMode: boolean
  role?: string | null
  platformRole?: string | null
  homeHref?: string
  onPinnedChange: (value: boolean) => void
}) {
  const pathname = usePathname() ?? fallbackPath
  const { startNavigation, targetHref } = useNavigationFeedback()
  const [hovered, setHovered] = useState(false)
  const [previewModuleHref, setPreviewModuleHref] = useState<string | null>(null)
  const barberView = isBarberRole(role)
  const sidebarItems = useMemo(() => {
    const baseItems = barberView ? barberSidebarItems : defaultSidebarItems
    return hasPlatformAccess(platformRole) ? [platformSidebarItem, ...baseItems] : baseItems
  }, [barberView, platformRole])
  const currentSectionLabels = barberView ? barberSectionLabels : sectionLabels
  const expanded = pinned || hovered
  const activeTopLevelHref = useMemo(() => resolveActiveHref(sidebarItems, pathname), [pathname, sidebarItems])
  const openModuleHref = expanded ? previewModuleHref ?? activeTopLevelHref : null

  const handlePreview = useCallback((href: string | null) => {
    setPreviewModuleHref((current) => current === href ? current : href)
  }, [])

  const handleNavigate = useCallback((href: string) => {
    startNavigation(href)
  }, [startNavigation])

  const handleMouseEnter = useCallback(() => {
    setHovered((current) => current ? current : true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHovered((current) => current ? false : current)
    setPreviewModuleHref(null)
  }, [])

  const handleFocusCapture = useCallback(() => {
    setHovered((current) => current ? current : true)
  }, [])

  const handleBlurCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setHovered(false)
      setPreviewModuleHref(null)
    }
  }, [])

  useEffect(() => {
    setPreviewModuleHref(null)
  }, [pathname])

  const sections = useMemo(
    () =>
      (Object.keys(currentSectionLabels) as NavSection[]).map((section) => ({
        section,
        label: currentSectionLabels[section],
        items: sidebarItems.filter((item) => item.section === section),
      })).filter((section) => section.items.length > 0),
    [currentSectionLabels, sidebarItems]
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
          onNavigate={handleNavigate}
          onPreview={handlePreview}
        >
          {item.children ? renderItems(item.children, level + 1) : null}
        </SidebarLink>
      )
    })
  }

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'hidden h-full overflow-hidden border-r border-[rgba(255,255,255,0.04)] bg-[linear-gradient(180deg,rgba(13,16,24,0.97),rgba(12,14,20,0.96))] text-slate-100 shadow-[18px_0_40px_-34px_rgba(2,6,23,0.88)] transition-[width] duration-200 ease-out lg:flex',
        expanded ? 'w-[312px]' : 'w-[96px]',
        focusMode && !expanded ? 'opacity-95' : ''
      )}
      style={{ willChange: 'width' }}
    >
      <div className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col py-4', expanded ? 'px-3' : 'px-2')}>
        <div className={cn('flex min-h-[56px] rounded-[1rem]', expanded ? 'items-start overflow-hidden px-2.5 py-1.5' : 'items-center justify-center overflow-visible px-0')}>
          <Link
            href={homeHref}
            onClick={() => startNavigation(homeHref)}
            aria-label={homeHref === '/internal' ? 'Painel master da plataforma' : barberView ? 'Meu painel' : 'Painel do negócio'}
            title={homeHref === '/internal' ? 'Painel master da plataforma' : barberView ? 'Meu painel' : 'Painel do negócio'}
            className={cn(
              'group flex min-w-0 flex-shrink-0 transition-opacity duration-150 hover:opacity-95',
              expanded
                ? 'w-full flex-col items-start gap-2'
                : 'h-11 w-11 items-center justify-center rounded-[0.95rem] border border-[rgba(124,58,237,0.22)] bg-[radial-gradient(circle_at_30%_20%,rgba(168,85,247,0.24),transparent_42%),linear-gradient(135deg,rgba(124,58,237,0.22),rgba(15,23,42,0.96))] shadow-[0_18px_34px_-24px_rgba(2,6,23,0.76)]'
            )}
          >
            {expanded ? (
              <>
                <BarberExLogo
                  variant="full"
                  tone="white"
                  className="w-[152px] max-w-full"
                  sizes="152px"
                  alt="BarberEX"
                  priority
                  fetchPriority="high"
                />
                <p className="truncate text-xs text-slate-500">
                  {barberView ? 'Painel do profissional' : 'Gestão premium da barbearia'}
                </p>
              </>
            ) : (
              <BarberExLogo
                variant="symbol"
                tone="white"
                className="w-[1.45rem]"
                sizes="24px"
                alt=""
                aria-hidden
                priority
                fetchPriority="high"
              />
            )}
          </Link>
        </div>

        <div className="mt-5 min-h-0 flex-1">
          <nav
            className={cn(
              'h-full overflow-y-auto overscroll-y-contain',
              expanded ? 'pr-1' : 'scrollbar-hidden pr-0'
            )}
            style={{ scrollbarGutter: expanded ? 'stable both-edges' : 'auto' }}
          >
            <div className="space-y-5 pb-4">
              {sections.map((section) => (
                <section key={section.section} className="space-y-2">
                  <div
                    className={cn(
                      'px-3 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-600 transition-[opacity,transform,height] duration-150 ease-out',
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

        <div className="mt-3 shrink-0 border-t border-[rgba(255,255,255,0.04)] pt-3">
          <button
            type="button"
            onClick={() => onPinnedChange(!pinned)}
            className={cn(
              'flex w-full items-center gap-3 rounded-[0.95rem] px-3 py-2.5 text-sm transition-colors',
              expanded ? 'justify-start' : 'justify-center px-0',
              'text-slate-400 hover:bg-[rgba(255,255,255,0.035)] hover:text-slate-100'
            )}
            title={pinned ? 'Soltar lateral' : 'Fixar lateral'}
          >
            <PanelLeft className="h-4 w-4 flex-shrink-0" />
            <span
              className={cn(
                'truncate transition-[opacity,transform,max-width] duration-150 ease-out',
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
