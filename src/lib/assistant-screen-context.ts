import type { AiChatRoleScope } from '@prisma/client'

export type AssistantChatScope = AiChatRoleScope

export type AssistantScreenKey =
  | 'dashboard'
  | 'agendamentos'
  | 'clientes'
  | 'financeiro'
  | 'equipe'
  | 'precificacao'
  | 'indicadores'
  | 'configuracoes'
  | 'assistente'
  | 'generic'
  | 'internal'

export interface AssistantBaseUiConfig {
  suggestions: string[]
  placeholder: string
  description: string
}

export interface AssistantScreenContext {
  key: AssistantScreenKey
  pathname: string
  visible: boolean
  label: string
  subtitle: string
  placeholder: string
  suggestions: string[]
}

const MANAGEMENT_BASE_UI: AssistantBaseUiConfig = {
  suggestions: [
    'Como posso faturar mais essa semana?',
    'Quais clientes devo reativar?',
    'Qual servico tem melhor margem?',
    'Como esta minha taxa de retorno?',
  ],
  placeholder: 'Pergunte sobre faturamento, agenda, clientes ou equipe...',
  description: 'Pergunte sobre agenda, clientes, metas, margem e prioridades da operacao.',
}

const FINANCIAL_BASE_UI: AssistantBaseUiConfig = {
  suggestions: [
    'Como esta minha margem este mes?',
    'Onde minhas despesas estao pesando mais?',
    'Qual servico sustenta melhor o lucro?',
    'Qual tendencia financeira eu preciso acompanhar?',
  ],
  placeholder: 'Pergunte sobre caixa, despesas, margem e sinais financeiros do periodo...',
  description: 'Pergunte sobre caixa, margem, despesas e sinais financeiros do periodo.',
}

const PROFESSIONAL_BASE_UI: AssistantBaseUiConfig = {
  suggestions: [
    'Como bato minha meta?',
    'O que vender nos proximos atendimentos?',
    'Como esta minha agenda amanha?',
    'Quantos atendimentos faltam para minha meta?',
  ],
  placeholder: 'Pergunte sobre sua meta, agenda, vendas ou proximos atendimentos...',
  description: 'Pergunte sobre sua agenda, sua meta e oportunidades praticas de venda.',
}

function normalizePathname(pathname?: string | null) {
  if (typeof pathname !== 'string') {
    return '/dashboard'
  }

  const trimmed = pathname.trim()
  return trimmed.startsWith('/') ? trimmed : '/dashboard'
}

function resolveScreenKey(pathname: string): AssistantScreenKey {
  if (pathname === '/internal' || pathname.startsWith('/internal/')) return 'internal'
  if (pathname === '/dashboard') return 'dashboard'
  if (pathname === '/agendamentos' || pathname.startsWith('/agendamentos/')) return 'agendamentos'
  if (pathname === '/clientes' || pathname.startsWith('/clientes/')) return 'clientes'
  if (pathname === '/financeiro' || pathname.startsWith('/financeiro/')) return 'financeiro'
  if (pathname === '/equipe' || pathname.startsWith('/equipe/')) return 'equipe'
  if (pathname === '/precificacao' || pathname.startsWith('/precificacao/')) return 'precificacao'
  if (pathname === '/indicadores' || pathname.startsWith('/indicadores/')) return 'indicadores'
  if (pathname === '/configuracoes' || pathname.startsWith('/configuracoes/')) return 'configuracoes'
  if (pathname === '/assistente' || pathname.startsWith('/assistente/')) return 'assistente'
  return 'generic'
}

export function shouldShowAssistantOnPath(pathname?: string | null) {
  const normalizedPathname = normalizePathname(pathname)
  return !(normalizedPathname === '/internal' || normalizedPathname.startsWith('/internal/'))
}

export function getAssistantBaseUiConfig(scope: AssistantChatScope): AssistantBaseUiConfig {
  if (scope === 'PROFESSIONAL') {
    return PROFESSIONAL_BASE_UI
  }

  if (scope === 'FINANCIAL') {
    return FINANCIAL_BASE_UI
  }

  return MANAGEMENT_BASE_UI
}

