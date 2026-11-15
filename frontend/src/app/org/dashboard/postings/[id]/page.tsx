"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  CalendarClock,
  CheckCircle2,
  FileText,
  Flag,
  ListChecks,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  TrendingUp,
  Upload,
  Users,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch, apiPost, apiUpload, ApiError } from "@/lib/api";
import type {
  Candidate,
  FinalizeResponse,
  JobPosting,
  RankedCandidate,
  ResetEvaluationsResponse,
  ShortlistResponse,
  ShortlistStatusResponse,
  TopResult,
  UploadResult,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const SHORTLIST_POLL_INTERVAL_MS = 3000;
const SHORTLIST_POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

const LANGUAGE_LABELS: Record<string, string> = {
  tr: "Türkçe",
  en: "English",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatScore(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function SkillMatchChips({
  matched,
  missing,
  maxVisible = 3,
}: {
  matched?: string[] | null;
  missing?: string[] | null;
  maxVisible?: number;
}) {
  const matchedList = matched ?? [];
  const missingList = missing ?? [];

  if (matchedList.length === 0 && missingList.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {matchedList.slice(0, maxVisible).map((skill) => (
        <Badge
          key={`m-${skill}`}
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
        >
          ✓ {skill}
        </Badge>
      ))}
      {matchedList.length > maxVisible ? (
        <Badge
          variant="outline"
          className="border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0 text-[10px] text-emerald-700 tabular-nums dark:text-emerald-300"
        >
          +{matchedList.length - maxVisible}
        </Badge>
      ) : null}
      {missingList.slice(0, maxVisible).map((skill) => (
        <Badge
          key={`x-${skill}`}
          variant="outline"
          className="border-red-500/30 bg-red-500/10 px-1.5 py-0 text-[10px] font-medium text-red-700 dark:text-red-300"
        >
          ✕ {skill}
        </Badge>
      ))}
      {missingList.length > maxVisible ? (
        <Badge
          variant="outline"
          className="border-red-500/20 bg-red-500/5 px-1.5 py-0 text-[10px] text-red-700 tabular-nums dark:text-red-300"
        >
          +{missingList.length - maxVisible}
        </Badge>
      ) : null}
    </div>
  );
}

export default function PostingDetailPage() {
  const params = useParams<{ id: string }>();
  const postingId = params.id;

  const [posting, setPosting] = useState<JobPosting | null>(null);
  const [candidates, setCandidates] = useState<(Candidate | RankedCandidate)[] | null>(null);
  const [semantic, setSemantic] = useState(false);
  const [results, setResults] = useState<TopResult[] | null>(null);

  const [minGpa, setMinGpa] = useState("");
  const [classYear, setClassYear] = useState("");
  const [minExperience, setMinExperience] = useState("");
  const [searching, setSearching] = useState(false);

  const [interviewSlots, setInterviewSlots] = useState("50");
  const [language, setLanguage] = useState("tr");
  const [shortlisting, setShortlisting] = useState(false);
  const [shortlistStatus, setShortlistStatus] = useState<ShortlistStatusResponse | null>(null);
  const [pollingShortlist, setPollingShortlist] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"finalize" | "reset" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPosting = useCallback(async () => {
    try {
      const data = await apiGet<{ posting: JobPosting }>(`/api/org/postings/${postingId}`);
      setPosting(data.posting);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan yüklenemedi.");
    }
  }, [postingId]);

  const loadCandidates = useCallback(async () => {
    try {
      const searchParams = new URLSearchParams();
      searchParams.set("limit", "200");
      if (minGpa) searchParams.set("min_gpa", minGpa);
      if (classYear) searchParams.set("class_year", classYear);
      if (minExperience) searchParams.set("min_experience_years", minExperience);
      const data = await apiGet<{ candidates: Candidate[] }>(
        `/api/org/postings/${postingId}/candidates?${searchParams.toString()}`,
      );
      setCandidates(data.candidates);
      setSemantic(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Adaylar yüklenemedi.");
    }
  }, [postingId, minGpa, classYear, minExperience]);

  const loadRankings = useCallback(async () => {
    try {
      const data = await apiGet<{ results: TopResult[] }>(
        `/api/org/postings/${postingId}/rankings/top?limit=200`,
      );
      setResults(data.results);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sıralama yüklenemedi.");
    }
  }, [postingId]);

  const loadInitialShortlistStatus = useCallback(async () => {
    try {
      const statusData = await apiGet<ShortlistStatusResponse>(
        `/api/org/postings/${postingId}/shortlist/status`,
      );
      setShortlistStatus(statusData);
      if (statusData.status === "running") {
        setPollingShortlist(true);
      }
    } catch {
      // Non-critical if status check fails on initial load.
    }
  }, [postingId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    loadPosting();
    loadCandidates();
    loadRankings();
    loadInitialShortlistStatus();
  }, [loadPosting, loadCandidates, loadRankings, loadInitialShortlistStatus]);

  useEffect(() => {
    if (!pollingShortlist) return;
    let cancelled = false;
    const startedAt = Date.now();
    let lastCompleted = -1;

    async function pollStatus() {
      try {
        const statusData = await apiGet<ShortlistStatusResponse>(
          `/api/org/postings/${postingId}/shortlist/status`,
        );
        if (cancelled) return;
        setShortlistStatus(statusData);

        if (statusData.completed !== lastCompleted) {
          lastCompleted = statusData.completed;
          await Promise.all([loadRankings(), loadPosting()]);
        }

        if (statusData.status === "completed") {
          setPollingShortlist(false);
          await Promise.all([loadRankings(), loadPosting()]);
          toast.success(statusData.message ?? "Tüm aday değerlendirmeleri tamamlandı.");
          return;
        }

        if (statusData.status === "completed_with_errors") {
          setPollingShortlist(false);
          await Promise.all([loadRankings(), loadPosting()]);
          const failedList = statusData.failed_candidates
            .map((fc) => `${fc.full_name} (${fc.error})`)
            .join(", ");
          toast.error(
            failedList
              ? `Bazı adaylarda hata oluştu: ${failedList}`
              : statusData.message ?? "Değerlendirme kısmen hatalarla tamamlandı.",
          );
          return;
        }

        if (statusData.status === "failed") {
          setPollingShortlist(false);
          await Promise.all([loadRankings(), loadPosting()]);
          toast.error(statusData.message ?? "Kısa liste analizi başarısız oldu.");
          return;
        }

        if (statusData.status === "idle") {
          setPollingShortlist(false);
          return;
        }
      } catch {
        // Transient network/server glitch while polling — retry until timeout.
      }

      if (!cancelled && Date.now() - startedAt >= SHORTLIST_POLL_TIMEOUT_MS) {
        setPollingShortlist(false);
        toast.error("Durum takibi zaman aşımına uğradı. Sayfayı yenileyerek kontrol edebilirsiniz.");
      }
    }

    pollStatus();
    const interval = setInterval(pollStatus, SHORTLIST_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollingShortlist, postingId, loadRankings, loadPosting]);

  async function handleSemanticSearch() {
    setSearching(true);
    try {
      const data = await apiPost<{ candidates: RankedCandidate[] }>(
        `/api/org/postings/${postingId}/candidates/search`,
        {
          min_gpa: minGpa ? Number(minGpa) : undefined,
          class_year: classYear ? Number(classYear) : undefined,
          min_experience_years: minExperience ? Number(minExperience) : undefined,
          limit: 200,
        },
      );
      setCandidates(data.candidates);
      setSemantic(true);
      toast.success("Adaylar iş tanımına göre hibrit olarak sıralandı.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Semantik arama başarısız oldu.");
    } finally {
      setSearching(false);
    }
  }

  async function handleShortlist() {
    if (shortlistStatus?.status === "running" || pollingShortlist) {
      toast.error("Kısa liste analizi şu anda devam ediyor.");
      return;
    }

    const count = Number(interviewSlots);
    if (!count || count < 1) {
      toast.error("Mülakata geçecek aday sayısını girin.");
      return;
    }

    setShortlisting(true);
    try {
      const data = await apiPost<ShortlistResponse>(
        `/api/org/postings/${postingId}/shortlist`,
        {
          candidate_count: count,
          min_gpa: minGpa ? Number(minGpa) : undefined,
          class_year: classYear ? Number(classYear) : undefined,
          min_experience_years: minExperience ? Number(minExperience) : undefined,
          language,
        },
      );
      if (data.shortlisted_count === 0) {
        toast.error("Kriterlere uyan aday bulunamadı.");
        return;
      }
      if (data.queued_count > 0) {
        toast.success(
          `${data.shortlisted_count} aday kısa listeye alındı, ${data.queued_count} aday için yapay zeka jürisi başlatıldı.`,
        );
        setShortlistStatus({
          status: "running",
          total: data.queued_count,
          completed: 0,
          succeeded: 0,
          failed: 0,
          failed_candidates: [],
          evaluated_count: results?.length ?? 0,
          started_at: new Date().toISOString(),
          finished_at: null,
          message: null,
        });
        setPollingShortlist(true);
      } else {
        toast.success(
          `${data.shortlisted_count} aday kısa listeye alındı, hepsi daha önce değerlendirilmiş.`,
        );
        await loadRankings();
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Kısa liste oluşturulamadı.");
    } finally {
      setShortlisting(false);
    }
  }

  function requestFinalize() {
    const count = Number(interviewSlots);
    if (!count || count < 1) {
      toast.error("Mülakata geçecek aday sayısını girin.");
      return;
    }
    setConfirmAction("finalize");
  }

  async function executeFinalize() {
    const count = Number(interviewSlots);
    if (!count || count < 1) return;
    setFinalizing(true);
    try {
      const data = await apiPost<FinalizeResponse>(`/api/org/postings/${postingId}/finalize`, {
        interview_slots: count,
      });
      toast.success(
        `Sonuçlandırıldı: ${data.selected_count} aday mülakata seçildi, ${data.rejected_post_llm_count} aday değerlendirme sonrası elendi, ${data.rejected_pre_llm_count} aday ön elemede elendi. ${data.notifications_sent} bildirim gönderildi.`,
      );
      setConfirmAction(null);
      await loadRankings();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sonuçlandırma başarısız oldu.");
    } finally {
      setFinalizing(false);
    }
  }

  async function executeResetEvaluations() {
    setResetting(true);
    try {
      const data = await apiPost<ResetEvaluationsResponse>(
        `/api/org/postings/${postingId}/reset-evaluations`,
        {},
      );
      toast.success(
        `Sıfırlandı: ${data.debates_deleted} değerlendirme, ${data.notifications_deleted} bildirim silindi; ${data.applications_reset} başvuru "Başvuruldu" durumuna döndü.`,
      );
      setConfirmAction(null);
      setShortlistStatus(null);
      await Promise.all([loadRankings(), loadPosting()]);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sıfırlama başarısız oldu.");
    } finally {
      setResetting(false);
    }
  }

  async function handleToggleStatus() {
    if (!posting) return;
    setTogglingStatus(true);
    try {
      await apiPatch(`/api/org/postings/${postingId}/status`, { is_active: !posting.is_active });
      toast.success(`İlan ${!posting.is_active ? "aktif hale getirildi" : "pasife alındı"}.`);
      await loadPosting();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan durumu güncellenemedi.");
    } finally {
      setTogglingStatus(false);
    }
  }

  function openEditModal() {
    if (!posting) return;
    setEditTitle(posting.title);
    setEditDescription(posting.description);
    setEditDeadline(posting.deadline_at ? posting.deadline_at.slice(0, 10) : "");
    setEditOpen(true);
  }

  async function handleSaveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = editTitle.trim();
    const description = editDescription.trim();
    if (!title || !description) {
      toast.error("İlan başlığı ve açıklaması boş bırakılamaz.");
      return;
    }
    setSavingEdit(true);
    try {
      const descriptionChanged = posting ? description !== posting.description.trim() : false;
      await apiPatch(`/api/org/postings/${postingId}`, {
        title,
        description,
        deadline_at: editDeadline ? `${editDeadline}T23:59:59Z` : null,
      });
      toast.success(
        descriptionChanged
          ? "İlan güncellendi. Açıklama değiştiği için embedding sonraki aramada yeniden hesaplanacaktır."
          : "İlan bilgileri güncellendi.",
      );
      setEditOpen(false);
      await loadPosting();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan güncellenemedi.");
    } finally {
      setSavingEdit(false);
    }
  }

  function addValidatedFiles(incomingFiles: FileList | File[]) {
    setUploadError(null);
    const incoming = Array.from(incomingFiles);
    if (incoming.length === 0) return;

    const errors: string[] = [];
    const next = [...selectedFiles];

    for (const file of incoming) {
      const ext = getFileExtension(file.name);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(`${file.name}: Desteklenmeyen dosya türü (.pdf, .docx, .txt, .md).`);
        continue;
      }
      if (file.size === 0) {
        errors.push(`${file.name}: Dosya boş.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        errors.push(`${file.name}: 10 MB boyut sınırını aşıyor.`);
        continue;
      }
      const alreadyExists = next.some(
        (existing) => existing.name === file.name && existing.size === file.size,
      );
      if (alreadyExists) continue;

      if (next.length >= MAX_UPLOAD_FILES) {
        errors.push(`Tek seferde en fazla ${MAX_UPLOAD_FILES} dosya yüklenebilir.`);
        break;
      }
      next.push(file);
    }

    setSelectedFiles(next);
    if (errors.length > 0) {
      const message = errors.join(" ");
      setUploadError(message);
      toast.error(errors[0]);
    }
  }

  function handleRemoveFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setUploadError(null);
  }

  function handleClearFiles() {
    setSelectedFiles([]);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) {
      const msg = "Önce en az bir geçerli CV dosyası (.pdf, .docx, .txt, .md) seçin.";
      setUploadError(msg);
      toast.error(msg);
      return;
    }
    if (selectedFiles.length > MAX_UPLOAD_FILES) {
      const msg = `Tek seferde en fazla ${MAX_UPLOAD_FILES} dosya yüklenebilir.`;
      setUploadError(msg);
      toast.error(msg);
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => formData.append("files", file));
      const data = await apiUpload<UploadResult>(
        `/api/org/postings/${postingId}/candidates/upload`,
        formData,
      );
      if (data.created.length > 0) {
        toast.success(`${data.created.length} CV başarıyla işlendi.`);
      }
      if (data.errors.length > 0) {
        data.errors.forEach((err) => toast.error(`${err.filename}: ${err.detail}`));
      }
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await Promise.all([loadPosting(), loadCandidates()]);
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : "Yükleme başarısız oldu.";
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  if (!posting) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const deadline = formatDate(posting.deadline_at);
  const isShortlistRunning = shortlistStatus?.status === "running" || pollingShortlist;
  const progressPercent =
    shortlistStatus && shortlistStatus.total > 0
      ? Math.min(100, Math.round((shortlistStatus.completed / shortlistStatus.total) * 100))
      : 0;

  const showScores =
    semantic || (candidates?.some((c) => (c as RankedCandidate).pre_llm_score != null) ?? false);
  const averageScore =
    results && results.length > 0
      ? (results.reduce((sum, r) => sum + Number(r.ranking_score), 0) / results.length).toFixed(1)
      : "—";
  const topScore =
    results && results.length > 0
      ? Math.max(...results.map((r) => Number(r.ranking_score))).toFixed(1)
      : "—";

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Sayfa yolu" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          href="/org/dashboard"
          className="inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          İlanlara Dön
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate font-medium text-foreground">{posting.title}</span>
      </nav>

      <Card className="border-border/60 animate-fade-in-up">
        <CardContent className="flex flex-col gap-3 px-5 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  {posting.title}
                </h1>
                {posting.is_active ? (
                  <StatusBadge tone="green">Aktif</StatusBadge>
                ) : (
                  <StatusBadge tone="gray">Pasif</StatusBadge>
                )}
              </div>
              {deadline ? (
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Son başvuru: {deadline}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={openEditModal}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  İlanı Düzenle
                </Button>
                <Button
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={togglingStatus}
                  variant={posting.is_active ? "outline" : "default"}
                  size="sm"
                  className="gap-1.5"
                >
                  {posting.is_active ? (
                    <>
                      <PauseCircle className="h-3.5 w-3.5" />
                      Pasife Al
                    </>
                  ) : (
                    <>
                      <PlayCircle className="h-3.5 w-3.5" />
                      Aktifleştir
                    </>
                  )}
                </Button>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {posting.is_active
                  ? "Aktif — adaylar başvurabilir."
                  : "Pasif — yeni başvuru alınmıyor."}
              </span>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {posting.description}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 animate-fade-in-up animate-stagger-1">
        <StatCard
          label="Yüklenen CV / Başvuru"
          value={posting.candidate_count}
          icon={Users}
          className="hover-lift tabular-nums"
        />
        <StatCard
          label="Jüri ile Değerlendirilen"
          value={posting.debate_count}
          icon={CheckCircle2}
          className="hover-lift tabular-nums"
        />
      </div>

      {/* File Upload Dropzone */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Toplu CV Yükle</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files) {
                addValidatedFiles(e.dataTransfer.files);
              }
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border/70 bg-muted/20 hover:border-primary/50",
            )}
          >
            <Upload className="h-6 w-6 text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Dosyaları buraya sürükleyip bırakın
              </p>
              <p className="text-xs text-muted-foreground">
                Desteklenen biçimler: <strong>.pdf, .docx, .txt, .md</strong> — Dosya başına en
                fazla 10 MB, tek seferde en fazla 20 dosya.
              </p>
            </div>
            <Label
              htmlFor="cv-upload-input"
              className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
            >
              Bilgisayardan Dosya Seç
            </Label>
            <Input
              ref={fileInputRef}
              id="cv-upload-input"
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) {
                  addValidatedFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </div>

          {uploadError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{uploadError}</span>
            </div>
          ) : null}

          {selectedFiles.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground tabular-nums">
                  Seçilen Dosyalar ({selectedFiles.length} / {MAX_UPLOAD_FILES})
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleClearFiles}
                  disabled={uploading}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Temizle
                </Button>
              </div>
              <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                {selectedFiles.map((file, idx) => (
                  <li
                    key={`${file.name}-${file.size}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate font-medium text-foreground">{file.name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        ({formatFileSize(file.size)})
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${file.name} dosyasını listeden çıkar`}
                      disabled={uploading}
                      onClick={() => handleRemoveFile(idx)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end pt-1">
                <Button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploading}
                  className="gap-1.5"
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? "Yükleniyor ve işleniyor..." : `${selectedFiles.length} Dosyayı Yükle`}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs defaultValue="candidates">
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-fit">
          <TabsTrigger value="candidates">Adaylar</TabsTrigger>
          <TabsTrigger value="rankings">Nihai Sıralama</TabsTrigger>
        </TabsList>

        <TabsContent value="candidates" className="mt-4 flex flex-col gap-4">
          <Card className="border-border/60 p-4">
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="minGpa">Min. GANO</Label>
                  <Input
                    id="minGpa"
                    type="number"
                    step="0.01"
                    min={0}
                    max={4}
                    placeholder="Örn: 2.50"
                    value={minGpa}
                    onChange={(event) => setMinGpa(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="classYear">Sınıf (1-4, mezun=5)</Label>
                  <Input
                    id="classYear"
                    type="number"
                    min={1}
                    max={5}
                    placeholder="Örn: 4"
                    value={classYear}
                    onChange={(event) => setClassYear(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="minExperience">Min. deneyim (yıl)</Label>
                  <Input
                    id="minExperience"
                    type="number"
                    min={0}
                    placeholder="Örn: 1"
                    value={minExperience}
                    onChange={(event) => setMinExperience(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={loadCandidates}>
                  Filtrele
                </Button>
                <Button
                  type="button"
                  onClick={handleSemanticSearch}
                  disabled={searching}
                  className="gap-1.5"
                >
                  <Search className="h-4 w-4" />
                  {searching ? "Sıralanıyor..." : "İş tanımına göre sırala (Pre-LLM)"}
                </Button>
              </div>
            </div>
          </Card>

          {/* Mobile responsive cards for candidates */}
          <div className="flex flex-col gap-3 md:hidden">
            {candidates?.map((candidate) => {
              const ranked = candidate as RankedCandidate;
              return (
                <Card key={candidate.id} className="border-border/60">
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          href={`/org/dashboard/postings/${postingId}/candidates/${candidate.id}`}
                          className="font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {candidate.full_name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {candidate.university ?? "Üniversite belirtilmemiş"}
                        </p>
                      </div>
                      {showScores && ranked.pre_llm_score != null ? (
                        <Badge variant="secondary" className="font-semibold tabular-nums">
                          Pre-LLM: {formatScore(ranked.pre_llm_score)}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-center text-xs">
                      <div>
                        <div className="text-muted-foreground">GANO</div>
                        <div className="font-medium tabular-nums">{candidate.gpa ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Sınıf</div>
                        <div className="font-medium tabular-nums">
                          {candidate.current_class === 5 ? "Mezun" : candidate.current_class}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Deneyim</div>
                        <div className="font-medium tabular-nums">
                          {candidate.experience_years} yıl
                        </div>
                      </div>
                    </div>

                    {showScores ? (
                      <div className="space-y-2 border-t border-border/40 pt-2 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex justify-between rounded bg-muted/30 px-2 py-1">
                            <span className="text-muted-foreground">İlan Uyumu</span>
                            <span className="font-medium tabular-nums">
                              {formatScore(ranked.relevance_score)}
                            </span>
                          </div>
                          <div className="flex justify-between rounded bg-muted/30 px-2 py-1">
                            <span className="text-muted-foreground">Donanım</span>
                            <span className="font-medium tabular-nums">
                              {formatScore(ranked.competency_score)}
                            </span>
                          </div>
                          <div className="flex justify-between rounded bg-muted/30 px-2 py-1">
                            <span className="text-muted-foreground">Anlamsal / UltraBERT</span>
                            <span className="font-medium tabular-nums">
                              {formatScore(ranked.dense_score)}
                            </span>
                          </div>
                          <div className="flex justify-between rounded bg-muted/30 px-2 py-1">
                            <span className="text-muted-foreground">Anahtar Kelime / BM25</span>
                            <span className="font-medium tabular-nums">
                              {formatScore(ranked.sparse_score)}
                            </span>
                          </div>
                        </div>
                        <SkillMatchChips
                          matched={ranked.matched_skills}
                          missing={ranked.missing_skills}
                        />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
            {candidates?.length === 0 ? (
              <Card className="border-dashed border-border/60">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Henüz CV yüklenmedi veya kriterlere uyan aday yok.
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Desktop table for candidates */}
          <Card className="hidden overflow-hidden border-border/60 p-0 md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead scope="col">Ad</TableHead>
                  <TableHead scope="col">Üniversite</TableHead>
                  <TableHead scope="col">GANO</TableHead>
                  <TableHead scope="col">Sınıf</TableHead>
                  <TableHead scope="col">Deneyim</TableHead>
                  {showScores ? (
                    <>
                      <TableHead scope="col">Pre-LLM Puanı</TableHead>
                      <TableHead scope="col">İlan Uyumu</TableHead>
                      <TableHead scope="col">Anlamsal / UltraBERT</TableHead>
                      <TableHead scope="col">Anahtar Kelime / BM25</TableHead>
                      <TableHead scope="col">Donanım</TableHead>
                      <TableHead scope="col">Yetenek Eşleşmesi</TableHead>
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates?.map((candidate) => {
                  const ranked = candidate as RankedCandidate;
                  return (
                    <TableRow key={candidate.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/org/dashboard/postings/${postingId}/candidates/${candidate.id}`}
                          className="text-foreground hover:text-primary hover:underline"
                        >
                          {candidate.full_name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">
                        {candidate.university ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">{candidate.gpa ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {candidate.current_class === 5 ? "Mezun" : candidate.current_class}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {candidate.experience_years} yıl
                      </TableCell>
                      {showScores ? (
                        <>
                          <TableCell className="font-semibold text-primary tabular-nums">
                            {formatScore(ranked.pre_llm_score)}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {formatScore(ranked.relevance_score)}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {formatScore(ranked.dense_score)}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {formatScore(ranked.sparse_score)}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {formatScore(ranked.competency_score)}
                          </TableCell>
                          <TableCell className="min-w-[180px] whitespace-normal">
                            <SkillMatchChips
                              matched={ranked.matched_skills}
                              missing={ranked.missing_skills}
                            />
                          </TableCell>
                        </>
                      ) : null}
                    </TableRow>
                  );
                })}
                {candidates?.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={showScores ? 11 : 5}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Henüz CV yüklenmedi veya kriterlere uyan aday yok.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="rankings" className="mt-4 flex flex-col gap-4">
          <Card className="border-border/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="interviewSlots">Mülakata geçecek aday sayısı</Label>
                <Input
                  id="interviewSlots"
                  type="number"
                  min={1}
                  max={500}
                  value={interviewSlots}
                  onChange={(event) => setInterviewSlots(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="debateLanguage">Değerlendirme dili</Label>
                <Select
                  value={language}
                  onValueChange={(value) => setLanguage(value ?? "tr")}
                >
                  <SelectTrigger id="debateLanguage" className="w-[140px]">
                    <SelectValue>
                      {(val: string | null) =>
                        val ? (LANGUAGE_LABELS[val] ?? val) : "Dil seçin"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tr">Türkçe</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={handleShortlist}
                disabled={shortlisting || isShortlistRunning}
                className="gap-1.5 sm:w-fit"
              >
                {shortlisting || isShortlistRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ListChecks className="h-4 w-4" />
                )}
                {shortlisting
                  ? "Kısa liste oluşturuluyor..."
                  : isShortlistRunning
                    ? "Analiz devam ediyor..."
                    : "Kısa liste oluştur ve analizi başlat"}
              </Button>
              <Button
                type="button"
                onClick={requestFinalize}
                disabled={finalizing || isShortlistRunning || !results || results.length === 0}
                variant="outline"
                className="gap-1.5 sm:w-fit"
              >
                <Flag className="h-4 w-4" />
                {finalizing ? "Sonuçlandırılıyor..." : "Sonuçlandır"}
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmAction("reset")}
                disabled={resetting || isShortlistRunning || !results || results.length === 0}
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-destructive sm:w-fit"
              >
                <RotateCcw className="h-4 w-4" />
                {resetting ? "Sıfırlanıyor..." : "Değerlendirmeleri sıfırla"}
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Girdiğiniz sayı (N) <strong className="font-medium text-foreground">nihai mülakat hedefidir</strong>.
              &quot;Kısa liste oluştur&quot; ön eleme (Anlamsal UltraBERT + Anahtar Kelime BM25 +
              Donanım) sıralamasından en iyi ~3N adayı İyimser / Kötümser / Hakem yapay zeka jürisine
              gönderir. Analizler bittikten sonra &quot;Sonuçlandır&quot; ile en iyi N adayı mülakata
              seçebilir, diğer adaylara açıklayıcı sonuç bildirimi gönderebilirsiniz.
            </p>
          </Card>

          {/* Live Shortlist Status Progress / Error Banner */}
          {shortlistStatus && shortlistStatus.status === "running" ? (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span>Yapay zeka jürisi adayları değerlendiriyor...</span>
                  </div>
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    {shortlistStatus.completed}/{shortlistStatus.total} aday analiz edildi (%{progressPercent})
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Kısa liste analiz ilerlemesi"
                  aria-valuemin={0}
                  aria-valuemax={shortlistStatus.total || 1}
                  aria-valuenow={shortlistStatus.completed}
                  className="h-2 w-full overflow-hidden rounded-full bg-primary/15"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground tabular-nums">
                  <span>Başarılı: {shortlistStatus.succeeded}</span>
                  {shortlistStatus.failed > 0 ? (
                    <span className="text-destructive">Hatalı: {shortlistStatus.failed}</span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {shortlistStatus &&
          (shortlistStatus.status === "completed_with_errors" ||
            shortlistStatus.status === "failed") &&
          shortlistStatus.failed_candidates.length > 0 ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex flex-col gap-2 p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {shortlistStatus.message ?? "Bazı adayların değerlendirmesinde hata oluştu:"}
                  </span>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {shortlistStatus.failed_candidates.map((fc) => (
                    <li key={fc.id}>
                      <strong className="text-foreground">{fc.full_name}:</strong> {fc.error}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Ortalama Sıralama Puanı"
              value={averageScore}
              icon={TrendingUp}
              className="tabular-nums"
            />
            <StatCard
              label="En Yüksek Sıralama Puanı"
              value={topScore}
              icon={Award}
              className="tabular-nums"
            />
          </div>

          {/* Mobile cards for ranked results */}
          <div className="flex flex-col gap-3 md:hidden">
            {results?.map((result, idx) => (
              <Card key={result.candidate_id} className="border-border/60">
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                          #{idx + 1}
                        </span>
                        <Link
                          href={`/org/dashboard/postings/${postingId}/candidates/${result.candidate_id}`}
                          className="font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {result.full_name}
                        </Link>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {result.university ?? "Üniversite belirtilmemiş"}
                      </p>
                    </div>
                    {result.application_status === "selected" ? (
                      <StatusBadge tone="green">Seçildi</StatusBadge>
                    ) : result.application_status === "rejected" ? (
                      <StatusBadge tone="red">Elendi</StatusBadge>
                    ) : (
                      <StatusBadge tone="gray">Karar bekliyor</StatusBadge>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-center text-xs">
                    <div>
                      <div className="text-muted-foreground">Nihai</div>
                      <div className="font-semibold text-primary tabular-nums">
                        {Number(result.ranking_score).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Jüri Puanı</div>
                      <div className="font-medium tabular-nums">
                        {Number(result.final_score).toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Pre-LLM</div>
                      <div className="font-medium tabular-nums">
                        {formatScore(result.pre_llm_score)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="flex justify-between rounded bg-muted/25 px-2 py-1">
                      <span className="text-muted-foreground">Anlamsal / UltraBERT</span>
                      <span className="font-medium tabular-nums">
                        {formatScore(result.dense_score)}
                      </span>
                    </div>
                    <div className="flex justify-between rounded bg-muted/25 px-2 py-1">
                      <span className="text-muted-foreground">Anahtar Kelime / BM25</span>
                      <span className="font-medium tabular-nums">
                        {formatScore(result.sparse_score)}
                      </span>
                    </div>
                  </div>

                  {result.grounding_score != null ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>%{Math.round(result.grounding_score * 100)} Kanıt Doğrulaması</span>
                    </div>
                  ) : null}

                  <SkillMatchChips
                    matched={result.matched_skills}
                    missing={result.missing_skills}
                  />
                </CardContent>
              </Card>
            ))}
            {results?.length === 0 ? (
              <Card className="border-dashed border-border/60">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Henüz değerlendirme yapılmadı.
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Desktop table for ranked results */}
          <Card className="hidden overflow-hidden border-border/60 p-0 md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead scope="col">Sıra</TableHead>
                  <TableHead scope="col">Aday</TableHead>
                  <TableHead scope="col">Nihai Puan</TableHead>
                  <TableHead scope="col">Yapay Zeka Jüri</TableHead>
                  <TableHead scope="col">Pre-LLM</TableHead>
                  <TableHead scope="col">Anlamsal / UltraBERT</TableHead>
                  <TableHead scope="col">Anahtar Kelime / BM25</TableHead>
                  <TableHead scope="col">Donanım</TableHead>
                  <TableHead scope="col">Kanıt</TableHead>
                  <TableHead scope="col">Yetenekler</TableHead>
                  <TableHead scope="col">Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results?.map((result, idx) => (
                  <TableRow key={result.candidate_id}>
                    <TableCell className="font-medium text-muted-foreground tabular-nums">
                      #{idx + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <Link
                          href={`/org/dashboard/postings/${postingId}/candidates/${result.candidate_id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {result.full_name}
                        </Link>
                        <span className="max-w-[180px] truncate text-xs text-muted-foreground">
                          {result.university ?? "—"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold text-primary tabular-nums">
                      {Number(result.ranking_score).toFixed(2)}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {Number(result.final_score).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatScore(result.pre_llm_score)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatScore(result.dense_score)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatScore(result.sparse_score)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatScore(result.competency_score)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {result.grounding_score != null ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/30 bg-emerald-500/10 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                        >
                          %{Math.round(result.grounding_score * 100)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[170px] whitespace-normal">
                      <SkillMatchChips
                        matched={result.matched_skills}
                        missing={result.missing_skills}
                        maxVisible={2}
                      />
                    </TableCell>
                    <TableCell>
                      {result.application_status === "selected" ? (
                        <StatusBadge tone="green">Seçildi</StatusBadge>
                      ) : result.application_status === "rejected" ? (
                        <StatusBadge tone="red">Elendi</StatusBadge>
                      ) : (
                        <StatusBadge tone="gray">Karar bekliyor</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {results?.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Henüz değerlendirme yapılmadı.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmAction === "finalize"}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title="İlanı Sonuçlandır"
        description={`En yüksek puanlı ${interviewSlots} aday mülakata seçilecek; kalan tüm değerlendirilmiş ve ön elemede elenen adaylara sonuç bildirimi gönderilecektir. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?`}
        confirmLabel="Sonuçlandır"
        cancelLabel="Vazgeç"
        variant="default"
        busy={finalizing}
        onConfirm={executeFinalize}
      />

      <ConfirmDialog
        open={confirmAction === "reset"}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title="Tüm Değerlendirmeleri Sıfırla"
        description="Bu ilan için yapılmış tüm yapay zeka jüri değerlendirmeleri, mülakat bildirimleri ve seçildi/elendi kararları kalıcı olarak silinecek; tüm başvurular yeniden 'Başvuruldu' durumuna dönecektir."
        confirmLabel="Değerlendirmeleri Sıfırla"
        cancelLabel="Vazgeç"
        variant="destructive"
        busy={resetting}
        onConfirm={executeResetEvaluations}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>İlanı Düzenle</DialogTitle>
            <DialogDescription>
              İlan başlığını, açıklamasını veya son başvuru tarihini güncelleyin.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="editPostingTitle">İlan Başlığı</Label>
              <Input
                id="editPostingTitle"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="editPostingDeadline">Son Başvuru Tarihi (isteğe bağlı)</Label>
              <Input
                id="editPostingDeadline"
                type="date"
                value={editDeadline}
                onChange={(event) => setEditDeadline(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="editPostingDescription">İlan Açıklaması &amp; Gereksinimler</Label>
              <Textarea
                id="editPostingDescription"
                rows={6}
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                required
              />
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={savingEdit}
                onClick={() => setEditOpen(false)}
              >
                İptal
              </Button>
              <Button type="submit" size="sm" disabled={savingEdit}>
                {savingEdit ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
