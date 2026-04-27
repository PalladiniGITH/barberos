function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[1rem] bg-[rgba(255,255,255,0.06)] ${className}`} />
}

export default function IndicadoresLoading() {
  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <section className="dashboard-panel overflow-hidden px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <SkeletonBlock className="h-10 w-56 max-w-full" />
            <SkeletonBlock className="h-4 w-[32rem] max-w-full" />
          </div>
          <SkeletonBlock className="h-11 w-full max-w-[18rem]" />
        </div>
      </section>

      <section className="dashboard-panel dashboard-spotlight p-5 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <SkeletonBlock className="h-12 w-56 max-w-full" />
            <SkeletonBlock className="h-4 w-[34rem] max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <SkeletonBlock className="h-8 w-28" />
            <SkeletonBlock className="h-8 w-28" />
            <SkeletonBlock className="h-8 w-36" />
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface-tier-low p-4">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="mt-3 h-8 w-28" />
              <SkeletonBlock className="mt-3 h-3 w-36" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="dashboard-panel p-6">
          <SkeletonBlock className="h-6 w-44" />
          <SkeletonBlock className="mt-2 h-4 w-72 max-w-full" />
          <SkeletonBlock className="mt-6 h-[260px] w-full rounded-[1.1rem]" />
        </div>
        <div className="dashboard-panel p-6">
          <SkeletonBlock className="h-6 w-44" />
          <SkeletonBlock className="mt-2 h-4 w-72 max-w-full" />
          <SkeletonBlock className="mt-6 h-[260px] w-full rounded-[1.1rem]" />
        </div>
      </div>
    </div>
  )
}