function buildManagementScreenContext(key: AssistantScreenKey, pathname: string): AssistantScreenContext {
  switch (key) {
    case 'dashboard':
      return {
        key,
        pathname,
        visible: true,
        label: 'Dashboard executivo',
        subtitle: 'Pergunte sobre faturamento, recorrencia, margem e prioridades da semana.',
        placeholder: 'Ex.: Como posso faturar mais esta semana?',
        suggestions: [
          'Como posso faturar mais esta semana?',
          'Quais clientes devo reativar?',
          'Qual servico tem melhor margem?',
          'Como esta minha taxa de retorno?',
        ],
      }
    case 'agendamentos':
      return {
        key,
        pathname,
        visible: true,
        label: 'Agenda operacional',
        subtitle: 'Pergunte sobre horarios ociosos, encaixes e oportunidades de agenda.',
        placeholder: 'Ex.: Onde tenho horarios ociosos hoje?',
        suggestions: [
          'Onde tenho horarios ociosos hoje?',
          'Quem esta com agenda mais vazia?',
          'Como posso lotar amanha?',
          'Quais clientes posso chamar para preencher horarios?',
        ],
      }
    case 'clientes':
      return {
        key,
        pathname,
        visible: true,
        label: 'Clientes e recorrencia',
        subtitle: 'Pergunte sobre retorno, risco de evasao e oportunidades de relacionamento.',
        placeholder: 'Ex.: Quais clientes estao em risco de sumir?',
        suggestions: [
          'Quais clientes estao em risco de sumir?',
          'Quem vale reativar primeiro?',
          'Como esta a recorrencia dos assinantes?',
          'Qual grupo tem maior potencial de retorno?',
        ],
      }
    case 'financeiro':
      return {
        key,
        pathname,
        visible: true,
        label: 'Financeiro',
        subtitle: 'Foque em caixa, receitas, despesas e ajustes para melhorar margem.',
        placeholder: 'Ex.: Onde estou gastando mais neste mes?',
        suggestions: [
          'Onde estou gastando mais?',
          'Como esta meu caixa este mes?',
          'Qual servico gerou mais receita?',
          'O que posso ajustar para melhorar margem?',
        ],
      }
    case 'equipe':
      return {
        key,
        pathname,
        visible: true,
        label: 'Equipe e metas',
        subtitle: 'Pergunte sobre desempenho, metas, ticket medio e ritmo do time.',
        placeholder: 'Ex.: Quem esta mais proximo da meta?',
        suggestions: [
          'Quem esta mais proximo da meta?',
          'Quem precisa vender mais?',
          'Como melhorar o ticket medio da equipe?',
          'Qual barbeiro teve melhor recorrencia?',
        ],
      }
    case 'precificacao':
      return {
        key,
        pathname,
        visible: true,
        label: 'Precificacao',
        subtitle: 'Use o contexto atual para revisar custo, margem, catalogo e oportunidades de ajuste.',
        placeholder: 'Ex.: Qual servico tem menor margem?',
        suggestions: [
          'Qual servico tem menor margem?',
          'Qual insumo pesa mais no custo?',
          'Onde posso ajustar preco?',
          'Qual servico merece virar combo?',
        ],
      }
    case 'indicadores':
      return {
        key,
        pathname,
        visible: true,
        label: 'Indicadores e saude',
        subtitle: 'Pergunte sobre tendencias, leitura do periodo e sinais de saude da base.',
        placeholder: 'Ex.: O que mais exige atencao agora?',
        suggestions: [
          'O que mais exige atencao agora?',
          'Qual tendencia esta mais fraca?',
          'Como esta a saude da base?',
          'Onde devo agir primeiro esta semana?',
        ],
      }
    case 'configuracoes':
      return {
        key,
        pathname,
        visible: true,
        label: 'Configuracoes da barbearia',
        subtitle: 'Pergunte sobre os impactos operacionais das configuracoes atuais.',
        placeholder: 'Ex.: O que vale revisar primeiro nas configuracoes?',
        suggestions: [
          'O que vale revisar primeiro nas configuracoes?',
          'Existe algum cadastro operacional incompleto?',
          'Quais ajustes podem reduzir atrito no dia a dia?',
          'O que merece padronizacao agora?',
        ],
      }
    case 'assistente':
      return {
        key,
        pathname,
        visible: true,
        label: 'BarberEX IA',
        subtitle: 'Pergunte sobre agenda, clientes, metas e numeros da barbearia.',
        placeholder: MANAGEMENT_BASE_UI.placeholder,
        suggestions: MANAGEMENT_BASE_UI.suggestions,
      }
    case 'generic':
      return {
        key,
        pathname,
        visible: true,
        label: 'BarberEX IA',
        subtitle: 'Pergunte sobre a tela atual e sobre os dados mais importantes do periodo.',
        placeholder: MANAGEMENT_BASE_UI.placeholder,
        suggestions: MANAGEMENT_BASE_UI.suggestions,
      }
    case 'internal':
      return {
        key,
        pathname,
        visible: false,
        label: 'Painel interno',
        subtitle: 'O BarberEX IA da barbearia nao fica disponivel no painel master da plataforma.',
        placeholder: MANAGEMENT_BASE_UI.placeholder,
        suggestions: [],
      }
  }
}

