import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  AuthenticationRequiredError,
} from '@/lib/auth'
import {
  deleteProfessionalAvatarFile,
  isUploadedFileLike,
  storeProfessionalAvatarFile,
  ProfessionalAvatarUploadError,
} from '@/lib/professionals/avatar-storage'
import { revalidateProfessionalSurfaces } from '@/lib/professionals/revalidation'
import {
  assertCanManageProfessional,
  ensureResourceBelongsToBarbershop,
  requireAuthenticatedUser,
} from '@/lib/security/guards'
import { safeLog } from '@/lib/security/safe-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(
  request: Request,
  context: { params: { professionalId: string } }
) {
  try {
    const session = await requireAuthenticatedUser()
    assertCanManageProfessional(session.role, 'Sem permissao para alterar fotos da equipe.')

    const professionalId = context.params.professionalId
    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        barbershopId: true,
        avatar: true,
      },
    })

    if (!professional) {
      return jsonError('Profissional nao encontrado para este tenant.', 404)
    }
    ensureResourceBelongsToBarbershop(
      professional.barbershopId,
      session.barbershopId,
      'Profissional nao encontrado para este tenant.'
    )

    const formData = await request.formData()
    const uploadedFile = formData.get('file')

    if (!isUploadedFileLike(uploadedFile)) {
      return jsonError('Selecione uma imagem valida para continuar.', 400)
    }

    const storedAvatar = await storeProfessionalAvatarFile({
      file: uploadedFile,
      barbershopId: session.barbershopId,
      professionalId,
    })

    try {
      await prisma.professional.update({
        where: { id: professionalId },
        data: { avatar: storedAvatar.avatarUrl },
      })
    } catch (error) {
      await deleteProfessionalAvatarFile(storedAvatar.avatarUrl).catch(() => null)
      throw error
    }

    await deleteProfessionalAvatarFile(professional.avatar).catch(() => null)
    revalidateProfessionalSurfaces()

    return NextResponse.json(
      {
        success: true,
        avatarUrl: storedAvatar.avatarUrl,
      },
      { status: 200 }
    )
  } catch (error) {
    if (
      error instanceof AuthenticationRequiredError
      || (error instanceof Error && error.name === 'AuthenticationRequiredError')
    ) {
      return jsonError('Sessao expirada. Entre novamente para enviar a foto.', 401)
    }

    if (error instanceof Error && error.name === 'AuthorizationError') {
      return jsonError(error.message, 403)
    }

    if (
      error instanceof ProfessionalAvatarUploadError
      || (error instanceof Error && error.name === 'ProfessionalAvatarUploadError')
    ) {
      const uploadError = error as ProfessionalAvatarUploadError
      return jsonError(uploadError.message, uploadError.statusCode ?? 400)
    }

    safeLog('error', '[professional-avatar-upload] unexpected error', {
      professionalId: context.params.professionalId,
      error,
    })
    return jsonError('Nao foi possivel enviar a foto agora.', 500)
  }
}
