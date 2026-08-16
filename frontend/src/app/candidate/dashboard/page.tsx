"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Briefcase,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  GraduationCap,
  LogOut,
  Search,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  User,
  Zap,
} from "lucide-react";
import { LogoFull } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import type { CandidateProfile, JobApplication, OpenJobPosting } from "@/lib/types";

export default function CandidateDashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [jobs, setJobs] = useState<OpenJobPosting[]>([]);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [uploading, setUploading] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [profData, jobsData, appsData] = await Promise.all([
        apiGet<CandidateProfile>("/api/candidate/profile").catch(() => null),
        apiGet<{ jobs: OpenJobPosting[] }>("/api/candidate/jobs").catch(() => ({ jobs: [] })),
        apiGet<{ applications: JobApplication[] }>("/api/candidate/applications").catch(() => ({
          applications: [],
        })),
      ]);
      if (profData) setProfile(profData);
      setJobs(jobsData.jobs);
      setApplications(appsData.applications);
    } catch {
      toast.error("Veriler yüklenirken bir hata oluştu.");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".pdf") && !lowerName.endsWith(".docx")) {
      toast.error("Lütfen PDF veya Word (.docx) formatında CV yükleyin.");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/candidate/cv/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "CV yüklenirken hata oluştu.");
      }

      toast.success("CV başarıyla yüklendi! Mistral OCR ve Vektörleme profiline işlendi.");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CV yüklenemedi.");
    } finally {
      setUploading(false);
    }
  }

  async function handleApply(jobPostingId: number) {
    if (!profile?.has_embedding) {
      toast.error("İlanlara başvurabilmek için önce CV profilinizi yüklemelisiniz.");
      return;
    }

    setApplyingJobId(jobPostingId);
    try {
      await apiPost(`/api/candidate/jobs/${jobPostingId}/apply`, {});
      toast.success("Başvurunuz anında iletildi! ($O(1)$ sıfır beklemeli başvuru)");
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Başvuru yapılamadı.");
    } finally {
      setApplyingJobId(null);
    }
  }

  async function handleWithdraw(jobPostingId: number) {
    if (!confirm("Başvurunuzu geri çekmek istediğinizden emin misiniz?")) return;
    try {
      await apiPost(`/api/candidate/jobs/${jobPostingId}/withdraw`, {});
      toast.success("Başvurunuz geri çekildi.");
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Başvuru geri çekilemedi.");
    }
  }

  async function handleDeleteCV() {
    if (!confirm("CV profilinizi silmek istediğinizden emin misiniz? İlanlara başvurmak için tekrar CV yüklemeniz gerekecektir.")) return;
    try {
      await apiDelete("/api/candidate/cv");
      toast.success("CV profiliniz silindi.");
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "CV silinemedi.");
    }
  }

  async function handleLogout() {
    try {
      await apiPost("/api/candidate/logout", {});
      toast.success("Çıkış yapıldı.");
      router.push("/candidate/login");
    } catch {
      router.push("/candidate/login");
    }
  }

  const appliedJobIds = new Set(applications.map((a) => a.job_posting_id));

  // Filter jobs by search query
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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Responsive Top Header */}
      <header className="border-b border-border/60 bg-card/60 backdrop-blur-md sticky top-0 z-20 px-4 sm:px-6 py-3.5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <LogoFull height={28} />
          </div>

          <div className="flex items-center gap-3">
            {profile && (
              <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full border border-border/40">
                <User className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-foreground">{profile.full_name}</span>
              </div>
            )}
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
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 py-6 sm:py-8">
        {/* Welcome & Overview Header */}
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-card/40 p-5 rounded-2xl border border-border/50 backdrop-blur-sm">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              Hoş Geldiniz {profile?.full_name ? `, ${profile.full_name}` : ""}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              CV'niz 1 kez profilleştirilir. İlanlara sıfır ek bekleme ile anında başvurabilirsiniz.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {profile?.has_embedding ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 px-3 py-1.5 text-xs gap-1.5 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                CV Profilleşti
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 px-3 py-1.5 text-xs gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                CV Yüklenmesi Bekleniyor
              </Badge>
            )}
          </div>
        </div>

        {/* Tabs Container */}
        <Tabs defaultValue="jobs" className="w-full space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-lg mx-auto sm:mx-0">
            <TabsTrigger value="jobs" className="gap-1.5 truncate px-1 text-xs sm:text-sm">
              <Briefcase className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                İlanlar<span className="hidden sm:inline"> ({jobs.length})</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="profile" className="gap-1.5 truncate px-1 text-xs sm:text-sm">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                <span className="sm:hidden">Profil</span>
                <span className="hidden sm:inline">Profil & CV</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="applications" className="gap-1.5 truncate px-1 text-xs sm:text-sm">
              <Send className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                <span className="sm:hidden">Başvurular</span>
                <span className="hidden sm:inline">Başvurularım ({applications.length})</span>
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Open Jobs Tab */}
          <TabsContent value="jobs" className="space-y-4">
            {/* Search & Filter Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card/60 p-3 rounded-xl border border-border/40">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="İlan başlığı veya şirket ara..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 text-xs sm:text-sm h-9"
                />
              </div>
              <span className="text-xs text-muted-foreground font-medium self-end sm:self-center">
                {filteredJobs.length} ilan listeleniyor
              </span>
            </div>

            {/* Jobs Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredJobs.length === 0 ? (
                <Card className="col-span-full border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? "Arama kriterlerine uyan ilan bulunamadı." : "Şu an için yayında açık iş ilanı bulunmuyor."}
                  </p>
                </Card>
              ) : (
                filteredJobs.map((job) => {
                  const isApplied = appliedJobIds.has(job.id);
                  const isApplying = applyingJobId === job.id;

                  return (
                    <Card
                      key={job.id}
                      className="flex flex-col justify-between border-border/60 shadow-sm transition-all hover:border-primary/40 hover:shadow-md bg-card/80 backdrop-blur-sm"
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                            {job.organization_name}
                          </span>
                          {job.deadline_at && (
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(job.deadline_at).toLocaleDateString("tr-TR")}
                            </span>
                          )}
                        </div>
                        <CardTitle className="text-base font-semibold text-foreground leading-snug">
                          {job.title}
                        </CardTitle>
                        <CardDescription className="line-clamp-3 text-xs mt-2 text-muted-foreground leading-relaxed">
                          {job.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {isApplied ? (
                          <Button disabled variant="secondary" className="w-full gap-1.5 text-xs h-9 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            Başvuruldu
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleApply(job.id)}
                            disabled={isApplying || !profile?.has_embedding}
                            className="w-full gap-1.5 text-xs font-medium h-9"
                          >
                            <Zap className="h-3.5 w-3.5 fill-current" />
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
              {/* CV Upload Card */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <UploadCloud className="h-4 w-4 text-primary" />
                    CV Yükleme & Profilleştirme
                  </CardTitle>
                  <CardDescription className="text-xs">
                    PDF veya Word CV&apos;niz yüklendiğinde `mistral-ocr` ve `mistral-embed` ile profilleştirilir. Bu işlem SADECE 1 KERE yapılır.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative border-2 border-dashed border-border/80 hover:border-primary/60 rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors bg-muted/20">
                    <UploadCloud className="h-10 w-10 text-muted-foreground mb-2" />
                    <p className="text-xs font-medium text-foreground mb-1">
                      {uploading ? "CV İşleniyor (Mistral OCR + Embedding)..." : "PDF veya Word CV'nizi Sürükleyin veya Seçin"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mb-3">Maksimum 10MB, PDF veya .docx dosyaları</p>
                    <input
                      type="file"
                      accept=".pdf,.docx"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <Button size="sm" variant="outline" disabled={uploading} className="text-xs gap-1.5 pointer-events-none">
                      <Sparkles className="h-3.5 w-3.5" />
                      Dosya Seç
                    </Button>
                  </div>

                  {profile?.has_embedding && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>CV'niz başarıyla vektörleştirildi ve profilinize kaydedildi.</span>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteCV}
                        className="w-full gap-1.5 text-xs h-8"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        CV Profilimi Sil
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Profile Overview Card */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    Özgeçmiş Profil Özeti
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Mistral AI tarafından CV'nizden çıkarılan otomatik veriler.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {profile ? (
                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">Üniversite:</span>
                        <span className="font-semibold text-foreground">{profile.university || "Belirtilmedi"}</span>
                      </div>
                      <div className="flex justify-between border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">GANO:</span>
                        <span className="font-semibold text-foreground">{profile.gpa ? profile.gpa.toFixed(2) : "Belirtilmedi"}</span>
                      </div>
                      <div className="flex justify-between border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">Deneyim Süresi:</span>
                        <span className="font-semibold text-foreground">{profile.experience_years} Yıl</span>
                      </div>
                      <div className="flex justify-between border-b border-border/40 pb-2">
                        <span className="text-muted-foreground">Sınıf / Durum:</span>
                        <span className="font-semibold text-foreground">{profile.current_class >= 5 ? "Mezun" : `${profile.current_class}. Sınıf`}</span>
                      </div>
                      <div className="pt-1">
                        <span className="text-muted-foreground block mb-2 font-medium">Öne Çıkan Yetenekler:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {profile.skills.length > 0 ? (
                            profile.skills.map((skill) => (
                              <Badge key={skill} variant="secondary" className="text-[11px]">
                                {skill}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground italic">Henüz CV yüklenmedi.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Profil verileri yükleniyor...</p>
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
                  <p className="text-xs text-muted-foreground py-8 text-center">Henüz herhangi bir ilana başvurmadınız.</p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {applications.map((app) => (
                      <div key={app.application_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3.5">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{app.job_title}</p>
                          <p className="text-xs text-muted-foreground">{app.organization_name}</p>
                        </div>
                        <div className="flex items-center gap-3 self-start sm:self-auto">
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(app.applied_at).toLocaleDateString("tr-TR")}
                          </span>
                          <Badge variant="outline" className="text-xs capitalize bg-primary/10 text-primary border-primary/20">
                            {app.status === "applied" ? "Başvuruldu" : app.status}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleWithdraw(app.job_posting_id)}
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            Geri Çek
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
