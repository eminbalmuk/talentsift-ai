"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gavel, GraduationCap, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { Candidate, DebateResult } from "@/lib/types";

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const candidateId = params.id;

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobDescription, setJobDescription] = useState("");
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ candidate: Candidate; debate: DebateResult | null }>(
        `/api/org/candidates/${candidateId}`,
      );
      setCandidate(data.candidate);
      setDebate(data.debate);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Aday yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function handleRunDebate(event: React.FormEvent) {
    event.preventDefault();
    if (!jobDescription.trim()) {
      toast.error("Değerlendirme için bir iş tanımı girin.");
      return;
    }
    setRunning(true);
    try {
      const result = await apiPost<DebateResult>("/api/org/debate", {
        candidate_id: Number(candidateId),
        job_description: jobDescription,
      });
      setDebate(result);
      toast.success("Çoklu ajan değerlendirmesi tamamlandı.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Değerlendirme başarısız oldu.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!candidate) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-4">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-lg">{candidate.full_name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GraduationCap className="h-4 w-4" />
              {candidate.university ?? "Üniversite belirtilmemiş"}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-md bg-muted/60 py-2">
                <div className="text-xs text-muted-foreground">GANO</div>
                <div className="font-medium">{candidate.gpa ?? "—"}</div>
              </div>
              <div className="rounded-md bg-muted/60 py-2">
                <div className="text-xs text-muted-foreground">Sınıf</div>
                <div className="font-medium">
                  {candidate.current_class === 5 ? "Mezun" : candidate.current_class}
                </div>
              </div>
              <div className="rounded-md bg-muted/60 py-2">
                <div className="text-xs text-muted-foreground">Deneyim</div>
                <div className="font-medium">{candidate.experience_years} yıl</div>
              </div>
            </div>
            {candidate.skills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {candidate.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="font-normal">
                    {skill}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {candidate.raw_cv_text ? (
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-sm">CV metni</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {candidate.raw_cv_text}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-sm">Yeni değerlendirme çalıştır</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRunDebate} className="flex flex-col gap-3">
              <Textarea
                placeholder="Bu adayın değerlendirileceği iş tanımını yazın..."
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                rows={3}
              />
              <Button type="submit" disabled={running} className="self-start">
                {running ? "İyimser, kötümser ve hakem ajanlar çalışıyor..." : "Değerlendirmeyi başlat"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {debate ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-border/60">
                <CardContent className="flex flex-col items-center gap-1 py-4">
                  <ThumbsUp className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs text-muted-foreground">İyimser</span>
                  <span className="text-xl font-semibold">{debate.optimist_score}</span>
                </CardContent>
              </Card>
              <Card className="border-border/60">
                <CardContent className="flex flex-col items-center gap-1 py-4">
                  <ThumbsDown className="h-4 w-4 text-red-500" />
                  <span className="text-xs text-muted-foreground">Kötümser</span>
                  <span className="text-xl font-semibold">{debate.pessimist_score}</span>
                </CardContent>
              </Card>
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="flex flex-col items-center gap-1 py-4">
                  <Gavel className="h-4 w-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Nihai puan</span>
                  <span className="text-xl font-semibold">{Number(debate.final_score).toFixed(1)}</span>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/60">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Hakem gerekçesi</CardTitle>
                {debate.is_selected ? (
                  <StatusBadge tone="green">Seçildi</StatusBadge>
                ) : (
                  <StatusBadge tone="gray">Beklemede</StatusBadge>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{debate.arbitrator_rationale}</p>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ThumbsUp className="h-4 w-4 text-emerald-500" />
                    İyimser ajanın argümanları
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{debate.optimist_arguments}</p>
                </CardContent>
              </Card>
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ThumbsDown className="h-4 w-4 text-red-500" />
                    Kötümser ajanın riskleri
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{debate.pessimist_arguments}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <Card className="border-dashed border-border/60 bg-muted/30">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Bu aday için henüz bir değerlendirme çalıştırılmadı.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
