"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { Candidate, RankedCandidate } from "@/lib/types";

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export default function CandidatesPage() {
  const [minGpa, setMinGpa] = useState("");
  const [classYear, setClassYear] = useState("");
  const [minExperience, setMinExperience] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<(Candidate | RankedCandidate)[] | null>(null);
  const [semantic, setSemantic] = useState(false);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ candidates: Candidate[] }>(
        `/api/org/candidates${toQuery({
          min_gpa: minGpa,
          class_year: classYear,
          min_experience_years: minExperience,
          limit: 50,
        })}`,
      );
      setCandidates(data.candidates);
      setSemantic(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Adaylar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [minGpa, classYear, minExperience]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    loadCandidates();
  }, [loadCandidates]);

  async function handleSemanticSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!jobDescription.trim()) {
      loadCandidates();
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost<{ candidates: RankedCandidate[] }>("/api/org/candidates/search", {
        job_description: jobDescription,
        min_gpa: minGpa ? Number(minGpa) : undefined,
        class_year: classYear ? Number(classYear) : undefined,
        min_experience_years: minExperience ? Number(minExperience) : undefined,
        limit: 50,
      });
      setCandidates(data.candidates);
      setSemantic(true);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Semantik arama başarısız oldu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Adaylar</h1>
        <p className="text-sm text-muted-foreground">
          SQL filtreleriyle listeleyin veya bir iş tanımı girerek semantik olarak sıralayın.
        </p>
      </div>

      <Card className="border-border/60 p-4">
        <form onSubmit={handleSemanticSearch} className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jobDescription">İş tanımı (semantik sıralama için opsiyonel)</Label>
            <Textarea
              id="jobDescription"
              placeholder="Örn: RAG ve LLM bilen, Python tecrübesi olan backend geliştirici"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              rows={3}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={loading} className="gap-1.5">
              <Search className="h-4 w-4" />
              {jobDescription.trim() ? "Semantik ara" : "Filtrele"}
            </Button>
            {jobDescription.trim() ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setJobDescription("");
                  loadCandidates();
                }}
              >
                Temizle
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden border-border/60 p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Ad</TableHead>
              <TableHead>Üniversite</TableHead>
              <TableHead>GANO</TableHead>
              <TableHead>Sınıf</TableHead>
              <TableHead>Deneyim</TableHead>
              {semantic ? <TableHead>Benzerlik</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates?.map((candidate) => (
              <TableRow key={candidate.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/org/dashboard/candidates/${candidate.id}`}
                    className="hover:underline"
                  >
                    {candidate.full_name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{candidate.university ?? "—"}</TableCell>
                <TableCell>{candidate.gpa ?? "—"}</TableCell>
                <TableCell>{candidate.current_class === 5 ? "Mezun" : candidate.current_class}</TableCell>
                <TableCell>{candidate.experience_years} yıl</TableCell>
                {semantic ? (
                  <TableCell>{(candidate as RankedCandidate).similarity.toFixed(3)}</TableCell>
                ) : null}
              </TableRow>
            ))}
            {candidates?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={semantic ? 6 : 5} className="py-10 text-center text-sm text-muted-foreground">
                  Kriterlere uyan aday bulunamadı.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
