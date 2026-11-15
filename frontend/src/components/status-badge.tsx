import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  blue: "bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-500/30",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30",
  red: "bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30",
  gray: "bg-muted text-foreground/80 border-border",
} as const;

export type StatusTone = keyof typeof TONES;

export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

export const STATUS_META: Record<string, StatusMeta> = {
  // License statuses
  active: { label: "Aktif", tone: "green" },
  trial: { label: "Deneme", tone: "blue" },
  pending: { label: "Beklemede", tone: "amber" },
  suspended: { label: "Askıda", tone: "amber" },
  expired: { label: "Süresi Doldu", tone: "red" },
  // Application statuses
  applied: { label: "Başvuruldu", tone: "blue" },
  selected: { label: "Seçildi", tone: "green" },
  rejected: { label: "Sonuçlandı", tone: "gray" },
  // Interview statuses
  proposed: { label: "Mülakat Teklifi", tone: "blue" },
  confirmed: { label: "Onaylandı", tone: "green" },
  declined: { label: "Reddedildi", tone: "red" },
};

export function getStatusMeta(status: string, fallbackLabel?: string): StatusMeta {
  return STATUS_META[status] ?? { label: fallbackLabel ?? status, tone: "gray" };
}

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export function LicenseStatusBadge({ status }: { status: string }) {
  const meta = getStatusMeta(status);
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
}

export function UnifiedStatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const meta = getStatusMeta(status, label);
  return (
    <StatusBadge tone={meta.tone} className={className}>
      {label ?? meta.label}
    </StatusBadge>
  );
}
