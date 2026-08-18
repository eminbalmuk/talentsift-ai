"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Coins, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet, ApiError } from "@/lib/api";
import type { MistralUsageSummary } from "@/lib/types";

const WINDOW_OPTIONS = [
  { value: "24", label: "Son 24 saat" },
  { value: "168", label: "Son 7 gün" },
  { value: "720", label: "Son 30 gün" },
];

export default function AdminUsagePage() {
  const [hours, setHours] = useState("24");
  const [summary, setSummary] = useState<MistralUsageSummary | null>(null);

  const load = useCallback(async (windowHours: string) => {
    try {
      const data = await apiGet<MistralUsageSummary>(
        `/api/admin/mistral-usage?hours=${windowHours}`,
      );
      setSummary(data);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Kullanım verisi yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on window change
    load(hours);
  }, [hours, load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Mistral Kullanımı</h1>
          <p className="text-sm text-muted-foreground">
            Platform genelinde yapılan tüm Mistral API çağrıları.
          </p>
        </div>
        <Select value={hours} onValueChange={(value) => value && setHours(value)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Toplam çağrı" value={summary?.totals.call_count ?? 0} icon={Phone} />
        <StatCard label="Toplam token" value={summary?.totals.total_tokens ?? 0} icon={Coins} />
        <StatCard label="Hatalı çağrı" value={summary?.totals.error_count ?? 0} icon={AlertCircle} />
      </div>

      <Card className="overflow-hidden border-border/60 p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Model</TableHead>
              <TableHead>Çağrı</TableHead>
              <TableHead>Hata</TableHead>
              <TableHead>Token</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary?.by_model.map((row) => (
              <TableRow key={row.model}>
                <TableCell className="font-mono text-xs font-medium">{row.model}</TableCell>
                <TableCell>{row.call_count}</TableCell>
                <TableCell className={row.error_count > 0 ? "text-destructive" : undefined}>
                  {row.error_count}
                </TableCell>
                <TableCell>{row.total_tokens.toLocaleString("tr-TR")}</TableCell>
              </TableRow>
            ))}
            {summary?.by_model.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  Bu zaman aralığında çağrı yapılmamış.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground">Son çağrılar</h2>
        <Card className="overflow-hidden border-border/60 p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Model</TableHead>
                <TableHead className="hidden sm:table-cell">Uç nokta</TableHead>
                <TableHead className="hidden md:table-cell">Organizasyon</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="hidden lg:table-cell">Zaman</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary?.recent.map((call, index) => (
                <TableRow key={index}>
                  <TableCell className="font-mono text-xs">{call.model}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {call.endpoint}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {call.organization_name ?? "—"}
                  </TableCell>
                  <TableCell>{call.total_tokens ?? "—"}</TableCell>
                  <TableCell>
                    {call.success ? (
                      <StatusBadge tone="green">Başarılı</StatusBadge>
                    ) : (
                      <StatusBadge tone="red">Hata</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {new Date(call.created_at).toLocaleString("tr-TR")}
                  </TableCell>
                </TableRow>
              ))}
              {summary?.recent.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Henüz çağrı yok.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
