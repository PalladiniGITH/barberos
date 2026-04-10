'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteExpense } from '@/actions/financeiro'

export function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState(false)

  async function handleDelete() {
    if (!confirm) {
      setConfirm(true)
      setTimeout(() => setConfirm(false), 3000)
      return
    }
    setLoading(true)
    const result = await deleteExpense(id)
    if (result.success) {
      toast.success('Despesa excluída')
      router.refresh()
    } else {
      toast.error(result.error)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${
        confirm
          ? 'bg-red-600 text-white hover:bg-red-700'
          : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
      }`}
      title={confirm ? 'Clique novamente para confirmar' : 'Excluir'}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      {confirm ? 'Confirmar' : ''}
    </button>
  )
}
