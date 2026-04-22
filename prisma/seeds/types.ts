import type {
  AppointmentBillingModel,
  AppointmentSource,
  AppointmentStatus,
  CategoryType,
  ChallengeType,
  CustomerType,
  PaymentMethod,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client'

export interface MonthMeta {
  key: string
  month: number
  year: number
  daysInMonth: number
  isCurrent: boolean
  label: string
}

export type ServicePriceCategory = 'HAIRCUT' | 'BEARD' | 'COMBO' | 'OTHER'

export interface SeedBarbershopDefinition {
  name: string
  slug: string
  address: string
  phone: string
  email: string
  timezone: string
  onboardingStep: number
}

export interface SeedUserDefinition {
  key: string
  name: string
  email: string
  role: UserRole
}

export interface SeedProfessionalDefinition {
  key: string
  name: string
  email: string
  phone: string
  commissionRate: number
  haircutPrice: number
  beardPrice: number
  comboPrice: number
  acceptsWalkIn: boolean
  acceptsSubscription: boolean
  baseAppointments: number
  ticketBoost: number
  rotation: string[]
}

export interface SeedCategoryDefinition {
  key: string
  name: string
  type: CategoryType
  color: string
}

export interface SeedSupplyDefinition {
  key: string
  name: string
  unit: string
  unitCost: number
}

export interface SeedServiceInputDefinition {
  supplyKey: string
  quantity: number
}

export interface SeedServiceDefinition {
  key: string
  name: string
  description: string
  price: number
  duration: number
  priceCategory: ServicePriceCategory
  pricing: {
    cardFeePercent: number
    taxPercent: number
    commissionPercent: number
    directCost: number
    suggestedPrice: number
  }
  inputs: SeedServiceInputDefinition[]
}

export interface SeedCustomerDefinition {
  key: string
  name: string
  phone: string
  email: string
  type: CustomerType
  notes?: string
  subscriptionStatus?: SubscriptionStatus
  subscriptionPrice?: number
  preferredProfessionalKey?: string
}

export interface ScheduleBlueprint {
  key: string
  dayOffset: number
  time: string
  professionalKey: string
  customerKey: string
  serviceKey: string
  status: AppointmentStatus
  source: AppointmentSource
  billingModel?: AppointmentBillingModel
  notes?: string
}

export interface SeedCampaignMetricDefinition {
  key: string
  monthOffset: number
  campaignName: string
  messagesSent: number
  messagesAnswered: number
  appointmentsBooked: number
  newClients: number
  recoveredClients: number
  notes: string
}

export interface SeedExpenseTemplate {
  description: string
  amount: number
  categoryKey: string
  dueDay: number
  paid: boolean
  recurrent: boolean
}

export interface SeedProfessionalRecord extends SeedProfessionalDefinition {
  id: string
}

export interface SeedServiceRecord extends SeedServiceDefinition {
  id: string
}

export interface SeedCustomerRecord extends SeedCustomerDefinition {
  id: string
}

export interface SeedCategoryRecord extends SeedCategoryDefinition {
  id: string
}

export interface SeedSupplyRecord extends SeedSupplyDefinition {
  id: string
}

export interface SeedUserRecord extends SeedUserDefinition {
  id: string
}

export interface SeedBarbershopRecord {
  id: string
  name: string
  slug: string
  timezone: string
}

export interface SeedReferences {
  barbershop: SeedBarbershopRecord
  users: SeedUserRecord[]
  professionals: SeedProfessionalRecord[]
  professionalsByKey: Record<string, SeedProfessionalRecord>
  services: SeedServiceRecord[]
  servicesByKey: Record<string, SeedServiceRecord>
  customers: SeedCustomerRecord[]
  customersByKey: Record<string, SeedCustomerRecord>
  categories: SeedCategoryRecord[]
  categoriesByKey: Record<string, SeedCategoryRecord>
  supplies: SeedSupplyRecord[]
  suppliesByKey: Record<string, SeedSupplyRecord>
}

export interface SeedOperationalMetrics {
  monthMetas: MonthMeta[]
  currentMonth: MonthMeta
  previousMonth: MonthMeta
  monthlyRevenueTotals: Record<string, number>
  monthlyExpenseTotals: Record<string, number>
  monthlyProfessionalRevenueTotals: Record<string, number>
}

export interface SeedSummary {
  demoPassword: string
  users: Array<{
    email: string
    role: UserRole
  }>
}

export interface RevenueEntryInput {
  id: string
  barbershopId: string
  customerId: string | null
  professionalId: string | null
  serviceId: string | null
  categoryId: string | null
  amount: number
  origin: 'SERVICE' | 'SUBSCRIPTION' | 'PRODUCT' | 'OTHER'
  paymentMethod: PaymentMethod
  date: Date
  description: string
  notes: string | null
}
