"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Briefcase, CalendarClock, Plus, Users } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost, ApiError } from "@/lib/api";
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

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ postings: JobPosting[] }>("/api/org/postings");
      setPostings(data.postings);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İlanlar yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
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
      toast.success("İlan oluşturuldu.");
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">İş ilanları</h1>
          <p className="text-sm text-muted-foreground">
            Her ilan kendi CV havuzuna, filtrelerine ve değerlendirmesine sahiptir.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button className="gap-1.5" />}>
            <Plus className="h-4 w-4" />
            Yeni ilan
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Yeni iş ilanı</DialogTitle>
              <DialogDescription>
                İş tanımı, adayları semantik olarak sıralamak ve değerlendirmek için kullanılır.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">İlan başlığı</Label>
                <Input
                  id="title"
                  placeholder="Örn: Backend Geliştirici"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description">İş tanımı</Label>
                <Textarea
                  id="description"
                  placeholder="Aranan nitelikler, sorumluluklar, teknolojiler..."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deadline">Son başvuru tarihi (opsiyonel)</Label>
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
                  {creating ? "Oluşturuluyor..." : "Oluştur"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {postings?.map((posting) => {
          const deadline = formatDate(posting.deadline_at);
          return (
            <Link key={posting.id} href={`/org/dashboard/postings/${posting.id}`}>
              <Card className="h-full border-border/60 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-3 px-5 py-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Briefcase className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{posting.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {posting.description}
                    </p>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {posting.candidate_count} CV
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
        {postings?.length === 0 ? (
          <Card className="border-dashed border-border/60 bg-muted/30 sm:col-span-2 lg:col-span-3">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Henüz bir iş ilanı yok. Başlamak için &quot;Yeni ilan&quot; butonunu kullanın.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
