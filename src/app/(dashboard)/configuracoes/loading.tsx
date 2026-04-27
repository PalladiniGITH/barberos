function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[1rem] bg-[rgba(255,255,255,0.06)] ${className}`} />
}

export default function ConfiguracoesLoading() {
  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <section className="dashboard-panel overflow-hidden px-6 py-5">
        <div className="space-y-3">
          <SkeletonBlock className="h-10 w-60 max-w-full" />
          <SkeletonBlock className="h-4 w-[32rem] max-w-full" />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="dashboard-panel p-5">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-4 h-7 w-28" />
            <SkeletonBlock className="mt-3 h-4 w-36" />
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="dashboard-panel p-6">
          <SkeletonBlock className="h-6 w-56" />
          <SkeletonBlock className="mt-2 h-4 w-72 max-w-full" />
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <SkeletonBlock className="h-56 w-full" />
            <SkeletonBlock className="h-56 w-full" />
          </div>
        </div>

        <div className="space-y-5">
          <SkeletonBlock className="dashboard-panel h-44 w-full" />
          <SkeletonBlock className="dashboard-panel h-44 w-full" />
        </div>
      </div>
    </div>
  )
}
