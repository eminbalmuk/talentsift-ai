"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Gavel,
  GraduationCap,
  Layers,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  XCircle,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type {
  Candidate,
  CompetencyBreakdown,
  DebateResult,
  InterviewSchedule,
  JobPosting,
  SkillMatches,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const INTERVIEW_STATUS_LABEL: Record<InterviewSchedule["status"], string> = {
  proposed: "Yanıt bekleniyor",
  confirmed: "Aday onayladı",
  declined: "Aday reddetti",
};

const LANGUAGE_LABELS: Record<string, string> = {
  tr: "Türkçe",
  en: "English",
};

function toLocalDateTimeInputValue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+/i.test(value.trim());
}

function formatScore(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function CompetencyBar({
  label,
  score,
  max,
}: {
  label: string;
  score: number;
  max: number;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((score / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {score.toFixed(3)} / {max.toFixed(2)} (%{percent})
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} puanı`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={score}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function CandidateDetailPage() {
  const params = useParams<{ id: string; candidateId: string }>();
  const postingId = params.id;
  const candidateId = params.candidateId;

  const [postingTitle, setPostingTitle] = useState<string>("İlan Detayı");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  const [competencyBreakdown, setCompetencyBreakdown] = useState<CompetencyBreakdown | null>(null);
  const [skillMatches, setSkillMatches] = useState<SkillMatches | null>(null);
  const [interview, setInterview] = useState<InterviewSchedule | null>(null);

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [language, setLanguage] = useState("tr");

  const [proposedAt, setProposedAt] = useState("");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, interviewData, postingData] = await Promise.all([
        apiGet<{
          candidate: Candidate;
          debate: DebateResult | null;
          application_status: string | null;
          competency_breakdown?: CompetencyBreakdown | null;
          skill_matches?: SkillMatches | null;
        }>(`/api/org/postings/${postingId}/candidates/${candidateId}`),
        apiGet<{ interview: InterviewSchedule | null }>(
          `/api/org/postings/${postingId}/candidates/${candidateId}/interview`,
        ).catch(() => ({ interview: null })),
        apiGet<{ posting: JobPosting }>(`/api/org/postings/${postingId}`).catch(() => null),
      ]);

      if (postingData?.posting?.title) {
        setPostingTitle(postingData.posting.title);
      }
      setCandidate(data.candidate);
      setDebate(data.debate);
      setApplicationStatus(data.application_status);
      setCompetencyBreakdown(data.competency_breakdown ?? null);
      setSkillMatches(data.skill_matches ?? null);
      setInterview(interviewData.interview);

      if (interviewData.interview) {
        setProposedAt(toLocalDateTimeInputValue(interviewData.interview.proposed_at));
        setLocationOrLink(interviewData.interview.location_or_link ?? "");
        setInterviewNotes(interviewData.interview.notes ?? "");
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Aday yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [postingId, candidateId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function handleProposeInterview(event?: React.FormEvent) {
    event?.preventDefault();
    setInterviewError(null);

    if (!proposedAt.trim()) {
      const msg = "Mülakat tarih ve saatini seçin.";
      setInterviewError(msg);
      toast.error(msg);
      return;
    }

    const parsedDate = new Date(proposedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      const msg = "Geçerli bir tarih ve saat girin.";
      setInterviewError(msg);
      toast.error(msg);
      return;
    }

    setProposing(true);
    try {
      await apiPost(`/api/org/postings/${postingId}/candidates/${candidateId}/interview`, {
        proposed_at: parsedDate.toISOString(),
        location_or_link: locationOrLink.trim() || null,
        notes: interviewNotes.trim() || null,
      });
      toast.success("Mülakat teklifi adaya gönderildi.");
      await load();
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : "Mülakat planlanamadı.";
      setInterviewError(msg);
      toast.error(msg);
    } finally {
      setProposing(false);
    }
  }

  async function handleRunDebate() {
    setRunning(true);
    try {
      const result = await apiPost<DebateResult>(`/api/org/postings/${postingId}/debate`, {
        candidate_id: Number(candidateId),
        language,
      });
      setDebate(result);
      if (result.competency_breakdown) {
        setCompetencyBreakdown(result.competency_breakdown);
      }
      if (result.matched_skills || result.missing_skills) {
        setSkillMatches({
          matched_skills: result.matched_skills ?? [],
          missing_skills: result.missing_skills ?? [],
        });
      }
      toast.success("Çoklu ajan jüri değerlendirmesi tamamlandı.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Değerlendirme başarısız oldu.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href={`/org/dashboard/postings/${postingId}`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          İlana Dön
        </Link>
        <Card className="border-dashed border-border/60">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Aday kaydı bulunamadı.
          </CardContent>
        </Card>
      </div>
    );
  }

  const preLlmScore = debate?.pre_llm_score ?? candidate.pre_llm_score;
  const relevanceScore = debate?.relevance_score ?? candidate.relevance_score;
  const denseScore = debate?.dense_score ?? candidate.dense_score;
  const sparseScore = debate?.sparse_score ?? candidate.sparse_score;
  const effectiveBreakdown = debate?.competency_breakdown ?? competencyBreakdown;
  const compScore =
    debate?.competency_score ??
    candidate.competency_score ??
    effectiveBreakdown?.competency_score;

  const matchedSkills =
    debate?.matched_skills ?? skillMatches?.matched_skills ?? candidate.matched_skills ?? [];
  const missingSkills =
    debate?.missing_skills ?? skillMatches?.missing_skills ?? candidate.missing_skills ?? [];

  const minDateTimeLocal = toLocalDateTimeInputValue(new Date());
  const groundingPercent =
    debate?.grounding_score != null ? Math.round(debate.grounding_score * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Sayfa yolu" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link
          href="/org/dashboard"
          className="font-medium transition-colors hover:text-foreground"
        >
          İlanlar
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/org/dashboard/postings/${postingId}`}
          className="max-w-[240px] truncate font-medium transition-colors hover:text-foreground"
        >
          {postingTitle}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="truncate font-semibold text-foreground">
          {candidate.full_name}
        </span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Left Sidebar: Candidate Profile & Raw CV */}
        <div className="flex flex-col gap-4">
          <Card className="border-border/60">
            <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">{candidate.full_name}</CardTitle>
              {applicationStatus === "selected" ? (
                <StatusBadge tone="green">Seçildi</StatusBadge>
              ) : applicationStatus === "rejected" ? (
                <StatusBadge tone="red">Elendi</StatusBadge>
              ) : (
                <StatusBadge tone="gray">Karar bekliyor</StatusBadge>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <GraduationCap className="h-4 w-4 shrink-0" />
                <span>{candidate.university ?? "Üniversite belirtilmemiş"}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-md bg-muted/60 py-2">
                  <div className="text-xs text-muted-foreground">GANO</div>
                  <div className="font-medium tabular-nums">{candidate.gpa ?? "—"}</div>
                </div>
                <div className="rounded-md bg-muted/60 py-2">
                  <div className="text-xs text-muted-foreground">Sınıf</div>
                  <div className="font-medium tabular-nums">
                    {candidate.current_class === 5 ? "Mezun" : candidate.current_class}
                  </div>
                </div>
                <div className="rounded-md bg-muted/60 py-2">
                  <div className="text-xs text-muted-foreground">Deneyim</div>
                  <div className="font-medium tabular-nums">{candidate.experience_years} yıl</div>
                </div>
              </div>
              {candidate.skills.length > 0 ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Özgeçmiş Yetenekleri
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.skills.map((skill) => (
                      <Badge key={skill} variant="secondary" className="font-normal">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {candidate.raw_cv_text ? (
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-sm">Özgeçmiş Metni (CV)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {candidate.raw_cv_text}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Main Panel: Interview, Pre-LLM Explainability, LLM Debate Jury */}
        <div className="flex flex-col gap-5">
          {applicationStatus === "selected" ? (
            <Card className="border-border/60">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  Mülakat Planlaması
                </CardTitle>
                {interview ? (
                  <StatusBadge
                    tone={
                      interview.status === "confirmed"
                        ? "green"
                        : interview.status === "declined"
                          ? "red"
                          : "amber"
                    }
                  >
                    {INTERVIEW_STATUS_LABEL[interview.status]}
                  </StatusBadge>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {interview ? (
                  <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/40 p-3 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground tabular-nums">
                      Önerilen Tarih:{" "}
                      {new Date(interview.proposed_at).toLocaleString("tr-TR", {
                        dateStyle: "long",
                        timeStyle: "short",
                      })}
                    </p>
                    {interview.location_or_link ? (
                      <p className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">Konum / Bağlantı:</span>
                        {isHttpUrl(interview.location_or_link) ? (
                          <a
                            href={interview.location_or_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 break-all font-medium text-primary underline underline-offset-2 hover:opacity-80"
                          >
                            {interview.location_or_link}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span>{interview.location_or_link}</span>
                        )}
                      </p>
                    ) : null}
                    {interview.notes ? <p>{interview.notes}</p> : null}
                  </div>
                ) : null}

                <form onSubmit={handleProposeInterview} className="flex flex-col gap-3" noValidate>
                  {interviewError ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{interviewError}</span>
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="proposedAt">Tarih ve Saat</Label>
                      <Input
                        id="proposedAt"
                        type="datetime-local"
                        min={minDateTimeLocal}
                        value={proposedAt}
                        onChange={(event) => setProposedAt(event.target.value)}
                        className="tabular-nums"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="locationOrLink">Konum veya Toplantı Bağlantısı</Label>
                      <Input
                        id="locationOrLink"
                        autoComplete="url"
                        placeholder="Ofis adresi veya Zoom/Meet bağlantısı"
                        value={locationOrLink}
                        onChange={(event) => setLocationOrLink(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="interviewNotes">Not (Opsiyonel)</Label>
                    <Textarea
                      id="interviewNotes"
                      autoComplete="off"
                      rows={2}
                      placeholder="Mülakat süreciyle ilgili ek bilgiler..."
                      value={interviewNotes}
                      onChange={(event) => setInterviewNotes(event.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={proposing} className="w-fit gap-1.5">
                    <CalendarClock className="h-4 w-4" />
                    {proposing
                      ? "Gönderiliyor..."
                      : interview
                        ? "Mülakatı Güncelle"
                        : "Mülakat Teklif Et"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {/* Pre-LLM & Explainability Panel (shown BEFORE and AFTER debate) */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4 text-primary" />
                Ön Eleme Skoru (Pre-LLM) & Açıklanabilirlik Analizi
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="flex flex-col items-center gap-1 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-center">
                  <Layers className="h-4 w-4 text-primary" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Ön Eleme Skoru
                  </span>
                  <span className="text-lg font-bold text-primary tabular-nums">
                    {formatScore(preLlmScore)}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 px-3 py-3 text-center">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    İlan Uyumu (Hibrit)
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatScore(relevanceScore)}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 px-3 py-3 text-center">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Anlamsal Uyum
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatScore(denseScore)}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 px-3 py-3 text-center">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Anahtar Kelime Uyumu
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatScore(sparseScore)}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 px-3 py-3 text-center">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Donanım Puanı
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatScore(compScore)}
                  </span>
                </div>
              </div>

              {preLlmScore == null ? (
                <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Anlamsal ve anahtar kelime ilan uyumu skorları henüz hesaplanmamış. İlan sayfasından &quot;İş
                  tanımına göre sırala&quot; veya aşağıdan jüri değerlendirmesini çalıştırdığınızda bu
                  skorlar otomatik doldurulur.
                </p>
              ) : null}

              {effectiveBreakdown ? (
                <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Donanım Puanı Alt Kırılımı
                    </h3>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                      Toplam: {effectiveBreakdown.competency_score.toFixed(3)} / 1.00
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CompetencyBar
                      label="Deneyim"
                      score={effectiveBreakdown.exp_score}
                      max={0.35}
                    />
                    <CompetencyBar
                      label="GNO"
                      score={effectiveBreakdown.gpa_score}
                      max={0.25}
                    />
                    <CompetencyBar
                      label="Sınıf"
                      score={effectiveBreakdown.class_score}
                      max={0.15}
                    />
                    <CompetencyBar
                      label="Liderlik / Staj"
                      score={effectiveBreakdown.keyword_score}
                      max={0.25}
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Eşleşen Yetenekler ({matchedSkills.length})</span>
                  </div>
                  {matchedSkills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {matchedSkills.map((skill) => (
                        <Badge
                          key={skill}
                          variant="outline"
                          className="border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      İlan metni ile doğrudan eşleşen yetenek tespit edilmedi.
                    </p>
                  )}
                </div>

                <div className="space-y-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-300">
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Eksik Yetenekler ({missingSkills.length})</span>
                  </div>
                  {missingSkills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {missingSkills.map((skill) => (
                        <Badge
                          key={skill}
                          variant="outline"
                          className="border-red-500/30 bg-red-500/10 text-xs font-medium text-red-700 dark:text-red-300"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      İlanda tespit edilen eksik yetenek yok.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LLM Debate Trigger or Results */}
          {!debate ? (
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">
                  Yapay Zeka Jüri Değerlendirmesi
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  İlanın iş tanımını kullanarak adayın güçlü yönlerini, risk alanlarını ve kanıta
                  dayalı nihai değerlendirmesini oluşturun.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="initialDebateLanguage" className="sr-only">
                    Değerlendirme dili
                  </Label>
                  <Select value={language} onValueChange={(value) => setLanguage(value ?? "tr")}>
                    <SelectTrigger id="initialDebateLanguage" className="w-[140px]">
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
                  <Button type="button" onClick={handleRunDebate} disabled={running}>
                    {running
                      ? "Aday derinlemesine analiz ediliyor..."
                      : "Detaylı Değerlendirmeyi Başlat"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Yapay Zeka Jüri Değerlendirme Sonucu
                </h2>
                <div className="flex items-center gap-2">
                  <Label htmlFor="rerunDebateLanguage" className="sr-only">
                    Değerlendirme dili
                  </Label>
                  <Select value={language} onValueChange={(value) => setLanguage(value ?? "tr")}>
                    <SelectTrigger id="rerunDebateLanguage" className="w-[140px]">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRunDebate}
                    disabled={running}
                  >
                    {running ? "Çalışıyor..." : "Yeniden Değerlendir"}
                  </Button>
                </div>
              </div>

              {/* Score Comparison Banner */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="border-border/60">
                  <CardContent className="flex flex-col items-center gap-1 py-4">
                    <ThumbsUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs text-muted-foreground">Güçlü Yönler Puanı</span>
                    <span className="text-2xl font-semibold tabular-nums">
                      {debate.optimist_score}
                    </span>
                  </CardContent>
                </Card>

                <Card className="border-border/60">
                  <CardContent className="flex flex-col items-center gap-1 py-4">
                    <ThumbsDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <span className="text-xs text-muted-foreground">Risk &amp; Gelişim Puanı</span>
                    <span className="text-2xl font-semibold tabular-nums">
                      {debate.pessimist_score}
                    </span>
                  </CardContent>
                </Card>

                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="flex flex-col items-center gap-1 py-4">
                    <Gavel className="h-4 w-4 text-primary" />
                    <span className="text-xs font-medium text-muted-foreground">
                      Nihai Değerlendirme Puanı
                    </span>
                    <span className="text-2xl font-bold text-primary tabular-nums">
                      {Number(debate.final_score).toFixed(1)}
                    </span>
                    {preLlmScore != null ? (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        Ön Eleme Skoru: {formatScore(preLlmScore)}
                      </span>
                    ) : null}
                  </CardContent>
                </Card>
              </div>

              {/* Arbitrator Verdict + Evidence Grounding */}
              <Card className="border-border/60">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Gavel className="h-4 w-4 text-primary" />
                    Genel Karar ve Gerekçe
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {groundingPercent !== null ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-1 text-xs font-medium tabular-nums",
                          groundingPercent >= 70
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : groundingPercent >= 40
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
                        )}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />%{groundingPercent} Kanıt Doğrulaması
                      </Badge>
                    ) : null}
                    {applicationStatus === "selected" ? (
                      <StatusBadge tone="green">Seçildi</StatusBadge>
                    ) : applicationStatus === "rejected" ? (
                      <StatusBadge tone="red">Elendi</StatusBadge>
                    ) : (
                      <StatusBadge tone="gray">Karar bekliyor</StatusBadge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <Markdown>{debate.arbitrator_rationale}</Markdown>

                  {debate.evidence_quotes && debate.evidence_quotes.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/25 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Quote className="h-3.5 w-3.5 text-primary" />
                        <span>Özgeçmişten Doğrudan Kanıt Alıntıları</span>
                      </div>
                      <ul className="space-y-2">
                        {debate.evidence_quotes.map((quote, idx) => (
                          <li key={idx}>
                            <blockquote className="border-l-2 border-primary/50 pl-3 text-xs italic leading-relaxed text-muted-foreground">
                              &ldquo;{quote}&rdquo;
                            </blockquote>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Optimist & Pessimist Side-by-Side */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-emerald-500/20">
                  <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ThumbsUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      Güçlü Yönler Analizi
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-xs font-semibold text-emerald-700 tabular-nums dark:text-emerald-300"
                    >
                      {debate.optimist_score} / 100
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <Markdown>{debate.optimist_arguments}</Markdown>
                  </CardContent>
                </Card>

                <Card className="border-red-500/20">
                  <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ThumbsDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                      Risk &amp; Gelişim Analizi
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-700 tabular-nums dark:text-red-300"
                    >
                      {debate.pessimist_score} / 100
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <Markdown>{debate.pessimist_arguments}</Markdown>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
