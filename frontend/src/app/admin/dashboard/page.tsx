"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, KeyRound, Plus, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LicenseStatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import type { Organization, OrganizationCredential } from "@/lib/types";

type RowEdit = { license_status: string; is_active: boolean; license_expires_at: string };

function toDateValue(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export default function AdminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState<OrganizationCredential | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ organizations: Organization[] }>("/api/admin/organizations");
      setOrganizations(data.organizations);
      setEdits(
        Object.fromEntries(
          data.organizations.map((org) => [
            org.id,
            {
              license_status: org.license_status,
              is_active: org.is_active,
              license_expires_at: toDateValue(org.license_expires_at),
            },
          ]),
        ),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Organizasyonlar yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  const totals = useMemo(() => {
    if (!organizations) return { total: 0, active: 0, candidates: 0, debates: 0 };
    return organizations.reduce(
      (acc, org) => ({
        total: acc.total + 1,
        active: acc.active + (org.is_active ? 1 : 0),
        candidates: acc.candidates + org.candidate_count,
        debates: acc.debates + org.debate_count,
      }),
      { total: 0, active: 0, candidates: 0, debates: 0 },
    );
  }, [organizations]);

  async function handleSave(organizationId: number) {
    const edit = edits[organizationId];
    if (!edit) return;
    setSavingId(organizationId);
    try {
      await apiPatch(`/api/admin/organizations/${organizationId}/license`, {
        license_status: edit.license_status,
        is_active: edit.is_active,
        license_expires_at: edit.license_expires_at || null,
        notes: null,
      });
      toast.success("Lisans güncellendi.");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Güncelleme başarısız oldu.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleApprove(organizationId: number) {
    setSavingId(organizationId);
    try {
      const data = await apiPost<{ message: string; license_key?: string }>(
        `/api/admin/organizations/${organizationId}/approve`,
      );
      toast.success(
        data.license_key
          ? `Organizasyon onaylandı ve aktifleştirildi! Lisans anahtarı: ${data.license_key}`
          : "Organizasyon onaylandı ve hesabı aktifleştirildi.",
        { duration: 15000 },
      );
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Onay işlemi başarısız oldu.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleRotate(organizationId: number) {
    setRotatingId(organizationId);
    try {
      const data = await apiPost<{ display_name: string; license_key: string }>(
        `/api/admin/organizations/${organizationId}/license/rotate`,
      );
      toast.success(`${data.display_name} için yeni lisans anahtarı: ${data.license_key}`, {
        duration: 15000,
      });
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Anahtar döndürülemedi.");
    } finally {
      setRotatingId(null);
    }
  }

  async function handleDelete(organizationId: number, displayName: string) {
    if (
      !confirm(
        `"${displayName}" organizasyonunu kalıcı olarak silmek istediğinizden emin misiniz? Tüm ilanları, başvuruları ve değerlendirmeleri de silinecek. Bu işlem geri alınamaz.`,
      )
    ) {
      return;
    }
    setDeletingId(organizationId);
    try {
      await apiDelete(`/api/admin/organizations/${organizationId}`);
      toast.success(`"${displayName}" organizasyonu silindi.`);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Organizasyon silinemedi.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const data = await apiPost<OrganizationCredential>("/api/admin/organizations", {
        display_name: displayName,
        notes: notes || null,
      });
      setCredential(data);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Organizasyon oluşturulamadı.");
    } finally {
      setCreating(false);
    }
  }

  function openDialog(open: boolean) {
    setDialogOpen(open);
    if (open) {
      setDisplayName("");
      setNotes("");
      setCredential(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Organizasyon" value={totals.total} icon={Building2} />
        <StatCard label="Aktif lisans" value={totals.active} icon={KeyRound} />
        <StatCard label="Toplam aday" value={totals.candidates} icon={Users} />
        <StatCard label="Değerlendirme" value={totals.debates} icon={RefreshCw} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Organizasyonlar</h1>
          <p className="text-sm text-muted-foreground">
            {organizations ? `${organizations.length} organizasyon` : "Yükleniyor..."}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={openDialog}>
          <DialogTrigger render={<Button className="gap-1.5" />}>
            <Plus className="h-4 w-4" />
            Organizasyon ekle
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Yeni organizasyon</DialogTitle>
              <DialogDescription>
                Rastgele kullanıcı adı, parola ve lisans anahtarı bir kez oluşturulup gösterilir.
              </DialogDescription>
            </DialogHeader>
            {credential ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed break-all">
                  Kullanıcı adı: {credential.username}
                  <br />
                  Parola: {credential.password}
                  <br />
                  Lisans anahtarı: {credential.license_key}
                </div>
                <p className="text-xs text-muted-foreground">
                  Bu bilgiler yalnızca burada gösterilir, tekrar görüntülenemez.
                </p>
                <DialogFooter>
                  <Button onClick={() => setDialogOpen(false)}>Kapat</Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="displayName">Görünen ad</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="notes">Not</Label>
                  <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
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
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden border-border/60 p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Ad</TableHead>
              <TableHead className="hidden sm:table-cell">Giriş</TableHead>
              <TableHead className="hidden lg:table-cell">Lisans anahtarı</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="hidden md:table-cell">Bitiş</TableHead>
              <TableHead className="hidden lg:table-cell">Kullanım</TableHead>
              <TableHead className="text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations?.map((org) => {
              const edit = edits[org.id];
              if (!edit) return null;
              return (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.display_name}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {org.username ?? "—"}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                    {org.license_key_prefix ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={edit.license_status}
                      onValueChange={(value) => {
                        if (!value) return;
                        setEdits((prev) => ({ ...prev, [org.id]: { ...prev[org.id], license_status: value } }));
                      }}
                    >
                      <SelectTrigger className="h-8 w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["active", "trial", "pending", "suspended", "expired"].map((status) => (
                          <SelectItem key={status} value={status}>
                            <LicenseStatusBadge status={status} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Input
                      type="date"
                      className="h-8 w-[140px]"
                      value={edit.license_expires_at}
                      onChange={(event) =>
                        setEdits((prev) => ({
                          ...prev,
                          [org.id]: { ...prev[org.id], license_expires_at: event.target.value },
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {org.candidate_count} CV / {org.debate_count} değerlendirme
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {org.license_status === "pending" || !org.is_active ? (
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs gap-1"
                          disabled={savingId === org.id}
                          onClick={() => handleApprove(org.id)}
                        >
                          Onayla & Aktifleştir
                        </Button>
                      ) : null}
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={edit.is_active}
                          onChange={(event) =>
                            setEdits((prev) => ({
                              ...prev,
                              [org.id]: { ...prev[org.id], is_active: event.target.checked },
                            }))
                          }
                          className="h-3.5 w-3.5"
                        />
                        Aktif
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingId === org.id}
                        onClick={() => handleSave(org.id)}
                      >
                        Kaydet
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rotatingId === org.id}
                        onClick={() => handleRotate(org.id)}
                      >
                        Anahtarı yenile
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={deletingId === org.id}
                        onClick={() => handleDelete(org.id, org.display_name)}
                      >
                        {deletingId === org.id ? "Siliniyor..." : "Sil"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {organizations?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Henüz organizasyon yok. Başlamak için &quot;Organizasyon ekle&quot; butonunu kullanın.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
