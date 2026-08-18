"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Gavel, GraduationCap, Layers, Search, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { Candidate, DebateResult, InterviewSchedule } from "@/lib/types";

const INTERVIEW_STATUS_LABEL: Record<InterviewSchedule["status"], string> = {
  proposed: "Yanıt bekleniyor",
  confirmed: "Aday onayladı",
  declined: "Aday reddetti",
};

export default function CandidateDetailPage() {
  const params = useParams<{ id: string; candidateId: string }>();
  const postingId = params.id;
  const candidateId = params.candidateId;

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [debate, setDebate] = useState<DebateResult | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  const [interview, setInterview] = useState<InterviewSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [language, setLanguage] = useState("tr");
  const [proposedAt, setProposedAt] = useState("");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [proposing, setProposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, interviewData] = await Promise.all([
        apiGet<{
          candidate: Candidate;
          debate: DebateResult | null;
          application_status: string | null;
        }>(`/api/org/postings/${postingId}/candidates/${candidateId}`),
        apiGet<{ interview: InterviewSchedule | null }>(
          `/api/org/postings/${postingId}/candidates/${candidateId}/interview`,
        ).catch(() => ({ interview: null })),
      ]);
      setCandidate(data.candidate);
      setDebate(data.debate);
      setApplicationStatus(data.application_status);
      setInterview(interviewData.interview);
      if (interviewData.interview) {
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

  async function handleProposeInterview() {
    if (!proposedAt) {
      toast.error("Mülakat tarih ve saatini seçin.");
      return;
    }
    setProposing(true);
    try {
      await apiPost(`/api/org/postings/${postingId}/candidates/${candidateId}/interview`, {
        proposed_at: new Date(proposedAt).toISOString(),
        location_or_link: locationOrLink || null,
        notes: interviewNotes || null,
      });
      toast.success("Mülakat teklifi adaya gönderildi.");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Mülakat planlanamadı.");
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
        {applicationStatus === "selected" ? (
          <Card className="border-border/60">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-primary" />
                Mülakat
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
            <CardContent className="flex flex-col gap-3">
              {interview ? (
                <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {new Date(interview.proposed_at).toLocaleString("tr-TR")}
                  </p>
                  {interview.location_or_link ? <p className="mt-1">{interview.location_or_link}</p> : null}
                  {interview.notes ? <p className="mt-1">{interview.notes}</p> : null}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="proposedAt">Tarih & saat</Label>
                  <Input
                    id="proposedAt"
                    type="datetime-local"
                    value={proposedAt}
                    onChange={(event) => setProposedAt(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="locationOrLink">Konum / bağlantı</Label>
                  <Input
                    id="locationOrLink"
                    placeholder="Ofis adresi veya Zoom/Meet bağlantısı"
                    value={locationOrLink}
                    onChange={(event) => setLocationOrLink(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="interviewNotes">Not (opsiyonel)</Label>
                <Textarea
                  id="interviewNotes"
                  rows={2}
                  value={interviewNotes}
                  onChange={(event) => setInterviewNotes(event.target.value)}
                />
              </div>
              <Button onClick={handleProposeInterview} disabled={proposing} className="w-fit gap-1.5">
                <CalendarClock className="h-4 w-4" />
                {proposing
                  ? "Gönderiliyor..."
                  : interview
                    ? "Yeniden planla"
                    : "Mülakat teklif et"}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!debate ? (
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-sm">Değerlendirme</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                İlanın iş tanımı kullanılarak İyimser/Kötümser/Hakem ajan sürecini başlatın.
              </p>
              <div className="flex items-center gap-2">
                <Select value={language} onValueChange={(value) => setLanguage(value ?? "tr")}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tr">Türkçe</SelectItem>
                    <SelectItem value="en">İngilizce</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleRunDebate} disabled={running}>
                  {running ? "İyimser, kötümser ve hakem ajanlar çalışıyor..." : "Değerlendirmeyi başlat"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {debate ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-foreground">Değerlendirme sonucu</h2>
              <div className="flex items-center gap-2">
                <Select value={language} onValueChange={(value) => setLanguage(value ?? "tr")}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tr">Türkçe</SelectItem>
                    <SelectItem value="en">İngilizce</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={handleRunDebate} disabled={running}>
                  {running ? "Çalışıyor..." : "Yeniden değerlendir"}
                </Button>
              </div>
            </div>

            {debate.pre_llm_score != null ? (
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="text-sm">Pre-LLM aşaması (embedding + donanım)</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col items-center gap-1 rounded-md bg-muted/60 py-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">İlan uyumu (embedding)</span>
                    <span className="text-lg font-semibold">
                      {debate.relevance_score != null ? debate.relevance_score.toFixed(3) : "—"}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 rounded-md bg-muted/60 py-3">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Donanım puanı</span>
                    <span className="text-lg font-semibold">
                      {debate.competency_score != null ? debate.competency_score.toFixed(3) : "—"}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 rounded-md bg-primary/5 py-3">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Pre-LLM birleşik puan</span>
                    <span className="text-lg font-semibold text-primary">
                      {debate.pre_llm_score.toFixed(3)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : null}

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
                {applicationStatus === "selected" ? (
                  <StatusBadge tone="green">Seçildi</StatusBadge>
                ) : applicationStatus === "rejected" ? (
                  <StatusBadge tone="red">Elendi</StatusBadge>
                ) : (
                  <StatusBadge tone="gray">Karar bekliyor</StatusBadge>
                )}
              </CardHeader>
              <CardContent>
                <Markdown>{debate.arbitrator_rationale}</Markdown>
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
                  <Markdown>{debate.optimist_arguments}</Markdown>
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
                  <Markdown>{debate.pessimist_arguments}</Markdown>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
