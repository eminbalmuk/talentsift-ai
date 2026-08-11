"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Award, CalendarClock, CheckCircle2, Search, TrendingUp, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet, apiPost, apiUpload, ApiError } from "@/lib/api";
import type { Candidate, JobPosting, RankedCandidate, TopResult, UploadResult } from "@/lib/types";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
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
      const params = new URLSearchParams();
      if (minGpa) params.set("min_gpa", minGpa);
      if (classYear) params.set("class_year", classYear);
      if (minExperience) params.set("min_experience_years", minExperience);
      const data = await apiGet<{ candidates: Candidate[] }>(
        `/api/org/postings/${postingId}/candidates?${params.toString()}`,
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
        `/api/org/postings/${postingId}/rankings/top?limit=10`,
      );
      setResults(data.results);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sıralama yüklenemedi.");
    }
  }, [postingId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    loadPosting();
    loadCandidates();
    loadRankings();
  }, [loadPosting, loadCandidates, loadRankings]);

  async function handleSemanticSearch() {
    setSearching(true);
    try {
      const data = await apiPost<{ candidates: RankedCandidate[] }>(
        `/api/org/postings/${postingId}/candidates/search`,
        {
          min_gpa: minGpa ? Number(minGpa) : undefined,
          class_year: classYear ? Number(classYear) : undefined,
          min_experience_years: minExperience ? Number(minExperience) : undefined,
          limit: 50,
        },
      );
      setCandidates(data.candidates);
      setSemantic(true);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Semantik arama başarısız oldu.");
    } finally {
      setSearching(false);
    }
  }

  async function handleUpload() {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      toast.error("Önce en az bir PDF seçin.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const data = await apiUpload<UploadResult>(
        `/api/org/postings/${postingId}/candidates/upload`,
        formData,
      );
      if (data.created.length > 0) {
        toast.success(`${data.created.length} CV işlendi.`);
      }
      if (data.errors.length > 0) {
        data.errors.forEach((error) => toast.error(`${error.filename}: ${error.detail}`));
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadPosting();
      await loadCandidates();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Yükleme başarısız oldu.");
    } finally {
      setUploading(false);
    }
  }

  if (!posting) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const deadline = formatDate(posting.deadline_at);
  const averageScore =
    results && results.length > 0
      ? (results.reduce((sum, r) => sum + Number(r.final_score), 0) / results.length).toFixed(1)
      : "—";
  const topScore =
    results && results.length > 0
      ? Math.max(...results.map((r) => Number(r.final_score))).toFixed(1)
      : "—";

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/60">
        <CardContent className="flex flex-col gap-3 px-5 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {posting.title}
            </h1>
            {deadline ? (
              <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                Son başvuru: {deadline}
              </span>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {posting.description}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Yüklenen CV" value={posting.candidate_count} icon={Users} />
        <StatCard label="Değerlendirilen" value={posting.debate_count} icon={CheckCircle2} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-sm">CV yükle</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input ref={fileInputRef} type="file" accept="application/pdf" multiple />
          <Button onClick={handleUpload} disabled={uploading} className="w-fit gap-1.5">
            <Upload className="h-4 w-4" />
            {uploading ? "Yükleniyor ve işleniyor..." : "Yükle"}
          </Button>
          <p className="text-xs text-muted-foreground">
            PDF CV&apos;ler OCR ile okunur, yapılandırılır ve embedding&apos;i çıkarılır. Aynı anda
            en fazla 20 dosya.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="candidates">
        <TabsList>
          <TabsTrigger value="candidates">Adaylar</TabsTrigger>
          <TabsTrigger value="rankings">Nihai sıralama</TabsTrigger>
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
                    value={minExperience}
                    onChange={(event) => setMinExperience(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={loadCandidates}>
                  Filtrele
                </Button>
                <Button onClick={handleSemanticSearch} disabled={searching} className="gap-1.5">
                  <Search className="h-4 w-4" />
                  {searching ? "Sıralanıyor..." : "İş tanımına göre sırala"}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden border-border/60 p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Ad</TableHead>
                  <TableHead className="hidden sm:table-cell">Üniversite</TableHead>
                  <TableHead>GANO</TableHead>
                  <TableHead className="hidden md:table-cell">Sınıf</TableHead>
                  <TableHead className="hidden md:table-cell">Deneyim</TableHead>
                  {semantic ? <TableHead>Benzerlik</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates?.map((candidate) => (
                  <TableRow key={candidate.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/org/dashboard/postings/${postingId}/candidates/${candidate.id}`}
                        className="hover:underline"
                      >
                        {candidate.full_name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {candidate.university ?? "—"}
                    </TableCell>
                    <TableCell>{candidate.gpa ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {candidate.current_class === 5 ? "Mezun" : candidate.current_class}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {candidate.experience_years} yıl
                    </TableCell>
                    {semantic ? (
                      <TableCell>{(candidate as RankedCandidate).similarity.toFixed(3)}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
                {candidates?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={semantic ? 6 : 5} className="py-10 text-center text-sm text-muted-foreground">
                      Henüz CV yüklenmedi veya kriterlere uyan aday yok.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="rankings" className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Ortalama puan" value={averageScore} icon={TrendingUp} />
            <StatCard label="En yüksek puan" value={topScore} icon={Award} />
          </div>

          <Card className="overflow-hidden border-border/60 p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Aday</TableHead>
                  <TableHead className="hidden sm:table-cell">Üniversite</TableHead>
                  <TableHead>Nihai puan</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results?.map((result) => (
                  <TableRow key={result.candidate_id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/org/dashboard/postings/${postingId}/candidates/${result.candidate_id}`}
                        className="hover:underline"
                      >
                        {result.full_name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {result.university ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">{Number(result.final_score).toFixed(1)}</TableCell>
                    <TableCell>
                      {result.is_selected ? (
                        <StatusBadge tone="green">Seçildi</StatusBadge>
                      ) : (
                        <StatusBadge tone="gray">Beklemede</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {results?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      Henüz değerlendirme yapılmadı.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
