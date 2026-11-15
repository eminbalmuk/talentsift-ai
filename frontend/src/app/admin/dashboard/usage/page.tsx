"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Activity, AlertTriangle, CheckCircle2, Coins, RefreshCw, XCircle } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("tr-TR");
}

export default function AdminUsagePage() {
  const [summary, setSummary] = useState<MistralUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsage = useCallback(async () => {
    try {
      const data = await apiGet<MistralUsageSummary>("/api/admin/mistral-usage");
      setSummary(data);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Kullanım özeti yüklenemedi.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const data = await apiGet<MistralUsageSummary>("/api/admin/mistral-usage");
        if (!cancelled) setSummary(data);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof ApiError ? error.message : "Kullanım özeti yüklenemedi.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await loadUsage();
  }

  const totals = summary?.totals ?? { call_count: 0, error_count: 0, total_tokens: 0 };
  const successRate =
    totals.call_count > 0
      ? `${(((totals.call_count - totals.error_count) / totals.call_count) * 100).toFixed(1)}%`
      : "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Mistral LLM Kullanım Telemetrisi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI jüri (Optimist, Pessimist, Hakem) çağrı sayıları, hata oranları ve token tüketimi.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing || loading}
          onClick={() => void handleRefresh()}
          className="w-fit gap-1.5"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          {refreshing ? "Yenileniyor..." : "Yenile"}
        </Button>
      </div>

      {/* Totals */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up">
          <StatCard
            label="Toplam Çağrı"
            value={formatNumber(totals.call_count)}
            icon={Activity}
            className="hover-lift"
          />
          <StatCard
            label="Başarılı Oran"
            value={successRate}
            icon={CheckCircle2}
            className="hover-lift"
          />
          <StatCard
            label="Hatalı Çağrı"
            value={formatNumber(totals.error_count)}
            icon={AlertTriangle}
            className={cn(
              "hover-lift",
              totals.error_count > 0 && "border-red-500/40 bg-red-500/5",
            )}
          />
          <StatCard
            label="Toplam Token"
            value={formatNumber(totals.total_tokens)}
            icon={Coins}
            className="hover-lift"
          />
        </div>
      )}

      {/* By model breakdown */}
      <Card className="border-border/60 animate-fade-in-up animate-stagger-1">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Model Bazlı Dağılım</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:px-6 sm:pb-6">
          {loading ? (
            <div className="flex flex-col gap-3 px-6 pb-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (summary?.by_model.length ?? 0) === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Henüz kaydedilmiş Mistral API çağrısı yok.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Çağrı</TableHead>
                    <TableHead>Hata</TableHead>
                    <TableHead>Token Payı</TableHead>
                    <TableHead>Toplam Token</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary?.by_model.map((row) => {
                    const share =
                      totals.total_tokens > 0
                        ? Math.round((row.total_tokens / totals.total_tokens) * 100)
                        : 0;
                    return (
                      <TableRow key={row.model}>
                        <TableCell className="font-mono text-xs font-medium text-foreground">
                          {row.model}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatNumber(row.call_count)}</TableCell>
                        <TableCell className="tabular-nums">
                          {row.error_count > 0 ? (
                            <span className="font-medium text-red-700 dark:text-red-300">
                              {formatNumber(row.error_count)}
                            </span>
                          ) : (
                            formatNumber(row.error_count)
                          )}
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
                              %{share}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums font-medium">
                          {formatNumber(row.total_tokens)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent calls */}
      <Card className="border-border/60 animate-fade-in-up animate-stagger-2">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Son API Çağrıları</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:px-6 sm:pb-6">
          {loading ? (
            <div className="flex flex-col gap-3 px-6 pb-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (summary?.recent.length ?? 0) === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Kayıtlı çağrı bulunamadı.
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zaman</TableHead>
                      <TableHead>Kurum</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Uç Nokta</TableHead>
                      <TableHead>Token</TableHead>
                      <TableHead>Durum</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary?.recent.map((call, index) => (
                      <TableRow key={`${call.created_at}-${index}`}>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {formatDateTime(call.created_at)}
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {call.organization_name ?? "Platform"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-foreground">
                          {call.model}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {call.endpoint}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatNumber(call.total_tokens)}
                        </TableCell>
                        <TableCell>
                          {call.success ? (
                            <StatusBadge tone="green">Başarılı</StatusBadge>
                          ) : (
                            <StatusBadge tone="red">Hata</StatusBadge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="flex flex-col gap-2.5 px-4 pb-4 md:hidden">
                {summary?.recent.map((call, index) => (
                  <div
                    key={`${call.created_at}-${index}`}
                    className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/70 p-3.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">
                        {call.organization_name ?? "Platform"}
                      </span>
                      {call.success ? (
                        <StatusBadge tone="green">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Başarılı
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="red">
                          <XCircle className="h-3 w-3" aria-hidden="true" />
                          Hata
                        </StatusBadge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span className="font-mono text-foreground">{call.model}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {call.endpoint}
                      </Badge>
                      <span className="tabular-nums">{formatNumber(call.total_tokens)} token</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {formatDateTime(call.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
