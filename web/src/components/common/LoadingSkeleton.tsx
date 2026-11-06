import { Skeleton } from "@/components/ui/primitives";

export function LoadingSkeleton({ variant = "list", rows = 5 }: { variant?: "list" | "cards" | "page" | "table"; rows?: number }) {
  if (variant === "cards")
    return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Loading" role="status">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-3xl" />
        ))}
      </div>
    );
  if (variant === "page")
    return (
      <div className="space-y-6" role="status" aria-label="Loading">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-5 w-96" />
        <LoadingSkeleton variant="cards" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="col-span-2 h-80 rounded-3xl" />
          <Skeleton className="h-80 rounded-3xl" />
        </div>
      </div>
    );
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3 rounded-full" />
            <Skeleton className="h-3 w-1/2 rounded-full" />
          </div>
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}
