import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  red: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  gray: "bg-muted text-muted-foreground border-border",
} as const;

const LICENSE_TONE: Record<string, keyof typeof TONES> = {
  active: "green",
  trial: "blue",
  pending: "amber",
  suspended: "amber",
  expired: "red",
};

export function StatusBadge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        TONES[tone],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function LicenseStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={LICENSE_TONE[status] ?? "gray"}>{status}</StatusBadge>;
}
