"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import type { JobPosting } from "@/lib/types";
import { cn } from "@/lib/utils";

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

function isDeadlineExpired(deadlineAt: string | null): boolean {
  if (!deadlineAt) return false;
  const parsed = new Date(deadlineAt);
  if (Number.isNaN(parsed.getTime())) return false;
  const endOfDeadline = /^\d{4}-\d{2}-\d{2}$/.test(deadlineAt)
    ? new Date(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
        23,
        59,
        59,
        999,
      )
    : parsed;
  return endOfDeadline.getTime() < Date.now();
}

export default function PostingsPage() {
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobPosting | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ postings: JobPosting[] }>("/api/org/postings");
      setPostings(data.postings);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlanlar yüklenemedi.");
      setPostings([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error("İlan başlığı ve iş tanımı alanları zorunludur.");
      return;
    }
    setCreating(true);
    try {
      await apiPost("/api/org/postings", {
        title: title.trim(),
        description: description.trim(),
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

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/org/postings/${deleteTarget.id}`);
      toast.success(`"${deleteTarget.title}" ilanı silindi.`);
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan silinemedi.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleStatus(posting: JobPosting) {
    setTogglingId(posting.id);
    try {
      await apiPatch(`/api/org/postings/${posting.id}/status`, {
        is_active: !posting.is_active,
      });
      toast.success(
        `"${posting.title}" ilanı ${!posting.is_active ? "aktif hale getirildi" : "pasife alındı"}.`,
      );
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlan durumu güncellenemedi.");
    } finally {
      setTogglingId(null);
    }
  }

  const allPostings = postings ?? [];
  const filteredPostings = allPostings.filter((posting) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      posting.title.toLowerCase().includes(q) || posting.description.toLowerCase().includes(q)
    );
  });

  const totalCandidates = allPostings.reduce((acc, p) => acc + (p.candidate_count || 0), 0);
  const activePostingsCount = allPostings.filter(
    (p) => p.is_active && !isDeadlineExpired(p.deadline_at),
  ).length;
  const showSearchBar = allPostings.length > 3;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            İş İlanları & Aday Değerlendirme
          </h1>
          <p className="text-sm text-muted-foreground">
            Açık pozisyonlarınızı yönetin, başvuruları hibrit ön eleme ve yapay zeka jürisi ile
            sıralayın.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button className="shrink-0 gap-1.5" />}>
            <Plus className="h-4 w-4" />
            Yeni İlan Oluştur
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Yeni İş İlanı Aç</DialogTitle>
              <DialogDescription>
                İş tanımı; anlamsal/anahtar kelime ön eleme sıralamasında ve çoklu ajan jüri
                değerlendirmesinde adayın uygunluğunu ölçmek için kullanılır.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="posting-title">İlan Başlığı</Label>
                <Input
                  id="posting-title"
                  autoComplete="off"
                  placeholder="Örn: Kıdemli Python ve Yapay Zeka Mühendisi"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="posting-description">İş Tanımı & Nitelikler</Label>
                <Textarea
                  id="posting-description"
                  autoComplete="off"
                  placeholder="Aranan teknik yetkinlikler, sorumluluklar ve deneyim beklentileri..."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="posting-deadline">Son Başvuru Tarihi (Opsiyonel)</Label>
                <Input
                  id="posting-deadline"
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={creating}
                >
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

      {postings === null ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Toplam İlan"
            value={allPostings.length}
            icon={Briefcase}
            className="tabular-nums"
          />
          <StatCard
            label="Aktif İlanlar"
            value={activePostingsCount}
            icon={CheckCircle2}
            className="tabular-nums"
          />
          <StatCard
            label="Toplam Başvuru & Aday"
            value={totalCandidates}
            icon={Users}
            className="tabular-nums"
          />
        </div>
      )}

      {showSearchBar ? (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/40 bg-card/60 p-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-sm">
            <Label htmlFor="posting-search" className="sr-only">
              İlanlarda ara
            </Label>
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="posting-search"
              type="search"
              placeholder="İlan başlığı veya açıklamaya göre ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9 text-xs sm:text-sm"
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {filteredPostings.length} / {allPostings.length} ilan gösteriliyor
          </span>
        </div>
      ) : null}

      {postings === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <Skeleton key={idx} className="h-52 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredPostings.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-muted/30">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Briefcase className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                {searchQuery.trim()
                  ? "Arama kriterine uygun ilan bulunamadı"
                  : "Henüz yayınlanmış bir iş ilanı yok"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {searchQuery.trim()
                  ? "Farklı bir anahtar kelime deneyebilir veya aramayı temizleyebilirsiniz."
                  : "Aday toplamaya ve değerlendirmeye başlamak için yeni bir iş ilanı oluşturun."}
              </p>
            </div>
            {searchQuery.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSearchQuery("")}
              >
                Aramayı Temizle
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPostings.map((posting) => {
            const formattedDeadline = formatDate(posting.deadline_at);
            const expired = isDeadlineExpired(posting.deadline_at);
            const isToggling = togglingId === posting.id;

            return (
              <Card
                key={posting.id}
                className="flex h-full flex-col justify-between border-border/60 bg-card/85 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md"
              >
                <CardContent className="flex h-full flex-col gap-3 px-5 py-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Briefcase className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </div>
                    {expired ? (
                      <StatusBadge tone="red">Süresi Doldu</StatusBadge>
                    ) : posting.is_active ? (
                      <StatusBadge tone="green">Aktif</StatusBadge>
                    ) : (
                      <StatusBadge tone="gray">Pasif</StatusBadge>
                    )}
                  </div>

                  <Link
                    href={`/org/dashboard/postings/${posting.id}`}
                    className="group block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <h2 className="text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                      {posting.title}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {posting.description}
                    </p>
                  </Link>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium tabular-nums">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      {posting.candidate_count} Aday
                    </span>
                    {formattedDeadline ? (
                      <span className="flex items-center gap-1.5 tabular-nums">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {formattedDeadline}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Link
                      href={`/org/dashboard/postings/${posting.id}`}
                      aria-label={`${posting.title} ilanını incele`}
                      className={cn(
                        buttonVariants({ variant: "default", size: "sm" }),
                        "gap-1.5 text-xs",
                      )}
                    >
                      İncele
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isToggling}
                        aria-label={`${posting.title} ilan durumunu değiştir`}
                        onClick={() => handleToggleStatus(posting)}
                        className="gap-1 text-xs"
                      >
                        {posting.is_active ? (
                          <>
                            <PauseCircle className="h-3.5 w-3.5" />
                            Durumu Değiştir
                          </>
                        ) : (
                          <>
                            <PlayCircle className="h-3.5 w-3.5" />
                            Durumu Değiştir
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${posting.title} ilanını sil`}
                        onClick={() => setDeleteTarget(posting)}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="İş İlanını Sil"
        description={
          deleteTarget
            ? `"${deleteTarget.title}" ilanını ve bu ilana bağlı tüm aday başvurularını, değerlendirmeleri ve mülakat kayıtlarını kalıcı olarak silmek istediğinize emin misiniz?`
            : ""
        }
        confirmLabel="İlanı Sil"
        cancelLabel="Vazgeç"
        variant="destructive"
        busy={deleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
