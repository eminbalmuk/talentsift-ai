import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("border-border/60 shadow-sm", className)}>
      <CardContent className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </div>
      </CardContent>
    </Card>
  );
}
