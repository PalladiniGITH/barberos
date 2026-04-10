'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CheckCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { markExpensePaid } from '@/actions/financeiro'

export function MarkPaidButton({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handlePaid() {
    setLoading(true)
    const result = await markExpensePaid(id)
    if (result.success) {
      toast.success('Despesa marcada como paga')
      router.refresh()
    } else {
      toast.error(result.error)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handlePaid}
      disabled={loading}
      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
      Pagar
    </button>
  )
}
