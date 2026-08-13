"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Plus,
  Search,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/stat-card";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import type { JobPosting } from "@/lib/types";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

export default function PostingsPage() {
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ postings: JobPosting[] }>("/api/org/postings");
      setPostings(data.postings);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlanlar yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      await apiPost("/api/org/postings", {
        title,
        description,
        deadline_at: deadline || null,
      });
      toast.success("İlan başarıyla oluşturuldu.");
      setDialogOpen(false);
      setTitle("");
      setDescription("");
      setDeadline("");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan oluşturulamadı.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeletePosting(postingId: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Bu iş ilanını ve bağlı başvuruları silmek istediğinizden emin misiniz?")) return;

    try {
      await apiDelete(`/api/org/postings/${postingId}`);
      toast.success("İlan silindi.");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan silinemedi.");
    }
  }

  async function handleToggleStatus(postingId: number, currentActive: boolean, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await apiPatch(`/api/org/postings/${postingId}/status`, { is_active: !currentActive });
      toast.success(`İlan ${!currentActive ? "yayına alındı" : "yayından kaldırıldı"}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan durumu güncellenemedi.");
    }
  }

  const filteredPostings = (postings || []).filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  });

  const totalCandidates = (postings || []).reduce((acc, p) => acc + (p.candidate_count || 0), 0);
  const activePostingsCount = (postings || []).filter((p) => p.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header & Create Dialog */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">İş İlanları & Aday Eleme</h1>
          <p className="text-sm text-muted-foreground">
            Aday portali başvuruları ve Pre-LLM Reranking (Cross-Encoder + Donanım Puanlama) paneli.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button className="gap-1.5 shrink-0" />}>
            <Plus className="h-4 w-4" />
            Yeni İlan Oluştur
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Yeni İş İlanı Aç</DialogTitle>
              <DialogDescription>
                İş tanımı, BGE Cross-Encoder ve LangGraph multi-agent düellosunda adayın ilana uygunluğunu ölçmek için kullanılır.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">İlan Başlığı</Label>
                <Input
                  id="title"
                  placeholder="Örn: Senior Python & AI Engineer"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description">İş Tanımı & Nitelikler</Label>
                <Textarea
                  id="description"
                  placeholder="Aranan yetenekler, sorumluluklar, mimari beklentiler..."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deadline">Son Başvuru Tarihi (Opsiyonel)</Label>
                <Input
                  id="deadline"
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Oluşturuluyor..." : "İlanı Yayınla"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Counters */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Toplam Yayınlanan İlan" value={postings?.length ?? 0} icon={Briefcase} />
        <StatCard label="Yayındaki Aktif İlanlar" value={activePostingsCount} icon={CheckCircle2} />
        <StatCard label="Toplam Başvuru & Aday" value={totalCandidates} icon={Users} />
      </div>

      {/* Search & Filter Bar */}
      <div className="flex items-center justify-between gap-3 bg-card/60 p-3 rounded-xl border border-border/40">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="İlanlar arasında ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs sm:text-sm h-9"
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {filteredPostings.length} ilan gösteriliyor
        </span>
      </div>

      {/* Postings Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPostings.map((posting) => {
          const deadline = formatDate(posting.deadline_at);
          return (
            <Link key={posting.id} href={`/org/dashboard/postings/${posting.id}`}>
              <Card className="h-full border-border/60 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md flex flex-col justify-between bg-card/80 backdrop-blur-sm">
                <CardContent className="flex h-full flex-col gap-3 px-5 py-5">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Briefcase className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge
                        variant={posting.is_active ? "default" : "outline"}
                        className="cursor-pointer text-[10px]"
                        onClick={(e) => handleToggleStatus(posting.id, posting.is_active, e)}
                      >
                        {posting.is_active ? "Yayında" : "Pasif"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => handleDeletePosting(posting.id, e)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-base leading-snug">{posting.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                      {posting.description}
                    </p>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-3 border-t border-border/40 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      {posting.candidate_count} Aday Başvurusu
                    </span>
                    {deadline ? (
                      <span className="flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {deadline}
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {filteredPostings.length === 0 ? (
          <Card className="border-dashed border-border/60 bg-muted/30 col-span-full">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {searchQuery ? "Arama kriterine uygun ilan bulunamadı." : "Henüz bir iş ilanı yok. Başlamak için 'Yeni İlan Oluştur' butonunu kullanın."}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