function buildFinancialScreenContext(key: AssistantScreenKey, pathname: string): AssistantScreenContext {
  switch (key) {
    case 'financeiro':
      return {
        key,
        pathname,
        visible: true,
        label: 'Financeiro',
        subtitle: 'Pergunte sobre caixa, margem, despesas e sinais financeiros do periodo.',
        placeholder: 'Ex.: Como esta minha margem este mes?',
        suggestions: [
          'Como esta meu caixa este mes?',
          'Onde minhas despesas estao pesando mais?',
          'Qual servico sustenta melhor o lucro?',
          'Qual tendencia financeira eu preciso acompanhar?',
        ],
      }
    case 'dashboard':
    case 'indicadores':
      return {
        key,
        pathname,
        visible: true,
        label: 'Financeiro',
        subtitle: 'Pergunte sobre margem, tendencia e leitura financeira global.',
        placeholder: FINANCIAL_BASE_UI.placeholder,
        suggestions: FINANCIAL_BASE_UI.suggestions,
      }
    case 'internal':
      return {
        key,
        pathname,
        visible: false,
        label: 'Painel interno',
        subtitle: 'O BarberEX IA da barbearia nao fica disponivel no painel master da plataforma.',
        placeholder: FINANCIAL_BASE_UI.placeholder,
        suggestions: [],
      }
    default:
      return {
        key,
        pathname,
        visible: true,
        label: 'Financeiro',
        subtitle: 'Seu perfil continua restrito a leitura financeira, mesmo fora do modulo financeiro.',
        placeholder: FINANCIAL_BASE_UI.placeholder,
        suggestions: FINANCIAL_BASE_UI.suggestions,
      }
  }
}

function buildProfessionalScreenContext(key: AssistantScreenKey, pathname: string): AssistantScreenContext {
  switch (key) {
    case 'agendamentos':
      return {
        key,
        pathname,
        visible: true,
        label: 'Minha agenda',
        subtitle: 'Pergunte sobre encaixes, horarios livres e preparo para os proximos atendimentos.',
        placeholder: 'Ex.: Como esta minha agenda amanha?',
        suggestions: [
          'Como esta minha agenda amanha?',
          'Onde tenho espaco para encaixe?',
          'Quais clientes posso chamar para preencher horarios?',
          'O que posso vender nos proximos atendimentos?',
        ],
      }
    case 'equipe':
      return {
        key,
        pathname,
        visible: true,
        label: 'Meu desempenho',
        subtitle: 'Foque em meta, ticket, comissao e ritmo do seu resultado.',
        placeholder: 'Ex.: Quantos atendimentos faltam para minha meta?',
        suggestions: [
          'Como bato minha meta?',
          'Quantos atendimentos faltam para minha meta?',
          'Estou vendendo bem em comparacao com minha meta?',
          'O que eu faco amanha para faturar mais?',
        ],
      }
    case 'dashboard':
      return {
        key,
        pathname,
        visible: true,
        label: 'Minha operacao',
        subtitle: 'Pergunte sobre seu dia, sua meta, agenda e oportunidades praticas de venda.',
        placeholder: PROFESSIONAL_BASE_UI.placeholder,
        suggestions: PROFESSIONAL_BASE_UI.suggestions,
      }
    case 'configuracoes':
      return {
        key,
        pathname,
        visible: true,
        label: 'Minha conta',
        subtitle: 'Pergunte sobre seu vinculo, acesso e rotina operacional.',
        placeholder: 'Ex.: O que vale acompanhar no meu perfil agora?',
        suggestions: [
          'O que vale acompanhar no meu perfil agora?',
          'Como esta minha meta?',
          'Qual produto devo oferecer nos proximos atendimentos?',
          'Como esta minha agenda amanha?',
        ],
      }
    case 'internal':
      return {
        key,
        pathname,
        visible: false,
        label: 'Painel interno',
        subtitle: 'O BarberEX IA da barbearia nao fica disponivel no painel master da plataforma.',
        placeholder: PROFESSIONAL_BASE_UI.placeholder,
        suggestions: [],
      }
    default:
      return {
        key,
        pathname,
        visible: true,
        label: 'Meu desempenho',
        subtitle: 'Seu escopo continua individual: agenda, meta, vendas e atendimentos proprios.',
        placeholder: PROFESSIONAL_BASE_UI.placeholder,
        suggestions: PROFESSIONAL_BASE_UI.suggestions,
      }
  }
}

export function resolveAssistantScreenContext(
  pathname: string | null | undefined,
  scope: AssistantChatScope
): AssistantScreenContext {
  const normalizedPathname = normalizePathname(pathname)
  const screenKey = resolveScreenKey(normalizedPathname)

  if (scope === 'PROFESSIONAL') {
    return buildProfessionalScreenContext(screenKey, normalizedPathname)
  }

  if (scope === 'FINANCIAL') {
    return buildFinancialScreenContext(screenKey, normalizedPathname)
  }

  return buildManagementScreenContext(screenKey, normalizedPathname)
}
