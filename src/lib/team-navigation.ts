import type { AppRole } from '@/lib/auth-routes'

interface TeamTab {
  href: string
  label: string
  helper: string
}

const DEFAULT_TEAM_TABS: TeamTab[] = [
  {
    href: '/equipe',
    label: 'Visão geral',
    helper: 'Resumo do time, metas e atalhos de navegação.',
  },
  {
    href: '/equipe/profissionais',
    label: 'Profissionais',
    helper: 'Ranking, ticket e gestão individual da equipe.',
  },
  {
    href: '/equipe/metas',
    label: 'Metas',
    helper: 'Meta da barbearia e metas individuais do mês.',
  },
  {
    href: '/equipe/desempenho',
    label: 'Desempenho',
    helper: 'Leitura consolidada da operação do time.',
  },
]

const BARBER_TEAM_TABS: TeamTab[] = [
  {
    href: '/equipe/metas',
    label: 'Minhas metas',
    helper: 'Seu objetivo individual e a leitura do período.',
  },
  {
    href: '/equipe/desempenho',
    label: 'Meu desempenho',
    helper: 'Seu ritmo, ticket, comissão e resultados.',
  },
]

export function getTeamSectionTabs(role?: AppRole | string | null) {
  return role === 'BARBER' ? BARBER_TEAM_TABS : DEFAULT_TEAM_TABS
}
