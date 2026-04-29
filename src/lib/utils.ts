import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | string | undefined | null): string {
  if (value === null || value === undefined) return 'R$ 0,00'
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num)
}

export function formatUsdCurrency(value: number | string | undefined | null): string {
  if (value === null || value === undefined) return 'US$ 0,00'
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(num)
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatTime(date: Date | string): string {
  return format(new Date(date), 'HH:mm', { locale: ptBR })
}

export function formatMonthYear(month: number, year: number): string {
  return format(new Date(year, month - 1, 1), 'MMMM/yyyy', { locale: ptBR })
}

export function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatPeriodLabel(month: number, year: number): string {
  return capitalize(format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: ptBR }))
}

export function getMonthRange(month: number, year: number) {
  const base = new Date(year, month - 1, 1)
  return { start: startOfMonth(base), end: endOfMonth(base) }
}

export function getCurrentMonthYear() {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function calcGoalProgress(achieved: number, goal: number): number {
  if (goal <= 0) return 0
  return Math.min(100, (achieved / goal) * 100)
}

export function getGoalStatus(achieved: number, goal: number, min: number) {
  if (achieved >= goal) return 'exceeded'
  if (achieved >= min) return 'on-track'
  return 'below'
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CREDIT_CARD: 'Cartao de Credito',
  DEBIT_CARD: 'Cartao de Debito',
  TRANSFER: 'Transferencia',
  OTHER: 'Outro',
}

export const EXPENSE_TYPE_LABELS: Record<string, string> = {
  FIXED: 'Fixo',
  VARIABLE: 'Variavel',
}

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Proprietario',
  MANAGER: 'Gerente',
  BARBER: 'Barbeiro',
  FINANCIAL: 'Financeiro',
  PLATFORM_ADMIN: 'Admin da plataforma',
  PLATFORM_OWNER: 'Owner da plataforma',
}

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Aguardando confirmacao',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
  COMPLETED: 'Concluido',
  NO_SHOW: 'Nao compareceu',
}

export const APPOINTMENT_SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  WHATSAPP: 'WhatsApp',
}

export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Assinatura',
  WALK_IN: 'Avulso',
}

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  CANCELLED: 'Cancelada',
}

export const BARBERSHOP_SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Em atraso',
  BLOCKED: 'Bloqueada',
  CANCELED: 'Cancelada',
}

export const APPOINTMENT_BILLING_MODEL_LABELS: Record<string, string> = {
  AVULSO: 'Cobranca avulsa',
  SUBSCRIPTION_INCLUDED: 'Incluso na assinatura',
  SUBSCRIPTION_EXTRA: 'Cobrado a parte',
}

export const CHALLENGE_TYPE_LABELS: Record<string, string> = {
  REVENUE: 'Faturamento',
  SERVICES_COUNT: 'Qtd. Servicos',
  TICKET_AVERAGE: 'Ticket Medio',
  NEW_CLIENTS: 'Novos Clientes',
}
