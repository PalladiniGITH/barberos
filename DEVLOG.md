# BarberOS — Dev Log & Documentação do Projeto

> Registro completo de decisões, arquitetura, implementações e correções.
> Atualizado em: 2026-04-08

---

## Índice

1. [Visão do Produto](#1-visão-do-produto)
2. [Stack e Decisões de Arquitetura](#2-stack-e-decisões-de-arquitetura)
3. [Schema do Banco de Dados](#3-schema-do-banco-de-dados)
4. [Fase 1 — MVP Inicial](#4-fase-1--mvp-inicial)
5. [Fase 2 — Revisão Crítica e Correções Beta](#5-fase-2--revisão-crítica-e-correções-beta)
6. [Padrões e Convenções](#6-padrões-e-convenções)
7. [Segurança](#7-segurança)
8. [Estado Atual e Pendências](#8-estado-atual-e-pendências)
9. [Direção SaaS e Produto Vendável](#9-direção-saas-e-produto-vendável)

---

## 1. Visão do Produto

**BarberOS** é um SaaS de gestão financeira e operacional para barbearias.

**Origem:** Transformação de uma planilha Excel complexa (12 abas) usada pela Barbearia Konoha em um produto web vendável.

**Posicionamento:** R$ 97–197/mês por barbearia. Multi-tenant desde o dia 1.

**Cliente demo:** Barbearia Konoha
- Login: `dono@konoha.com` / `konoha123`
- Profissionais seed: Naruto, Sasuke, Kakashi, Rock Lee, Gaara

### Planilha original (12 abas mapeadas)

| Aba da Planilha | Módulo no Sistema |
|---|---|
| Home | Dashboard |
| Raio X | Indicadores |
| Receitas | Financeiro / Receitas |
| Despesas | Financeiro / Despesas |
| Auxiliar | (categorias e dados de apoio — no banco) |
| Dashboard Desafios | Desafios |
| Desafio Mensal | Desafios / Ranking |
| Desafio por Profissional | Equipe / Profissionais |
| Indicadores | Indicadores |
| Resultado Precificação | Precificação / Serviços |
| Levantamento Precificação | Precificação / Insumos |
| Dados | Seed / Config |

---

## 2. Stack e Decisões de Arquitetura

### Stack

| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | Next.js App Router | 14 |
| Linguagem | TypeScript | 5.x |
| Estilo | Tailwind CSS + shadcn/ui | — |
| ORM | Prisma | 5.x |
| Banco | PostgreSQL | — |
| Auth | NextAuth v4 | 4.x |
| Gráficos | Recharts | 2.x |
| Forms | React Hook Form + Zod | — |
| Toasts | Sonner | 1.5+ |
| Ícones | Lucide React | — |

### Decisões arquiteturais

**Multi-tenancy row-level**
Cada entidade do banco tem `barbershopId`. Nenhuma query é feita sem filtrar por esse campo. O `barbershopId` vem da sessão JWT — nunca do body da requisição.

```ts
// Padrão em toda Server Action e Server Component
const session = await requireSession()
const { barbershopId } = session.user
// barbershopId sempre da sessão, nunca do body
```

**Server Actions com Zod**
Toda mutação passa por um Server Action que valida com Zod antes de tocar no banco. Retorno tipado:
```ts
type ActionResult = { success: true } | { success: false; error: string }
```

**Server Components + URL state**
Filtragem de período via `searchParams` (URL) em vez de estado cliente. Isso permite que Server Components façam as queries sem precisar de `useEffect` ou hydration.

**Sem N+1**
Queries do banco são feitas em paralelo com `Promise.all`. Loops que geravam múltiplas queries foram substituídos por uma query flat + agregação em memória.

### Estrutura de diretórios

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/
│   └── (dashboard)/
│       ├── dashboard/
│       ├── financeiro/
│       │   ├── receitas/
│       │   └── despesas/
│       ├── equipe/
│       │   ├── profissionais/
│       │   └── metas/
│       ├── desafios/
│       ├── precificacao/
│       │   ├── servicos/
│       │   └── insumos/
│       ├── indicadores/
│       └── configuracoes/
├── actions/
│   ├── financeiro.ts
│   └── equipe.ts
├── components/
│   ├── dashboard/
│   │   ├── kpi-card.tsx
│   │   ├── revenue-chart.tsx
│   │   ├── professional-ranking.tsx
│   │   └── goal-progress.tsx
│   ├── financeiro/
│   │   ├── delete-revenue-button.tsx
│   │   └── delete-expense-button.tsx
│   ├── equipe/
│   │   ├── professional-modal.tsx
│   │   ├── toggle-active-button.tsx
│   │   └── goal-form.tsx
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   └── page-header.tsx
│   ├── shared/
│   │   └── period-selector.tsx
│   └── providers.tsx
├── lib/
│   ├── auth.ts
│   ├── prisma.ts
│   ├── utils.ts
│   └── period.ts
prisma/
├── schema.prisma
└── seed.ts
```

---

## 3. Schema do Banco de Dados

### Modelos

```
Barbershop          — tenant root
User                — usuário do sistema (dono, gerente, barbeiro)
Account / Session / VerificationToken — NextAuth
Professional        — profissionais/barbeiros da barbearia
FinancialCategory   — categorias de receita e despesa
Revenue             — lançamentos de receita
Expense             — lançamentos de despesa
Service             — serviços oferecidos (corte, barba, etc.)
Supply              — insumos (produto, shampoo, etc.)
ServiceInput        — relação serviço ↔ insumo com quantidade
PricingRule         — regras de precificação por serviço
MonthlyGoal         — meta mensal da barbearia
ProfessionalGoal    — meta individual por profissional
Challenge           — desafios (ex: "bater R$5k em abril")
ChallengeResult     — resultado de cada profissional no desafio
Commission          — comissão calculada por mês/profissional
CampaignMetric      — métricas de CRM (preparado para v2)
```

### Indexes críticos

```prisma
@@index([barbershopId, date])           // Revenue
@@index([barbershopId, professionalId]) // Revenue
@@index([barbershopId, dueDate])        // Expense
@@index([barbershopId, active])         // Professional
@@index([barbershopId, month, year])    // Commission
```

### Constraints de unicidade

```prisma
Professional: @@unique([email, barbershopId])
MonthlyGoal:  @@unique([barbershopId, month, year])
ProfessionalGoal: @@unique([professionalId, month, year])
ChallengeResult:  @@unique([challengeId, professionalId])
Commission:       @@unique([professionalId, month, year])
```

---

## 4. Fase 1 — MVP Inicial

### O que foi gerado

Todo o projeto foi construído do zero a partir da planilha Excel como referência funcional.

#### `prisma/schema.prisma`
Schema multi-tenant completo com todos os modelos descritos acima.

#### `prisma/seed.ts`
Seed com dados reais suficientes para demonstrar o produto:
- 1 barbearia (Konoha)
- 1 usuário dono
- 5 profissionais
- Categorias de receita e despesa
- Receitas e despesas do mês anterior e mês atual

**Decisão:** Seed usa datas dinâmicas (`new Date()`) para sempre gerar dados no mês corrente — nunca datas hardcoded.

```ts
const NOW = new Date()
const CURRENT_YEAR = NOW.getFullYear()
const CURRENT_MONTH = NOW.getMonth() + 1
const PREV_MONTH = CURRENT_MONTH === 1 ? 12 : CURRENT_MONTH - 1
const PREV_YEAR = CURRENT_MONTH === 1 ? CURRENT_YEAR - 1 : CURRENT_YEAR
```

#### `src/lib/auth.ts`

```ts
// Helpers de auth para Server Components e Actions
export async function requireSession()      // redireciona para /login se não autenticado
export async function assertOwnership(...)  // valida que o recurso pertence ao tenant
```

NextAuth configurado com:
- Provider: Credentials (email + bcrypt)
- Strategy: JWT
- Token contém: `id`, `name`, `email`, `role`, `barbershopId`

#### `src/lib/utils.ts`

Funções utilitárias:
- `formatCurrency(value)` — formata para BRL
- `formatPercent(value, decimals)` — formata porcentagem
- `formatDate(date)` — dd/MM/yyyy
- `formatMonthYear(month, year)` — "abril/2026"
- `getMonthRange(month, year)` — `{ start, end }` para queries
- `calcGoalProgress(achieved, goal)` — % atingido (max 100)
- `getGoalStatus(achieved, goal, min)` — `'exceeded' | 'on-track' | 'below'`

#### Módulos entregues no MVP

**Dashboard** (`/dashboard`)
- 4 KPIs: Receita, Despesas, Lucro Estimado, Ticket Médio
- Gráfico de área: Receitas vs Despesas (6 meses)
- Meta do mês com progress bar
- Ranking de profissionais
- Formas de pagamento (distribuição %)
- Seletor de período (mês/ano via URL)

**Financeiro — Receitas** (`/financeiro/receitas`)
- Listagem do período com total
- Formulário de lançamento rápido (modal ou inline)
- KPIs: total do mês, ticket médio, PIX+Dinheiro
- Filtro por período

**Financeiro — Despesas** (`/financeiro/despesas`)
- Listagem com status (paga/pendente/vencida)
- Badge "recorrente"
- Banner de alerta para despesas vencidas
- KPI "a pagar"

**Equipe — Profissionais** (`/equipe/profissionais`)
- Cards com faturamento individual do período
- Criar/editar profissional
- Ativar/desativar
- Badge de inativo

**Equipe — Metas** (`/equipe/metas`)
- Meta mensal da barbearia (valor mínimo e meta ideal)
- Formulário de upsert
- Progress por profissional

**Desafios** (`/desafios`)
- Listagem de desafios ativos
- Ranking por profissional

**Precificação — Serviços** (`/precificacao/servicos`)
- Cálculo de margem: preço − insumos − comissão − taxa cartão − impostos
- Sugestão de preço ideal

**Precificação — Insumos** (`/precificacao/insumos`)
- Gestão de insumos com custo por unidade

**Indicadores** (`/indicadores`)
- KPIs de evolução: 6 meses de histórico
- Comparativos

---

## 5. Fase 2 — Revisão Crítica e Correções Beta

Revisão como CTO/product owner. Foco: o que quebraria em produção com uma barbearia real.

### Bugs críticos corrigidos

---

#### Bug 1 — Seed com datas hardcoded

**Problema:** Seed populava dados em março/abril 2025. Dashboard mostrava R$ 0,00 porque o mês atual é 2026.

**Impacto:** Sistema parecia quebrado na primeira demonstração.

**Correção:** Reescrita completa do seed para usar `new Date()` dinamicamente. Popula sempre o mês anterior (completo) e o mês atual (até hoje).

---

#### Bug 2 — `requireSession` causava crash em Server Components

**Problema:**
```ts
// ERRADO — causa tela de erro 500 no App Router
if (!session) throw new Error('Não autenticado')
```

**Impacto:** Usuário não logado via direto para erro 500 em vez de `/login`.

**Correção:**
```ts
// CORRETO — redirect é a forma certa no App Router
import { redirect } from 'next/navigation'

export async function requireSession() {
  const session = await getSession()
  if (!session?.user?.barbershopId) redirect('/login')
  return session
}
```

---

#### Bug 3 — Vulnerabilidade IDOR nas Server Actions

**Problema:** Um tenant malicioso podia passar `professionalId` de outro tenant no body da requisição. O sistema inseria sem verificar a quem pertencia o recurso.

**Impacto:** Violação de dados entre tenants — crítico para um SaaS.

**Correção — `assertOwnership()`:**
```ts
export async function assertOwnership(
  barbershopId: string,
  table: 'professional' | 'service' | 'financialCategory' | 'supply',
  id: string | null | undefined
) {
  if (!id) return
  const record = await (prisma[table] as any).findUnique({
    where: { id },
    select: { barbershopId: true },
  })
  if (!record || record.barbershopId !== barbershopId) {
    throw new Error(`Acesso negado: recurso ${table}#${id} não pertence ao tenant`)
  }
}
```

Chamado em paralelo antes de qualquer mutação:
```ts
await Promise.all([
  assertOwnership(barbershopId, 'professional', data.professionalId),
  assertOwnership(barbershopId, 'service', data.serviceId),
  assertOwnership(barbershopId, 'financialCategory', data.categoryId),
])
```

---

#### Bug 4 — N+1 queries no gráfico do Dashboard

**Problema:** Gráfico de 6 meses executava 12 queries individuais (6 meses × receitas + despesas em loop).

```ts
// ANTES — 12 queries
const chartData = await Promise.all(
  Array.from({ length: 6 }, (_, i) => {
    // query receitas do mês i
    // query despesas do mês i
  })
)
```

**Impacto:** Dashboard lento. Cresce linearmente com o número de meses no gráfico.

**Correção — 2 queries flat + agregação em memória:**
```ts
// DEPOIS — 2 queries para todo o período
const [chartRevenues, chartExpenses] = await Promise.all([
  prisma.revenue.findMany({
    where: { barbershopId, date: { gte: chartStart, lte: chartEnd } },
    select: { date: true, amount: true },
  }),
  prisma.expense.findMany({
    where: { barbershopId, dueDate: { gte: chartStart, lte: chartEnd } },
    select: { dueDate: true, amount: true },
  }),
])

// Agregação por mês no app (O(n), n = registros do período)
function buildChartData() {
  const buckets: Record<string, { label: string; receitas: number; despesas: number }> = {}
  // ... agrupa por chave "YYYY-MM"
}
```

---

#### Bug 5 — `require()` dinâmico causando runtime error no Dashboard

**Problema:** No final da página havia uma função `Target` definida com `require('lucide-react')` — erro de runtime em produção.

**Correção:** Import estático no topo do arquivo:
```ts
import { DollarSign, TrendingDown, Receipt, Wallet, Target } from 'lucide-react'
```

---

#### Bug 6 — `@@unique` faltando no modelo Professional

**Problema:** Seed usava `upsert` com `{ email_barbershopId: { email, barbershopId } }` como chave, mas o schema não definia esse `@@unique`. A migração falhava silenciosamente.

**Correção:**
```prisma
model Professional {
  // ...
  @@unique([email, barbershopId])
}
```

---

#### Bug 7 — Campos ausentes por inconsistência no schema

| Modelo | Campo ausente | Adicionado |
|---|---|---|
| `FinancialCategory` | `updatedAt` | `updatedAt DateTime @updatedAt` |
| `ChallengeResult` | `createdAt` | `createdAt DateTime @default(now())` |

---

#### Bug 8 — Validação Zod ausente nas Server Actions

**Problema:** Actions recebiam dados do cliente sem validação. Um campo `amount: "abc"` ou `date: "ontem"` chegava direto ao Prisma.

**Correção — schema Zod completo:**
```ts
const RevenueSchema = z.object({
  amount: z.string()
    .transform((v) => parseFloat(v))
    .pipe(z.number().positive('Valor deve ser positivo').max(999999, 'Valor inválido')),
  paymentMethod: z.enum(['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'OTHER']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  professionalId: z.string().cuid().optional().nullable(),
  serviceId: z.string().cuid().optional().nullable(),
  categoryId: z.string().cuid().optional().nullable(),
  description: z.string().max(200).optional().nullable(),
})
```

Padrão de retorno unificado:
```ts
type ActionResult = { success: true } | { success: false; error: string }

export async function addRevenue(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const parsed = RevenueSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' }
  }
  // ...
}
```

---

### Novos arquivos criados na Fase 2

#### `src/lib/period.ts`

Resolução segura de período via `searchParams` da URL. Valida ranges para evitar injeção de datas absurdas.

```ts
export function resolvePeriod(searchParams: { month?: string; year?: string }) {
  const now = new Date()
  const rawMonth = parseInt(searchParams.month ?? '', 10)
  const rawYear = parseInt(searchParams.year ?? '', 10)
  const month = rawMonth >= 1 && rawMonth <= 12 ? rawMonth : now.getMonth() + 1
  const year = rawYear >= 2020 && rawYear <= 2030 ? rawYear : now.getFullYear()
  return { month, year }
}
```

#### `src/components/shared/period-selector.tsx`

Componente client para navegação de mês/ano. Usa `useRouter` + `useSearchParams` para atualizar a URL sem reload completo. Desabilita o botão "próximo" no mês atual.

Funciona com Server Components porque o estado fica na URL — não há `useState` de período.

#### `src/components/financeiro/delete-revenue-button.tsx` e `delete-expense-button.tsx`

Delete com confirmação de duplo clique — evita exclusão acidental:

```ts
async function handleDelete() {
  if (!confirm) {
    setConfirm(true)
    setTimeout(() => setConfirm(false), 3000) // 3s para cancelar
    return
  }
  // executa o delete
}
```

Exibe "Excluir" → "Tem certeza?" com feedback visual. Usa Sonner para toast de sucesso/erro.

#### `src/actions/equipe.ts`

Server Actions para equipe:
- `createProfessional(data)` — cria profissional com validação Zod
- `updateProfessional(id, data)` — atualiza com assertOwnership
- `toggleProfessionalActive(id)` — toggle ativo/inativo
- `upsertMonthlyGoal(data)` — cria ou atualiza meta mensal
- `upsertProfessionalGoal(data)` — valida que existe MonthlyGoal antes de criar meta individual

#### `src/components/equipe/professional-modal.tsx`

Modal de criar/editar profissional com:
- React Hook Form + Zod
- Toast de sucesso/erro via Sonner
- `router.refresh()` para revalidar Server Components após mutação

#### `src/components/equipe/toggle-active-button.tsx`

Botão que chama `toggleProfessionalActive` e exibe estado atual com badge visual.

#### `src/components/equipe/goal-form.tsx`

Form de upsert da meta mensal (valor mínimo + meta ideal) com feedback por toast.

#### `src/components/providers.tsx`

Adicionado `<Toaster>` do Sonner com tema dark e posição `bottom-right`.

#### `src/lib/onboarding.ts`

Camada de estado de onboarding por tenant:
- resolve mês/ano pelo timezone da barbearia
- monta checklist de ativação
- informa se o tenant já concluiu setup

#### `src/actions/onboarding.ts`

Server Action de conclusão do onboarding:
- valida dados com Zod
- atualiza dados da barbearia
- garante categorias financeiras padrão
- cria equipe inicial
- cria/atualiza serviços iniciais
- cria meta do mês
- marca o onboarding como concluído

#### `src/app/setup/page.tsx` e `src/components/onboarding/setup-wizard.tsx`

Fluxo de setup inicial para tenants novos:
- wizard em 4 etapas
- foco em ativação rápida
- criação guiada de barbearia, equipe, serviços e meta
- redirecionamento automático para `/dashboard` após concluir

---

## 6. Padrões e Convenções

### Server Actions

```ts
// 1. Sempre começa com requireSession
const session = await requireSession()
const { barbershopId } = session.user

// 2. Valida input com Zod
const parsed = Schema.safeParse(rawData)
if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message }

// 3. Verifica ownership de recursos externos
await assertOwnership(barbershopId, 'professional', data.professionalId)

// 4. Executa mutação
await prisma.revenue.create({ data: { barbershopId, ...parsed.data } })

// 5. Retorna ActionResult
return { success: true }
```

### Server Components com filtro de período

```ts
interface Props {
  searchParams: { month?: string; year?: string }
}

export default async function Page({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const data = await getData(session.user.barbershopId, month, year)
  // ...
}
```

### Queries paralelas

```ts
// Sempre usar Promise.all para queries independentes
const [revenues, expenses, goal] = await Promise.all([
  prisma.revenue.aggregate({ ... }),
  prisma.expense.aggregate({ ... }),
  prisma.monthlyGoal.findUnique({ ... }),
])
```

### Feedback de ações (toast)

```ts
// Client component após Server Action
const result = await addRevenue(formData)
if (result.success) {
  toast.success('Receita lançada')
  router.refresh()
} else {
  toast.error(result.error)
}
```

---

## 7. Segurança

### Multi-tenant isolation

- `barbershopId` sempre extraído da sessão JWT, nunca do body
- Todas as queries filtradas por `barbershopId`
- `assertOwnership()` valida recursos de outras entidades antes de referenciar

### Validação de inputs

- Toda Server Action valida com Zod antes de qualquer operação
- `searchParams` validados com `resolvePeriod()` (range 2020–2030, meses 1–12)
- Strings numéricas convertidas e validadas (amount, etc.)

### Auth

- Senhas com bcrypt
- JWT contém apenas campos necessários (`id`, `barbershopId`, `role`, `name`, `email`)
- `requireSession()` redireciona para `/login` — nunca expõe erro interno

### Vulnerabilidades conhecidas pendentes

- **Timezone:** servidor usa UTC, barbearias brasileiras são UTC-3. Datas de hoje/mês podem divergir nas madrugadas. Solução: configurar timezone por barbearia nas settings.

---

## 8. Estado Atual e Pendências

### Funcional e testado

- [x] Multi-tenancy seguro com IDOR prevention
- [x] Autenticação com NextAuth + JWT + bcrypt
- [x] Lançamento de receitas com Zod + assertOwnership
- [x] Lançamento de despesas com Zod + assertOwnership
- [x] Dashboard com KPIs reais, gráfico, ranking, meta
- [x] Navegação de período via URL (Server Components)
- [x] Delete com confirmação dupla + toast
- [x] CRUD de profissionais (criar, editar, ativar/desativar)
- [x] Meta mensal da barbearia (upsert)
- [x] Seed dinâmico (sempre dados no mês atual)
- [x] Onboarding inicial por tenant com wizard e redirect de ativação

### Pendente

| Item | Prioridade | Observação |
|---|---|---|
| Redesign do Dashboard (impacto visual máximo) | Alta | Próximo item |
| CRUD de Serviços (precificação) | Alta | Módulo read-only hoje |
| CRUD de Desafios | Alta | Módulo read-only hoje |
| UI para metas individuais por profissional | Média | Action existe, falta UI |
| Paginação nas tabelas financeiras | Média | Problemático com 500+ registros/mês |
| Timezone por barbearia (UTC-3) | Média | Risco nas madrugadas |
| Export PDF/CSV | Baixa | Necessário para fechamento mensal |
| Audit logs (quem criou/editou o quê) | Baixa | Importante para barbearias com equipe |

---

*Documento gerado automaticamente pelo Claude Code — BarberOS v1.0 MVP*

---

## 9. Direção SaaS e Produto Vendável

### Reposicionamento do produto

O BarberOS não deve ser vendido como "sistema financeiro para barbearia".

Isso é commodity.

O produto precisa ser percebido como:

**"o painel que mostra, em menos de 30 segundos, se a barbearia está ganhando dinheiro, ficando para trás na meta, queimando margem ou deixando dinheiro na mesa."**

Em outras palavras:

- Não vender controle.
- Vender clareza.
- Não vender cadastro.
- Vender decisão.
- Não vender planilha web.
- Vender crescimento com sensação de controle.

### O que torna esse SaaS vendável

Para justificar uma assinatura recorrente de R$ 97 a R$ 197 por unidade, o sistema precisa gerar valor percebido em 4 frentes:

1. **Financeiro visível**
O dono precisa ver faturamento, lucro estimado, despesas, ticket médio e meta sem montar nada manualmente.

2. **Ação imediata**
O sistema não pode só mostrar número. Ele precisa dizer onde agir agora: despesa atrasada, ticket caindo, meta abaixo do ritmo, profissional puxando o mês.

3. **Equipe e performance**
Barbearia é operação de pessoas. Ranking, metas individuais, desafios e comissão não são extras; são parte do motor comercial do produto.

4. **Preço e margem**
A maioria dos concorrentes para no controle básico. O diferencial forte está em ligar operação + precificação + margem real por serviço.

### O que evitar

Se o produto seguir apenas como um espelho da planilha original, ele corre estes riscos:

- virar um sistema de lançamento manual cansativo
- perder valor percebido depois da demonstração
- competir só por preço
- ser trocado por planilha, caderno ou app genérico de gestão

Diretriz:

**a planilha pode ser a origem funcional, mas não pode ser a referência de experiência do produto.**

### Pilar 1 — Multi-tenancy de verdade

A arquitetura já nasceu com `barbershopId` em todas as entidades e prevenção de IDOR. Isso é o mínimo técnico correto. Para um SaaS vendável, multi-tenancy precisa aparecer também na experiência e na operação.

#### Requisitos de produto

- Cada barbearia deve conseguir entrar por fluxo próprio de onboarding.
- Cada tenant precisa ter identidade mínima: nome, logo, timezone, moeda/região e preferências operacionais.
- O sistema deve funcionar com `owner`, `manager`, `financial` e `barber` com permissões claras por tela.
- Seeds e demos devem ser estritamente ambientes de desenvolvimento/demo, nunca misturados com tenants reais.
- O produto deve preparar terreno para billing, trials e upgrade de plano por barbearia.

#### Lacunas prioritárias

- Configuração de timezone por barbearia.
- Estrutura de onboarding por tenant.
- Base para assinatura/plano por tenant.
- Estados vazios diferentes para tenant novo vs tenant ativo.

### Pilar 2 — Onboarding simples

O maior risco de um SaaS operacional é pedir trabalho demais antes de entregar valor.

O onboarding ideal do BarberOS precisa levar o dono até o primeiro momento de valor em menos de 10 minutos.

#### Meta de ativação

**Em até 7 minutos, o dono precisa conseguir ver uma dashboard útil.**

#### Fluxo recomendado de onboarding

1. Criar barbearia e usuário dono.
2. Adicionar 1 a 3 profissionais.
3. Cadastrar 3 a 5 serviços principais com preço atual.
4. Definir meta mensal.
5. Lançar receitas de 1 dia ou importar um template simples.

#### Como acelerar a ativação

- Wizard curto de setup inicial.
- Barra/checklist de progresso de onboarding.
- Dados de exemplo opcionais para tenant vazio.
- Estados vazios com CTA único e claro.
- Cadastro em fluxo guiado, sem telas administrativas longas.

#### Regra de UX

**Toda tela vazia deve dizer qual é o próximo passo e por que aquilo importa para o lucro.**

### Pilar 3 — Entrega de valor rápida

O home/dashboard não pode ser um mural de widgets. Ele deve responder, com clareza, às 5 perguntas que fazem o dono perceber valor:

1. Quanto entrou no mês?
2. Quanto sobrou de verdade?
3. Estou no ritmo da meta ou atrasado?
4. Quem está puxando o faturamento?
5. O que eu preciso fazer hoje?

#### Estrutura ideal da dashboard

- Bloco principal: resultado do mês
- Bloco secundário: meta e ritmo
- Bloco de apoio: comparativo com mês anterior
- Bloco de ação: alertas priorizados
- Bloco de equipe: ranking dos profissionais
- Bloco histórico: tendência de receitas vs despesas

#### O que não deve subir para a home

- tabelas longas
- filtros excessivos
- distribuição de dados pouco acionáveis
- qualquer card que não ajude o dono a decidir algo

### Pilar 4 — Diferenciais competitivos

Se o BarberOS quiser ser mais do que "um ERP pequeno para barbearia", os diferenciais precisam ser claros.

#### Diferencial 1 — Gestão por lucro, não só por faturamento

Muitos sistemas mostram receita. Poucos mostram lucro estimado com clareza operacional.

Mensagem vendável:

**"Não basta faturar bem. O BarberOS mostra se esse faturamento está virando lucro."**

#### Diferencial 2 — Precificação com margem real

O módulo de precificação já aponta na direção certa. Isso é argumento comercial forte porque conecta:

- preço do serviço
- custo de insumo
- comissão
- taxa de cartão
- imposto
- margem final

Mensagem vendável:

**"Você para de chutar preço e passa a saber quanto cada serviço realmente deixa no caixa."**

#### Diferencial 3 — Equipe como motor de crescimento

Barbearia cresce por performance de time. Ranking, metas individuais, desafios e comissão deixam o sistema menos administrativo e mais comercial.

Mensagem vendável:

**"Além de controlar o negócio, você consegue puxar performance da equipe."**

#### Diferencial 4 — Alertas acionáveis

O sistema deve explicar o que está acontecendo e qual é a melhor próxima ação.

Exemplos:

- "Sua meta está 18% abaixo do ritmo ideal."
- "O ticket médio caiu em relação ao mês anterior."
- "As despesas já consumiram 92% do teto."
- "Seu melhor profissional está perto de bater a meta individual."

Mensagem vendável:

**"Você não precisa interpretar planilha. O sistema já aponta onde agir."**

#### Diferencial 5 — Benchmarking futuro

Como SaaS multi-tenant, existe uma vantagem estratégica que a planilha nunca terá:

**benchmark anônimo entre barbearias semelhantes.**

Exemplos futuros:

- ticket médio acima/abaixo da média do segmento
- margem por serviço comparada com barbearias parecidas
- ritmo de meta vs outras operações do mesmo porte

Isso não precisa entrar no MVP, mas deve orientar o roadmap.

### Como o produto deve ser percebido

O cliente não deve pensar:

- "isso substitui minha planilha"

Ele deve pensar:

- "isso me mostra o negócio em segundos"
- "isso me ajuda a cobrar melhor"
- "isso me ajuda a puxar minha equipe"
- "isso me ajuda a bater meta e proteger lucro"

### Direção de roadmap

#### P0 — Obrigatório para ficar vendável

- Redesign da dashboard orientado a decisão
- Wizard de onboarding inicial
- Estados vazios inteligentes
- Timezone por barbearia
- CRUD completo de serviços e precificação
- UI de metas individuais por profissional

#### P1 — Aumenta retenção e valor percebido

- CRUD de desafios
- visão de comissão mais forte
- quick actions na dashboard
- importação simples de dados iniciais
- métricas de ativação por tenant

#### P2 — Diferenciação forte de mercado

- CRM leve / recuperação de clientes
- benchmarking anônimo entre barbearias
- automações por alerta
- billing/assinatura self-service
- relatórios executivos e exportação

### Princípio final

Se o BarberOS só organizar lançamentos, ele será comparado com planilhas.

Se o BarberOS mostrar lucro, direção, prioridade e performance da equipe, ele passa a ser comparado com resultado.

**Esse é o ponto: o produto precisa ser um sistema de decisão para donos de barbearia, não apenas um sistema de registro.**
