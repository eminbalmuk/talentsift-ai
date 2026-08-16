"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Building2, CalendarClock, CheckCircle2, LogOut, Zap } from "lucide-react";
import { LogoFull } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { CandidateProfile, JobApplication, OpenJobPosting } from "@/lib/types";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = Number(params.id);

  const [job, setJob] = useState<OpenJobPosting | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobData, profData, appsData] = await Promise.all([
        apiGet<{ job: OpenJobPosting }>(`/api/candidate/jobs/${jobId}`),
        apiGet<CandidateProfile>("/api/candidate/profile").catch(() => null),
        apiGet<{ applications: JobApplication[] }>("/api/candidate/applications").catch(
          () => ({ applications: [] }),
        ),
      ]);
      setJob(jobData.job);
      if (profData) setProfile(profData);
      setApplications(appsData.applications);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setNotFound(true);
      } else {
        toast.error(error instanceof ApiError ? error.message : "İlan yüklenemedi.");
      }
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  const application = applications.find((a) => a.job_posting_id === jobId);

  async function handleApply() {
    if (!profile?.has_embedding) {
      toast.error("İlanlara başvurabilmek için önce CV profilinizi yüklemelisiniz.");
      return;
    }
    setApplying(true);
    try {
      await apiPost(`/api/candidate/jobs/${jobId}/apply`, {});
      toast.success("Başvurunuz anında iletildi! ($O(1)$ sıfır beklemeli başvuru)");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Başvuru yapılamadı.");
    } finally {
      setApplying(false);
    }
  }

  async function handleWithdraw() {
    if (!confirm("Başvurunuzu geri çekmek istediğinizden emin misiniz?")) return;
    try {
      await apiPost(`/api/candidate/jobs/${jobId}/withdraw`, {});
      toast.success("Başvurunuz geri çekildi.");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Başvuru geri çekilemedi.");
    }
  }

  async function handleLogout() {
    try {
      await apiPost("/api/candidate/logout", {});
    } finally {
      router.push("/candidate/login");
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/60 bg-card/60 backdrop-blur-md sticky top-0 z-20 px-4 sm:px-6 py-3.5">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <Link href="/candidate/dashboard" className="flex items-center gap-2.5">
            <LogoFull height={28} />
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Çıkış
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6 py-6 sm:py-8">
        <Link
          href="/candidate/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          İlanlara dön
        </Link>

        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : notFound || !job ? (
          <Card className="border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Bu ilan artık yayında değil veya bulunamadı.
            </p>
          </Card>
        ) : (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                <Building2 className="h-3.5 w-3.5" />
                {job.organization_name}
              </div>
              <CardTitle className="text-xl sm:text-2xl font-bold leading-snug">
                {job.title}
              </CardTitle>
              {job.deadline_at && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Son başvuru: {formatDate(job.deadline_at)}
                </div>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
                {job.description}
              </p>

              <div className="flex flex-col gap-2 border-t border-border/40 pt-5">
                {application ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <Badge className="w-fit gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 px-3 py-1.5 text-xs font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Başvuruldu · {formatDate(application.applied_at)}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleWithdraw}
                      className="text-xs h-8 w-fit"
                    >
                      Başvuruyu Geri Çek
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button
                      onClick={handleApply}
                      disabled={applying || !profile?.has_embedding}
                      className="w-fit gap-1.5 text-xs font-medium h-9"
                    >
                      <Zap className="h-3.5 w-3.5 fill-current" />
                      {applying ? "İletiliyor..." : "Tek Tıkla Başvur"}
                    </Button>
                    {!profile?.has_embedding && (
                      <p className="text-xs text-muted-foreground">
                        Başvurabilmek için önce{" "}
                        <Link href="/candidate/dashboard" className="text-primary underline">
                          CV&apos;nizi yükleyin
                        </Link>
                        .
                      </p>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
