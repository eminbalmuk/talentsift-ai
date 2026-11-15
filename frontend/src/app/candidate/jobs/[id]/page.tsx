"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileWarning,
  LogOut,
  Zap,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LogoFull } from "@/components/logo";
import { UnifiedStatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { CandidateProfile, JobApplication, OpenJobPosting } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const fetchJobSnapshot = useCallback(async () => {
    const [jobData, profResult, appsData] = await Promise.all([
      apiGet<{ job: OpenJobPosting }>(`/api/candidate/jobs/${jobId}`),
      apiGet<CandidateProfile>("/api/candidate/profile").catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }),
      apiGet<{ applications: JobApplication[] }>("/api/candidate/applications"),
    ]);
    return {
      job: jobData.job,
      profile: profResult,
      applications: appsData.applications,
    };
  }, [jobId]);

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchJobSnapshot();
      setJob(snapshot.job);
      setProfile(snapshot.profile);
      setApplications(snapshot.applications);
      setNotFound(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setNotFound(true);
      } else {
        toast.error(error instanceof ApiError ? error.message : "İlan yüklenemedi.");
      }
    } finally {
      setLoading(false);
    }
  }, [fetchJobSnapshot, router]);

  useEffect(() => {
    let active = true;
    fetchJobSnapshot()
      .then((snapshot) => {
        if (!active) return;
        setJob(snapshot.job);
        setProfile(snapshot.profile);
        setApplications(snapshot.applications);
        setNotFound(false);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/candidate/login");
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          toast.error(error instanceof ApiError ? error.message : "İlan yüklenemedi.");
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchJobSnapshot, router]);

  const application = applications.find((a) => a.job_posting_id === jobId);

  async function handleApply() {
    if (!profile?.has_embedding) {
      toast.error("İlanlara başvurabilmek için önce CV profilinizi yüklemelisiniz.");
      return;
    }
    setApplying(true);
    try {
      await apiPost(`/api/candidate/jobs/${jobId}/apply`, {});
      toast.success("Başvurunuz anında iletildi!");
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Başvuru yapılamadı.");
    } finally {
      setApplying(false);
    }
  }

  async function handleConfirmWithdraw() {
    setWithdrawing(true);
    try {
      await apiPost(`/api/candidate/jobs/${jobId}/withdraw`, {});
      toast.success("Başvurunuz geri çekildi.");
      setWithdrawOpen(false);
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Başvuru geri çekilemedi.");
    } finally {
      setWithdrawing(false);
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
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-card/75 px-4 py-3.5 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <Link
            href="/candidate/dashboard"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogoFull height={28} />
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Çıkış
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <nav aria-label="Sayfa yolu" className="mb-4">
          <Link
            href="/candidate/dashboard"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            İlanlara Dön
          </Link>
        </nav>

        {loading ? (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="space-y-3 pb-4">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <div className="border-t border-border/40 pt-5">
                <Skeleton className="h-9 w-40" />
              </div>
            </CardContent>
          </Card>
        ) : notFound || !job ? (
          <Card className="border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Bu ilan artık yayında değil veya bulunamadı.
            </p>
            <Link
              href="/candidate/dashboard"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}
            >
              Açık İlanlara Dön
            </Link>
          </Card>
        ) : (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                {job.organization_name}
              </div>
              <CardTitle className="text-xl font-bold leading-snug sm:text-2xl">
                {job.title}
              </CardTitle>
              {job.deadline_at ? (
                <div className="mt-2 flex items-center gap-1.5 tabular-nums text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  Son Başvuru: {formatDate(job.deadline_at)}
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {job.description}
              </p>

              <div className="flex flex-col gap-3 border-t border-border/40 pt-5">
                {application ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <UnifiedStatusBadge
                        status={application.status}
                        label={
                          application.status === "applied"
                            ? "Başvuruldu"
                            : application.status === "selected"
                              ? "Mülakata Seçildiniz"
                              : application.status === "rejected"
                                ? "Sonuçlandı"
                                : undefined
                        }
                      />
                      <span className="inline-flex items-center gap-1 tabular-nums text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        {formatDate(application.applied_at)}
                      </span>
                    </div>
                    {application.status === "applied" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWithdrawOpen(true)}
                        className="h-8 w-fit text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        Başvuruyu Geri Çek
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <Button
                      onClick={handleApply}
                      disabled={applying || !profile?.has_embedding}
                      className="h-9 w-fit gap-1.5 text-xs font-medium"
                    >
                      <Zap className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      {applying ? "İletiliyor..." : "Tek Tıkla Başvur"}
                    </Button>
                    {!profile?.has_embedding ? (
                      <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <FileWarning className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            İlanlara başvurabilmek için önce CV&apos;nizi yükleyip profilinizi oluşturmalısınız.
                          </span>
                        </div>
                        <Link
                          href="/candidate/dashboard?tab=profile"
                          className={cn(
                            buttonVariants({ size: "sm", variant: "outline" }),
                            "h-7 shrink-0 border-amber-500/40 bg-background text-xs",
                          )}
                        >
                          CV Yükle
                        </Link>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title="Başvuruyu geri çek"
        description={
          job
            ? `"${job.title}" ilanına yaptığınız başvuruyu geri çekmek istediğinizden emin misiniz?`
            : "Başvurunuzu geri çekmek istediğinizden emin misiniz?"
        }
        confirmLabel="Başvuruyu Geri Çek"
        variant="destructive"
        busy={withdrawing}
        onConfirm={handleConfirmWithdraw}
      />
    </div>
  );
}
