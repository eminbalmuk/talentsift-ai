"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Award, CheckCircle2, TrendingUp, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, ApiError } from "@/lib/api";
import type { TopResult } from "@/lib/types";

export default function OrgOverviewPage() {
  const [results, setResults] = useState<TopResult[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ results: TopResult[] }>("/api/org/rankings/top?limit=10");
      setResults(data.results);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sıralama yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  const stats = useMemo(() => {
    if (!results || results.length === 0) {
      return { count: 0, average: 0, top: 0, selected: 0 };
    }
    const scores = results.map((result) => Number(result.final_score));
    return {
      count: results.length,
      average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      top: Math.max(...scores),
      selected: results.filter((result) => result.is_selected).length,
    };
  }, [results]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Değerlendirilen aday" value={stats.count} icon={Users} />
        <StatCard label="Ortalama puan" value={stats.average.toFixed(1)} icon={TrendingUp} />
        <StatCard label="En yüksek puan" value={stats.top.toFixed(1)} icon={Award} />
        <StatCard label="Seçilen aday" value={stats.selected} icon={CheckCircle2} />
      </div>

      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Nihai sıralama</h1>
        <p className="text-sm text-muted-foreground">
          İyimser / kötümser / hakem ajan sürecinden geçen adayların son puanları.
        </p>
      </div>

      <Card className="overflow-hidden border-border/60 p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Aday</TableHead>
              <TableHead>Üniversite</TableHead>
              <TableHead>Nihai puan</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Gerekçe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results?.map((result) => (
              <TableRow key={result.candidate_id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/org/dashboard/candidates/${result.candidate_id}`}
                    className="hover:underline"
                  >
                    {result.full_name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{result.university ?? "—"}</TableCell>
                <TableCell className="font-medium">{Number(result.final_score).toFixed(1)}</TableCell>
                <TableCell>
                  {result.is_selected ? (
                    <StatusBadge tone="green">Seçildi</StatusBadge>
                  ) : (
                    <StatusBadge tone="gray">Beklemede</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground">
                  {result.arbitrator_rationale}
                </TableCell>
              </TableRow>
            ))}
            {results?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Henüz değerlendirme yapılmadı. Adaylar sekmesinden bir değerlendirme başlatın.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
