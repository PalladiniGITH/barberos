'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserX, UserCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { toggleProfessionalActive } from '@/actions/equipe'

export function ToggleActiveButton({ id, active }: { id: string; active: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handle() {
    setLoading(true)
    const result = await toggleProfessionalActive(id)
    if (result.success) {
      toast.success(active ? 'Profissional desativado' : 'Profissional reativado')
      router.refresh()
    } else {
      toast.error(result.error)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
      title={active ? 'Desativar' : 'Reativar'}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : active ? (
        <UserX className="w-3.5 h-3.5" />
      ) : (
        <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
      )}
    </button>
  )
}
