import {
  assertAdministrativeRole,
  assertPlatformRoleAllowed,
  assertRoleAllowed,
  AuthorizationError,
  requireSession,
} from '@/lib/auth'
import type { AppRole, PlatformRole } from '@/lib/auth-routes'

export type AuthenticatedUserContext = Awaited<ReturnType<typeof requireSession>>['user']

export async function requireAuthenticatedUser() {
  const session = await requireSession()

  return {
    session,
    userId: session.user.id,
    role: session.user.role,
    platformRole: session.user.platformRole,
    barbershopId: session.user.barbershopId,
    barbershopSlug: session.user.barbershopSlug,
    barbershopName: session.user.barbershopName,
  }
}

export function requireBarbershopContext(
  user: Pick<AuthenticatedUserContext, 'barbershopId'> | null | undefined,
  message = 'Contexto de tenant ausente para esta operacao.'
) {
  const barbershopId = user?.barbershopId?.trim()

  if (!barbershopId) {
    throw new AuthorizationError(message)
  }

  return barbershopId
}

export function requireRole(
  role: string | null | undefined,
  allowedRoles: AppRole[],
  message = 'Sem permissao para executar esta operacao.'
) {
  return assertRoleAllowed(role, allowedRoles, message)
}

export async function requirePlatformAdmin(
  allowedRoles: PlatformRole[] = ['PLATFORM_ADMIN', 'PLATFORM_OWNER']
) {
  const session = await requireSession()
  const platformRole = assertPlatformRoleAllowed(
    session.user.platformRole,
    allowedRoles,
    'Sem permissao para acessar a operacao interna da plataforma.'
  )

  return {
    session,
    userId: session.user.id,
    platformRole,
  }
}

export function ensureResourceBelongsToBarbershop(
  resourceBarbershopId: string | null | undefined,
  sessionBarbershopId: string | null | undefined,
  message = 'Recurso fora do tenant atual.'
) {
  if (
    !resourceBarbershopId
    || !sessionBarbershopId
    || resourceBarbershopId !== sessionBarbershopId
  ) {
    throw new AuthorizationError(message)
  }
}

export function assertCanManageProfessional(
  role: string | null | undefined,
  message = 'Sem permissao para alterar configuracoes administrativas da equipe.'
) {
  return assertAdministrativeRole(role, message)
}

export function assertCanManageAppointment(
  role: string | null | undefined,
  options?: {
    allowBarber?: boolean
    message?: string
  }
) {
  const allowBarber = options?.allowBarber ?? true
  const allowedRoles: AppRole[] = allowBarber
    ? ['OWNER', 'MANAGER', 'FINANCIAL', 'BARBER']
    : ['OWNER', 'MANAGER', 'FINANCIAL']

  return requireRole(
    role,
    allowedRoles,
    options?.message ?? 'Sem permissao para operar este agendamento.'
  )
}

export function assertCanManageFinance(
  role: string | null | undefined,
  message = 'Sem permissao para alterar dados financeiros da barbearia.'
) {
  return assertAdministrativeRole(role, message)
}
