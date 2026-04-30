import { revalidatePath } from 'next/cache'

const PROFESSIONAL_SURFACE_PATHS = [
  '/equipe/profissionais',
  '/equipe',
  '/equipe/desempenho',
  '/equipe/metas',
  '/agendamentos',
  '/dashboard',
] as const

export function revalidateProfessionalSurfaces() {
  PROFESSIONAL_SURFACE_PATHS.forEach((path) => revalidatePath(path))
}

