'use client'

import { Toaster } from 'sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: { background: 'hsl(222,47%,10%)', border: '1px solid hsl(217,33%,20%)', color: 'hsl(210,40%,96%)' },
        }}
      />
    </>
  )
}
