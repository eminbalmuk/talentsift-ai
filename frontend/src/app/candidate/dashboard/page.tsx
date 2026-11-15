"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  Gavel,
  LogOut,
  Search,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UploadCloud,
  User,
  Zap,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LogoFull } from "@/components/logo";
import { Markdown } from "@/components/markdown";
import { UnifiedStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiDelete, apiGet, apiPost, apiUpload, ApiError } from "@/lib/api";
import type {
  CandidateNotification,
  CandidateProfile,
  JobApplication,
  OpenJobPosting,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type DashboardTab = "jobs" | "profile" | "applications" | "notifications";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;

type ConfirmAction =
  | { type: "delete-cv" }
  | { type: "withdraw"; jobPostingId: number; jobTitle: string }
  | null;

function parseTabParam(value: string | null): DashboardTab | null {
  if (
    value === "jobs" ||
    value === "profile" ||
    value === "applications" ||
    value === "notifications"
  ) {
    return value;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function hasValidExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-card/75 px-4 py-3.5 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <Skeleton className="h-7 w-32" />
          <div className="flex items-center gap-3">
            <Skeleton className="hidden h-7 w-32 rounded-full md:block" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-9 w-full max-w-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-52 w-full rounded-xl" />
          <Skeleton className="h-52 w-full rounded-xl" />
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
      </main>
    </div>
  );
}

function CandidateDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tabOverride, setTabOverride] = useState<DashboardTab | null>(null);
  const activeTab: DashboardTab = tabOverride ?? parseTabParam(searchParams.get("tab")) ?? "jobs";

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [jobs, setJobs] = useState<OpenJobPosting[]>([]);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [notifications, setNotifications] = useState<CandidateNotification[]>([]);

  const [expandedNotificationId, setExpandedNotificationId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileMeta, setSelectedFileMeta] = useState<{ name: string; size: number } | null>(
    null,
  );
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const fetchDashboardSnapshot = useCallback(async () => {
    const [profResult, jobsData, appsData, notifData] = await Promise.all([
      apiGet<CandidateProfile>("/api/candidate/profile").catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }),
      apiGet<{ jobs: OpenJobPosting[] }>("/api/candidate/jobs"),
      apiGet<{ applications: JobApplication[] }>("/api/candidate/applications"),
      apiGet<{ notifications: CandidateNotification[] }>("/api/candidate/notifications"),
    ]);
    return {
      profile: profResult,
      jobs: jobsData.jobs,
      applications: appsData.applications,
      notifications: notifData.notifications,
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const snapshot = await fetchDashboardSnapshot();
      setProfile(snapshot.profile);
      setJobs(snapshot.jobs);
      setApplications(snapshot.applications);
      setNotifications(snapshot.notifications);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      toast.error(
        error instanceof ApiError ? error.message : "Veriler yüklenirken bir hata oluştu.",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchDashboardSnapshot, router]);

  useEffect(() => {
    let active = true;
    fetchDashboardSnapshot()
      .then((snapshot) => {
        if (!active) return;
        setProfile(snapshot.profile);
        setJobs(snapshot.jobs);
        setApplications(snapshot.applications);
        setNotifications(snapshot.notifications);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/candidate/login");
          return;
        }
        toast.error(
          error instanceof ApiError ? error.message : "Veriler yüklenirken bir hata oluştu.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchDashboardSnapshot, router]);

  function handleTabChange(nextValue: string) {
    const parsed = parseTabParam(nextValue);
    if (!parsed) return;
    setTabOverride(parsed);
    const target =
      parsed === "jobs" ? "/candidate/dashboard" : `/candidate/dashboard?tab=${parsed}`;
    router.replace(target, { scroll: false });
  }

  async function uploadCvFile(file: File) {
    if (!hasValidExtension(file.name)) {
      toast.error("Lütfen yalnızca PDF, Word (.docx), .txt veya .md dosyası yükleyin.");
      return;
    }
    if (file.size === 0) {
      toast.error("Yüklenen dosya boş olamaz.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Dosya boyutu en fazla 10 MB olabilir.");
      return;
    }

    setSelectedFileMeta({ name: file.name, size: file.size });
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      await apiUpload<{ status: string; message: string; profile: CandidateProfile }>(
        "/api/candidate/cv/upload",
        formData,
      );
      toast.success("CV başarıyla yüklendi ve profilinize işlendi.");
      await loadData();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "CV yüklenemedi.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadCvFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void uploadCvFile(file);
  }

  async function handleApply(jobPostingId: number) {
    if (!profile?.has_embedding) {
      toast.error("İlanlara başvurabilmek için önce CV profilinizi yüklemelisiniz.");
      handleTabChange("profile");
      return;
    }

    setApplyingJobId(jobPostingId);
    try {
      await apiPost(`/api/candidate/jobs/${jobPostingId}/apply`, {});
      toast.success("Başvurunuz anında iletildi!");
      await loadData();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Başvuru yapılamadı.");
    } finally {
      setApplyingJobId(null);
    }
  }

  async function handleConfirmedAction() {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      if (confirmAction.type === "delete-cv") {
        await apiDelete("/api/candidate/cv");
        setSelectedFileMeta(null);
        toast.success("CV profiliniz silindi.");
      } else {
        await apiPost(`/api/candidate/jobs/${confirmAction.jobPostingId}/withdraw`, {});
        toast.success("Başvurunuz geri çekildi.");
      }
      setConfirmAction(null);
      await loadData();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      toast.error(
        error instanceof ApiError
          ? error.message
          : confirmAction.type === "delete-cv"
            ? "CV silinemedi."
            : "Başvuru geri çekilemedi.",
      );
    } finally {
      setConfirmBusy(false);
    }
  }

  async function markNotificationRead(notificationId: number) {
    try {
      await apiPost(`/api/candidate/notifications/${notificationId}/read`, {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
      );
    } catch {
      // Non-critical -- read state will re-sync on next load.
    }
  }

  async function handleToggleNotification(notification: CandidateNotification) {
    const opening = expandedNotificationId !== notification.id;
    setExpandedNotificationId(opening ? notification.id : null);
    if (opening && !notification.is_read) {
      await markNotificationRead(notification.id);
    }
  }

  async function handleRespondInterview(interviewId: number, action: "confirm" | "decline") {
    try {
      await apiPost(`/api/candidate/interviews/${interviewId}/respond`, { action });
      toast.success(action === "confirm" ? "Mülakatı onayladınız." : "Mülakatı reddettiniz.");
      await loadData();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/candidate/login");
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Yanıt gönderilemedi.");
    }
  }

  async function handleLogout() {
    try {
      await apiPost("/api/candidate/logout", {});
      toast.success("Çıkış yapıldı.");
    } finally {
      router.push("/candidate/login");
    }
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  const appliedJobIds = new Set(applications.map((a) => a.job_posting_id));
  const unreadNotificationCount = notifications.filter((n) => !n.is_read).length;

  const filteredJobs = jobs.filter((job) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      job.title.toLowerCase().includes(q) ||
      job.organization_name.toLowerCase().includes(q) ||
      job.description.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-card/75 px-4 py-3.5 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <Link
            href="/candidate/dashboard"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogoFull height={28} />
          </Link>

          <div className="flex items-center gap-3">
            {profile ? (
              <div className="hidden items-center gap-1.5 rounded-full border border-border/40 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground md:flex">
                <User className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span className="font-medium text-foreground">{profile.full_name}</span>
              </div>
            ) : null}
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
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border/50 bg-card/50 p-5 backdrop-blur-sm sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Hoş Geldiniz{profile?.full_name ? `, ${profile.full_name}` : ""}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              CV&apos;niz bir kez profilleştirilir; tüm açık ilanlara tek tıkla anında başvurabilirsiniz.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {profile?.has_embedding ? (
              <Badge className="gap-1.5 border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                CV Profilleşti
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1.5 border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                CV Yüklenmesi Bekleniyor
              </Badge>
            )}
          </div>
        </div>

        {!profile?.has_embedding ? (
          <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Başlamaya hazır mısınız? İlk adım olarak CV&apos;nizi yükleyin
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Özgeçmişinizi bir kez yükledikten sonra yayınlanan tüm açık pozisyonlara tek tıkla başvurabilirsiniz.
                </p>
              </div>
            </div>
            {activeTab !== "profile" ? (
              <Button
                size="sm"
                onClick={() => handleTabChange("profile")}
                className="h-8 shrink-0 gap-1.5 text-xs"
              >
                <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                CV Yükle
              </Button>
            ) : null}
          </div>
        ) : null}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
          <TabsList className="mx-auto grid w-full max-w-xl grid-cols-4 sm:mx-0">
            <TabsTrigger value="jobs" className="gap-1.5 truncate px-1 text-xs sm:text-sm">
              <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate tabular-nums">
                İlanlar<span className="hidden sm:inline"> ({jobs.length})</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="profile" className="gap-1.5 truncate px-1 text-xs sm:text-sm">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                <span className="sm:hidden">Profil</span>
                <span className="hidden sm:inline">Profil &amp; CV</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="applications" className="gap-1.5 truncate px-1 text-xs sm:text-sm">
              <Send className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate tabular-nums">
                <span className="sm:hidden">Başvurular</span>
                <span className="hidden sm:inline">Başvurularım ({applications.length})</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5 truncate px-1 text-xs sm:text-sm">
              <span className="relative shrink-0">
                <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                {unreadNotificationCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary sm:hidden"
                  />
                ) : null}
              </span>
              <span className="truncate tabular-nums">
                <span className="sm:hidden">Bildirimler</span>
                <span className="hidden sm:inline">
                  Bildirimler{unreadNotificationCount > 0 ? ` (${unreadNotificationCount})` : ""}
                </span>
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Open Jobs Tab */}
          <TabsContent value="jobs" className="space-y-4">
            <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-border/50 bg-card/60 p-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  aria-label="İş İlanları Ara"
                  placeholder="İş İlanları Ara..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-9 text-xs sm:text-sm"
                />
              </div>
              <span className="self-end tabular-nums text-xs font-medium text-muted-foreground sm:self-center">
                {filteredJobs.length} ilan listeleniyor
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredJobs.length === 0 ? (
                <Card className="col-span-full border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {searchQuery
                      ? "Arama kriterlerine uyan ilan bulunamadı."
                      : "Şu an için yayında açık iş ilanı bulunmuyor."}
                  </p>
                </Card>
              ) : (
                filteredJobs.map((job) => {
                  const isApplied = appliedJobIds.has(job.id);
                  const isApplying = applyingJobId === job.id;

                  return (
                    <Card
                      key={job.id}
                      className="flex flex-col justify-between border-border/60 bg-card/80 shadow-sm backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-md"
                    >
                      <Link
                        href={`/candidate/jobs/${job.id}`}
                        className="block rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <CardHeader className="pb-3">
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                              {job.organization_name}
                            </span>
                            {job.deadline_at ? (
                              <span className="inline-flex items-center gap-1 tabular-nums text-[11px] font-medium text-muted-foreground">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                Son Başvuru:{" "}
                                {new Date(job.deadline_at).toLocaleDateString("tr-TR")}
                              </span>
                            ) : null}
                          </div>
                          <CardTitle className="text-base font-semibold leading-snug text-foreground transition-colors hover:text-primary">
                            {job.title}
                          </CardTitle>
                          <CardDescription className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                            {job.description}
                          </CardDescription>
                        </CardHeader>
                      </Link>
                      <CardContent className="pt-0">
                        {isApplied ? (
                          <Button
                            disabled
                            variant="secondary"
                            className="h-9 w-full gap-1.5 border border-emerald-500/30 bg-emerald-500/15 text-xs font-medium text-emerald-800 dark:text-emerald-300"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Başvuruldu
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleApply(job.id)}
                            disabled={isApplying || !profile?.has_embedding}
                            className="h-9 w-full gap-1.5 text-xs font-medium"
                          >
                            <Zap className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                            {isApplying ? "İletiliyor..." : "Tek Tıkla Başvur"}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* Profile & CV Tab */}
          <TabsContent value="profile" className="space-y-4">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UploadCloud className="h-4 w-4 text-primary" aria-hidden="true" />
                    CV Yükleme &amp; Profilleştirme
                  </CardTitle>
                  <CardDescription className="text-xs">
                    PDF, Word (.docx), .txt veya .md formatındaki CV&apos;niz yüklendiğinde otomatik ayrıştırılır ve UltraBERT profilinize işlenir. Bu işlem yalnızca 1 kez yapılır.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!uploading) setIsDragging(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!uploading) setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragging(false);
                    }}
                    onDrop={handleDrop}
                    className={cn(
                      "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                      isDragging
                        ? "border-primary bg-primary/10"
                        : "border-border/80 bg-muted/20 hover:border-primary/60",
                    )}
                  >
                    <UploadCloud
                      className={cn(
                        "mb-2 h-10 w-10 transition-colors",
                        isDragging ? "text-primary" : "text-muted-foreground",
                      )}
                      aria-hidden="true"
                    />
                    <p className="mb-1 text-xs font-medium text-foreground">
                      {uploading
                        ? "CV işleniyor ve profilinize aktarılıyor..."
                        : isDragging
                          ? "Dosyayı buraya bırakın"
                          : "CV dosyanızı sürükleyin veya seçin"}
                    </p>
                    <p className="mb-3 text-[11px] text-muted-foreground">
                      En fazla 10 MB &bull; .pdf, .docx, .txt, .md
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      aria-label="CV dosyası seç"
                      onChange={handleFileInputChange}
                      disabled={uploading}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={uploading}
                      className="pointer-events-none gap-1.5 text-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {uploading ? "Yükleniyor..." : "Dosya Seç"}
                    </Button>
                  </div>

                  {selectedFileMeta || profile?.source_path ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="truncate font-medium text-foreground">
                          {selectedFileMeta?.name ?? profile?.source_path}
                        </span>
                      </div>
                      {selectedFileMeta ? (
                        <Badge variant="secondary" className="shrink-0 tabular-nums text-[11px]">
                          {formatBytes(selectedFileMeta.size)}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}

                  {profile?.has_embedding ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>CV&apos;niz başarıyla profilleştirildi ve aramaya hazır.</span>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmAction({ type: "delete-cv" })}
                        className="h-8 w-full gap-1.5 text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        CV Profilimi Sil
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4 text-primary" aria-hidden="true" />
                    Özgeçmiş Profil Özeti
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Özgeçmişinizden otomatik çıkarılan yapılandırılmış profil bilgileri.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {profile ? (
                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between gap-2 border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">Üniversite:</span>
                        <span className="text-right font-semibold text-foreground">
                          {profile.university || "Belirtilmedi"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">GANO:</span>
                        <span className="tabular-nums font-semibold text-foreground">
                          {profile.gpa ? profile.gpa.toFixed(2) : "Belirtilmedi"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">Deneyim Süresi:</span>
                        <span className="tabular-nums font-semibold text-foreground">
                          {profile.experience_years != null
                            ? `${profile.experience_years} Yıl`
                            : "Belirtilmedi"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">Sınıf / Durum:</span>
                        <span className="tabular-nums font-semibold text-foreground">
                          {profile.current_class == null
                            ? "Belirtilmedi"
                            : profile.current_class >= 5
                              ? "Mezun"
                              : `${profile.current_class}. Sınıf`}
                        </span>
                      </div>
                      <div className="pt-1">
                        <span className="mb-2 block font-medium text-muted-foreground">
                          Öne Çıkan Yetenekler:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {profile.skills && profile.skills.length > 0 ? (
                            profile.skills.map((skill) => (
                              <Badge key={skill} variant="secondary" className="text-[11px]">
                                {skill}
                              </Badge>
                            ))
                          ) : (
                            <span className="italic text-muted-foreground">
                              Henüz yetenek çıkarılmadı.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/70 p-6 text-center">
                      <p className="text-xs font-medium text-foreground">
                        Henüz CV profiliniz oluşturulmadı
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sol taraftaki alandan özgeçmişinizi yüklediğinizde eğitim, deneyim ve yetenek özetiniz burada görüntülenecektir.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* My Applications Tab */}
          <TabsContent value="applications" className="space-y-4">
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Başvurularım</CardTitle>
                <CardDescription className="text-xs">
                  Şirketlere yaptığınız aktif ilan başvuruları ve durumları.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {applications.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    Henüz herhangi bir ilana başvurmadınız.
                  </p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {applications.map((app) => (
                      <div
                        key={app.application_id}
                        className="flex flex-col justify-between gap-2 py-3.5 sm:flex-row sm:items-center"
                      >
                        <div>
                          <Link
                            href={`/candidate/jobs/${app.job_posting_id}`}
                            className="text-sm font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {app.job_title}
                          </Link>
                          <p className="text-xs text-muted-foreground">{app.organization_name}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
                          <span className="flex items-center gap-1 tabular-nums text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {new Date(app.applied_at).toLocaleDateString("tr-TR")}
                          </span>
                          <UnifiedStatusBadge
                            status={app.status}
                            label={
                              app.status === "applied"
                                ? "Başvuruldu"
                                : app.status === "selected"
                                  ? "Mülakata seçildiniz"
                                  : app.status === "rejected"
                                    ? "Sonuçlandı"
                                    : undefined
                            }
                          />
                          {app.status === "applied" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setConfirmAction({
                                  type: "withdraw",
                                  jobPostingId: app.job_posting_id,
                                  jobTitle: app.job_title,
                                })
                              }
                              aria-label={`${app.job_title} başvurusunu geri çek`}
                              className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                            >
                              Geri Çek
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="space-y-4">
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Bildirimler</CardTitle>
                <CardDescription className="text-xs">
                  Başvuru sonuçları, mülakat davetleri ve Çok Ajanlı AI Jürisi değerlendirme raporları burada görünür.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {notifications.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    Henüz bir bildiriminiz yok.
                  </p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {notifications.map((notification) => {
                      const isExpanded = expandedNotificationId === notification.id;
                      const hasDebateReport = notification.final_score != null;
                      const isInterview = notification.type === "interview_proposed";
                      const badgeStatus =
                        notification.type === "selected"
                          ? "selected"
                          : isInterview
                            ? "proposed"
                            : "rejected";
                      const badgeLabel =
                        notification.type === "selected"
                          ? "Mülakata seçildiniz"
                          : isInterview
                            ? "Mülakat teklifi"
                            : "Sonuçlandı";
                      const panelId = `debate-report-${notification.id}`;

                      return (
                        <div key={notification.id} className="py-4">
                          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                            <div className="flex items-start gap-2">
                              {!notification.is_read ? (
                                <span
                                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                                  aria-label="Okunmamış bildirim"
                                />
                              ) : (
                                <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden="true" />
                              )}
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {notification.title}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {notification.job_title ?? "TalentSift AI"}
                                  {notification.organization_name
                                    ? ` · ${notification.organization_name}`
                                    : ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                              <span className="flex items-center gap-1 tabular-nums text-[11px] text-muted-foreground">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {new Date(notification.created_at).toLocaleDateString("tr-TR")}
                              </span>
                              <UnifiedStatusBadge status={badgeStatus} label={badgeLabel} />
                              {hasDebateReport ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  aria-expanded={isExpanded}
                                  aria-controls={panelId}
                                  onClick={() => handleToggleNotification(notification)}
                                  className="h-7 gap-1 px-2 text-xs"
                                >
                                  {isExpanded ? (
                                    <>
                                      Detayı Gizle
                                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                                    </>
                                  ) : (
                                    <>
                                      Detayı Gör
                                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                                    </>
                                  )}
                                </Button>
                              ) : !notification.is_read ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => markNotificationRead(notification.id)}
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                >
                                  Okundu işaretle
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          <p className="mt-2 pl-4 text-xs leading-relaxed text-muted-foreground">
                            {notification.message}
                          </p>

                          {isInterview && notification.interview_proposed_at ? (
                            <div className="ml-4 mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3.5">
                              <p className="tabular-nums text-sm font-semibold text-foreground">
                                {new Date(notification.interview_proposed_at).toLocaleString(
                                  "tr-TR",
                                )}
                              </p>
                              {notification.interview_location_or_link ? (
                                isHttpUrl(notification.interview_location_or_link) ? (
                                  <a
                                    href={notification.interview_location_or_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1.5 inline-flex items-center gap-1.5 break-all text-xs font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    {notification.interview_location_or_link}
                                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  </a>
                                ) : (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {notification.interview_location_or_link}
                                  </p>
                                )
                              ) : null}
                              {notification.interview_notes ? (
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                  {notification.interview_notes}
                                </p>
                              ) : null}
                              {notification.interview_status === "proposed" ? (
                                <div className="mt-3 flex gap-2">
                                  <Button
                                    size="sm"
                                    className="h-7 gap-1 text-xs"
                                    onClick={() =>
                                      notification.interview_schedule_id != null &&
                                      handleRespondInterview(
                                        notification.interview_schedule_id,
                                        "confirm",
                                      )
                                    }
                                  >
                                    Onayla
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 text-xs"
                                    onClick={() =>
                                      notification.interview_schedule_id != null &&
                                      handleRespondInterview(
                                        notification.interview_schedule_id,
                                        "decline",
                                      )
                                    }
                                  >
                                    Reddet
                                  </Button>
                                </div>
                              ) : (
                                <div className="mt-2">
                                  <UnifiedStatusBadge
                                    status={notification.interview_status ?? "proposed"}
                                    label={
                                      notification.interview_status === "confirmed"
                                        ? "Onayladınız"
                                        : "Reddettiniz"
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          ) : null}

                          {isExpanded && hasDebateReport ? (
                            <div
                              id={panelId}
                              className="ml-4 mt-4 space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4"
                            >
                              <div className="grid gap-3 text-center sm:grid-cols-3">
                                <div className="rounded-md border border-border/40 bg-background py-2.5">
                                  <ThumbsUp
                                    className="mx-auto mb-1 h-3.5 w-3.5 text-emerald-600"
                                    aria-hidden="true"
                                  />
                                  <div className="text-[11px] text-muted-foreground">İyimser</div>
                                  <div className="tabular-nums text-sm font-semibold text-foreground">
                                    {notification.optimist_score ?? "—"}
                                  </div>
                                </div>
                                <div className="rounded-md border border-border/40 bg-background py-2.5">
                                  <ThumbsDown
                                    className="mx-auto mb-1 h-3.5 w-3.5 text-red-600"
                                    aria-hidden="true"
                                  />
                                  <div className="text-[11px] text-muted-foreground">Kötümser</div>
                                  <div className="tabular-nums text-sm font-semibold text-foreground">
                                    {notification.pessimist_score ?? "—"}
                                  </div>
                                </div>
                                <div className="rounded-md border border-primary/20 bg-primary/5 py-2.5">
                                  <Gavel
                                    className="mx-auto mb-1 h-3.5 w-3.5 text-primary"
                                    aria-hidden="true"
                                  />
                                  <div className="text-[11px] text-muted-foreground">Nihai Puan</div>
                                  <div className="tabular-nums text-sm font-semibold text-foreground">
                                    {Number(notification.final_score).toFixed(1)}
                                  </div>
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold text-foreground">
                                  Hakem Gerekçesi
                                </p>
                                <Markdown>{notification.arbitrator_rationale ?? ""}</Markdown>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold text-foreground">
                                  İyimser Ajanın Argümanları
                                </p>
                                <Markdown>{notification.optimist_arguments ?? ""}</Markdown>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold text-foreground">
                                  Kötümser Ajanın Risk Değerlendirmesi
                                </p>
                                <Markdown>{notification.pessimist_arguments ?? ""}</Markdown>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={
          confirmAction?.type === "delete-cv"
            ? "CV profilini sil"
            : "Başvuruyu geri çek"
        }
        description={
          confirmAction?.type === "delete-cv"
            ? "CV profilinizi silmek istediğinizden emin misiniz? Yeni ilanlara başvurabilmek için tekrar CV yüklemeniz gerekecektir."
            : confirmAction?.type === "withdraw"
              ? `"${confirmAction.jobTitle}" ilanına yaptığınız başvuruyu geri çekmek istediğinizden emin misiniz?`
              : ""
        }
        confirmLabel={
          confirmAction?.type === "delete-cv" ? "CV Profilimi Sil" : "Başvuruyu Geri Çek"
        }
        variant="destructive"
        busy={confirmBusy}
        onConfirm={handleConfirmedAction}
      />
    </div>
  );
}

export default function CandidateDashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <CandidateDashboardContent />
    </Suspense>
  );
}
