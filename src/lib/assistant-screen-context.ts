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
  description: 'Pergunte sobre agenda, clientes, metas, margem e prioridades da operação.',
}

const FINANCIAL_BASE_UI: AssistantBaseUiConfig = {
  suggestions: [
    'Como está minha margem este mês?',
    'Onde minhas despesas estão pesando mais?',
    'Qual serviço sustenta melhor o lucro?',
    'Qual tendência financeira eu preciso acompanhar?',
  ],
  placeholder: 'Pergunte sobre caixa, despesas, margem e sinais financeiros do período...',
  description: 'Pergunte sobre caixa, margem, despesas e sinais financeiros do período.',
}

const PROFESSIONAL_BASE_UI: AssistantBaseUiConfig = {
  suggestions: [
    'Como bato minha meta?',
    'O que vender nos proximos atendimentos?',
    'Como esta minha agenda amanha?',
    'Quantos atendimentos faltam para minha meta?',
  ],
  placeholder: 'Pergunte sobre sua meta, agenda, vendas ou próximos atendimentos...',
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
        subtitle: 'Pergunte sobre faturamento, recorrência, margem e prioridades da semana.',
        placeholder: 'Ex.: Como posso faturar mais esta semana?',
        suggestions: [
          'Como posso faturar mais esta semana?',
          'Quais clientes devo reativar?',
          'Qual serviço tem melhor margem?',
          'Como está minha taxa de retorno?',
        ],
      }
    case 'agendamentos':
      return {
        key,
        pathname,
        visible: true,
        label: 'Agenda operacional',
        subtitle: 'Pergunte sobre horários ociosos, encaixes e oportunidades de agenda.',
        placeholder: 'Ex.: Onde tenho horários ociosos hoje?',
        suggestions: [
          'Onde tenho horários ociosos hoje?',
          'Quem está com agenda mais vazia?',
          'Como posso lotar amanhã?',
          'Quais clientes posso chamar para preencher horários?',
        ],
      }
    case 'clientes':
      return {
        key,
        pathname,
        visible: true,
        label: 'Clientes e recorrência',
        subtitle: 'Pergunte sobre retorno, risco de evasão e oportunidades de relacionamento.',
        placeholder: 'Ex.: Quais clientes estão em risco de sumir?',
        suggestions: [
          'Quais clientes estão em risco de sumir?',
          'Quem vale reativar primeiro?',
          'Como está a recorrência dos assinantes?',
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
        placeholder: 'Ex.: Onde estou gastando mais neste mês?',
        suggestions: [
          'Onde estou gastando mais?',
          'Como está meu caixa este mês?',
          'Qual serviço gerou mais receita?',
          'O que posso ajustar para melhorar margem?',
        ],
      }
    case 'equipe':
      return {
        key,
        pathname,
        visible: true,
        label: 'Equipe e metas',
        subtitle: 'Pergunte sobre desempenho, metas, ticket médio e ritmo do time.',
        placeholder: 'Ex.: Quem está mais próximo da meta?',
        suggestions: [
          'Quem está mais próximo da meta?',
          'Quem precisa vender mais?',
          'Como melhorar o ticket médio da equipe?',
          'Qual barbeiro teve melhor recorrência?',
        ],
      }
    case 'precificacao':
      return {
        key,
        pathname,
        visible: true,
        label: 'Precificação',
        subtitle: 'Use o contexto atual para revisar custo, margem, catálogo e oportunidades de ajuste.',
        placeholder: 'Ex.: Qual serviço tem menor margem?',
        suggestions: [
          'Qual serviço tem menor margem?',
          'Qual insumo pesa mais no custo?',
          'Onde posso ajustar preço?',
          'Qual serviço merece virar combo?',
        ],
      }
    case 'indicadores':
      return {
        key,
        pathname,
        visible: true,
        label: 'Indicadores e saúde',
        subtitle: 'Pergunte sobre tendências, leitura do período e sinais de saúde da base.',
        placeholder: 'Ex.: O que mais exige atenção agora?',
        suggestions: [
          'O que mais exige atenção agora?',
          'Qual tendência está mais fraca?',
          'Como está a saúde da base?',
          'Onde devo agir primeiro esta semana?',
        ],
      }
    case 'configuracoes':
      return {
        key,
        pathname,
        visible: true,
        label: 'Configurações da barbearia',
        subtitle: 'Pergunte sobre os impactos operacionais das configurações atuais.',
        placeholder: 'Ex.: O que vale revisar primeiro nas configurações?',
        suggestions: [
          'O que vale revisar primeiro nas configurações?',
          'Existe algum cadastro operacional incompleto?',
          'Quais ajustes podem reduzir atrito no dia a dia?',
          'O que merece padronização agora?',
        ],
      }
    case 'assistente':
      return {
        key,
        pathname,
        visible: true,
        label: 'BarberEX IA',
        subtitle: 'Pergunte sobre agenda, clientes, metas e números da barbearia.',
        placeholder: MANAGEMENT_BASE_UI.placeholder,
        suggestions: MANAGEMENT_BASE_UI.suggestions,
      }
    case 'generic':
      return {
        key,
        pathname,
        visible: true,
        label: 'BarberEX IA',
        subtitle: 'Pergunte sobre a tela atual e sobre os dados mais importantes do período.',
        placeholder: MANAGEMENT_BASE_UI.placeholder,
        suggestions: MANAGEMENT_BASE_UI.suggestions,
      }
    case 'internal':
      return {
        key,
        pathname,
        visible: false,
        label: 'Painel interno',
        subtitle: 'O BarberEX IA da barbearia não fica disponível no painel master da plataforma.',
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
        subtitle: 'Pergunte sobre caixa, margem, despesas e sinais financeiros do período.',
        placeholder: 'Ex.: Como está minha margem este mês?',
        suggestions: [
          'Como está meu caixa este mês?',
          'Onde minhas despesas estão pesando mais?',
          'Qual serviço sustenta melhor o lucro?',
          'Qual tendência financeira eu preciso acompanhar?',
        ],
      }
    case 'dashboard':
    case 'indicadores':
      return {
        key,
        pathname,
        visible: true,
        label: 'Financeiro',
        subtitle: 'Pergunte sobre margem, tendência e leitura financeira global.',
        placeholder: FINANCIAL_BASE_UI.placeholder,
        suggestions: FINANCIAL_BASE_UI.suggestions,
      }
    case 'internal':
      return {
        key,
        pathname,
        visible: false,
        label: 'Painel interno',
        subtitle: 'O BarberEX IA da barbearia não fica disponível no painel master da plataforma.',
        placeholder: FINANCIAL_BASE_UI.placeholder,
        suggestions: [],
      }
    default:
      return {
        key,
        pathname,
        visible: true,
        label: 'Financeiro',
        subtitle: 'Seu perfil continua restrito à leitura financeira, mesmo fora do módulo financeiro.',
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
        subtitle: 'Pergunte sobre encaixes, horários livres e preparo para os próximos atendimentos.',
        placeholder: 'Ex.: Como está minha agenda amanhã?',
        suggestions: [
          'Como está minha agenda amanhã?',
          'Onde tenho espaço para encaixe?',
          'Quais clientes posso chamar para preencher horários?',
          'O que posso vender nos próximos atendimentos?',
        ],
      }
    case 'equipe':
      return {
        key,
        pathname,
        visible: true,
        label: 'Meu desempenho',
        subtitle: 'Foque em meta, ticket, comissão e ritmo do seu resultado.',
        placeholder: 'Ex.: Quantos atendimentos faltam para minha meta?',
        suggestions: [
          'Como bato minha meta?',
          'Quantos atendimentos faltam para minha meta?',
          'Estou vendendo bem em comparação com minha meta?',
          'O que eu faço amanhã para faturar mais?',
        ],
      }
    case 'dashboard':
      return {
        key,
        pathname,
        visible: true,
        label: 'Minha operação',
        subtitle: 'Pergunte sobre seu dia, sua meta, agenda e oportunidades práticas de venda.',
        placeholder: PROFESSIONAL_BASE_UI.placeholder,
        suggestions: PROFESSIONAL_BASE_UI.suggestions,
      }
    case 'configuracoes':
      return {
        key,
        pathname,
        visible: true,
        label: 'Minha conta',
        subtitle: 'Pergunte sobre seu vínculo, acesso e rotina operacional.',
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
        subtitle: 'O BarberEX IA da barbearia não fica disponível no painel master da plataforma.',
        placeholder: PROFESSIONAL_BASE_UI.placeholder,
        suggestions: [],
      }
    default:
      return {
        key,
        pathname,
        visible: true,
        label: 'Meu desempenho',
        subtitle: 'Seu escopo continua individual: agenda, meta, vendas e atendimentos próprios.',
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
