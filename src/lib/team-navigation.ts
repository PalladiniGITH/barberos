import type { AppRole } from '@/lib/auth-routes'

interface TeamTab {
  href: string
  label: string
  helper: string
}

const DEFAULT_TEAM_TABS: TeamTab[] = [
  {
    href: '/equipe',
    label: 'Visao geral',
    helper: 'Resumo do time, metas e atalhos de navegacao.',
  },
  {
    href: '/equipe/profissionais',
    label: 'Profissionais',
    helper: 'Ranking, ticket e gestao individual da equipe.',
  },
  {
    href: '/equipe/metas',
    label: 'Metas',
    helper: 'Meta da barbearia e metas individuais do mes.',
  },
  {
    href: '/equipe/desempenho',
    label: 'Desempenho',
    helper: 'Leitura consolidada da operacao do time.',
  },
]

const BARBER_TEAM_TABS: TeamTab[] = [
  {
    href: '/equipe/metas',
    label: 'Minhas metas',
    helper: 'Seu objetivo individual e a leitura do periodo.',
  },
  {
    href: '/equipe/desempenho',
    label: 'Meu desempenho',
    helper: 'Seu ritmo, ticket, comissao e resultados.',
  },
]

export function getTeamSectionTabs(role?: AppRole | string | null) {
  return role === 'BARBER' ? BARBER_TEAM_TABS : DEFAULT_TEAM_TABS
}
