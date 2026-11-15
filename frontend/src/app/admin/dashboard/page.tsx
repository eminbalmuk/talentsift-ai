"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Database,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatCard } from "@/components/stat-card";
import { StatusBadge, getStatusMeta } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import type {
  Organization,
  OrganizationCredential,
  OrganizationPasswordReset,
  SystemStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type RowEdit = {
  license_status: string;
  is_active: boolean;
  license_expires_at: string;
};

type StatusFilter = "all" | "pending" | "active" | "trial" | "inactive";

type ConfirmAction =
  | { type: "rotate"; org: Organization }
  | { type: "reset_password"; org: Organization }
  | { type: "delete"; org: Organization }
  | null;

type SecretModalState = {
  title: string;
  description: string;
  organizationName: string;
  username?: string | null;
  password?: string | null;
  licenseKey?: string | null;
} | null;

const LICENSE_STATUS_OPTIONS: { value: Organization["license_status"]; label: string }[] = [
  { value: "active", label: "Aktif" },
  { value: "trial", label: "Deneme" },
  { value: "pending", label: "Beklemede" },
  { value: "suspended", label: "Askıda" },
  { value: "expired", label: "Süresi Doldu" },
];

function toDateValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function buildRowEdits(orgs: Organization[]): Record<number, RowEdit> {
  const next: Record<number, RowEdit> = {};
  for (const org of orgs) {
    next[org.id] = {
      license_status: org.license_status,
      is_active: org.is_active,
      license_expires_at: toDateValue(org.license_expires_at),
    };
  }
  return next;
}

export default function AdminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [savingId, setSavingId] = useState<number | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [secretModal, setSecretModal] = useState<SecretModalState>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [notesOrg, setNotesOrg] = useState<Organization | null>(null);
  const [editedNotes, setEditedNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [orgRes, statusRes] = await Promise.allSettled([
        apiGet<{ organizations: Organization[] }>("/api/admin/organizations"),
        apiGet<SystemStatus>("/api/admin/system/status"),
      ]);

      if (orgRes.status === "fulfilled") {
        setOrganizations(orgRes.value.organizations);
        setEdits(buildRowEdits(orgRes.value.organizations));
      } else {
        const err = orgRes.reason;
        toast.error(err instanceof ApiError ? err.message : "Kurumlar yüklenemedi.");
      }

      if (statusRes.status === "fulfilled") {
        setSystemStatus(statusRes.value);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const [orgRes, statusRes] = await Promise.allSettled([
        apiGet<{ organizations: Organization[] }>("/api/admin/organizations"),
        apiGet<SystemStatus>("/api/admin/system/status"),
      ]);
      if (cancelled) return;
      if (orgRes.status === "fulfilled") {
        setOrganizations(orgRes.value.organizations);
        setEdits(buildRowEdits(orgRes.value.organizations));
      } else {
        const err = orgRes.reason;
        toast.error(err instanceof ApiError ? err.message : "Kurumlar yüklenemedi.");
      }
      if (statusRes.status === "fulfilled") {
        setSystemStatus(statusRes.value);
      }
      setLoading(false);
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
  }

  async function copyText(labelKey: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(labelKey);
      toast.success("Panoya kopyalandı.");
      window.setTimeout(() => {
        setCopiedKey((current) => (current === labelKey ? null : current));
      }, 2000);
    } catch {
      toast.error("Panoya kopyalanamadı. Lütfen metni manuel seçin.");
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error("Kurum adı gereklidir.");
      return;
    }

    setCreating(true);
    try {
      const created = await apiPost<OrganizationCredential>("/api/admin/organizations", {
        display_name: trimmed,
        notes: notes.trim() || null,
      });
      setDisplayName("");
      setNotes("");
      setSecretModal({
        title: "Yeni Kurum Hesabı Oluşturuldu",
        description:
          "Bu giriş bilgileri güvenlik nedeniyle yalnızca bir kez görüntülenir. Kaydetmeden pencereyi kapatmayın.",
        organizationName: created.display_name,
        username: created.username,
        password: created.password,
        licenseKey: created.license_key,
      });
      toast.success(`${created.display_name} oluşturuldu.`);
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Kurum oluşturulamadı.");
    } finally {
      setCreating(false);
    }
  }

  function updateEdit(orgId: number, patch: Partial<RowEdit>) {
    setEdits((prev) => ({
      ...prev,
      [orgId]: { ...prev[orgId], ...patch },
    }));
  }

  async function handleSave(org: Organization) {
    const row = edits[org.id];
    if (!row) return;
    setSavingId(org.id);
    try {
      await apiPatch(`/api/admin/organizations/${org.id}/license`, {
        license_status: row.license_status,
        is_active: row.is_active,
        license_expires_at: row.license_expires_at || null,
        notes: null,
      });
      toast.success(`${org.display_name} lisans ayarları güncellendi.`);
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Güncelleme başarısız oldu.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveNotes() {
    if (!notesOrg) return;
    setSavingNotes(true);
    try {
      await apiPatch(`/api/admin/organizations/${notesOrg.id}/license`, {
        license_status: notesOrg.license_status,
        is_active: notesOrg.is_active,
        license_expires_at: toDateValue(notesOrg.license_expires_at) || null,
        notes: editedNotes.trim(),
      });
      toast.success(`${notesOrg.display_name} notu kaydedildi.`);
      setNotesOrg(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Not kaydedilemedi.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleApprove(org: Organization) {
    setApprovingId(org.id);
    try {
      const result = await apiPost<{
        status: string;
        message: string;
        license_key?: string | null;
      }>(`/api/admin/organizations/${org.id}/approve`, {});
      toast.success(result.message || `${org.display_name} onaylandı.`);
      if (result.license_key) {
        setSecretModal({
          title: "Kurum Onaylandı ve Aktifleştirildi",
          description:
            "Kuruma yeni üretim lisans anahtarı tanımlandı. Bu anahtar güvenlik nedeniyle tek seferlik gösterilir.",
          organizationName: org.display_name,
          username: org.username,
          licenseKey: result.license_key,
        });
      }
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Onaylama başarısız oldu.");
    } finally {
      setApprovingId(null);
    }
  }

  async function executeConfirmedAction() {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      if (confirmAction.type === "rotate") {
        const result = await apiPost<{ license_key: string }>(
          `/api/admin/organizations/${confirmAction.org.id}/license/rotate`,
          {},
        );
        setSecretModal({
          title: "Lisans Anahtarı Yenilendi",
          description:
            "Eski lisans anahtarı geçersiz kılındı. Yeni anahtarı kurum yetkilisine iletin.",
          organizationName: confirmAction.org.display_name,
          licenseKey: result.license_key,
        });
        toast.success(`${confirmAction.org.display_name} lisans anahtarı yenilendi.`);
      } else if (confirmAction.type === "reset_password") {
        const result = await apiPost<OrganizationPasswordReset>(
          `/api/admin/organizations/${confirmAction.org.id}/password/reset`,
          {},
        );
        setSecretModal({
          title: "Kurum Şifresi Sıfırlandı",
          description:
            "Yeni geçici şifre oluşturuldu. Güvenlik nedeniyle yalnızca bir kez görüntülenir.",
          organizationName: confirmAction.org.display_name,
          username: result.username,
          password: result.password,
        });
        toast.success(`${confirmAction.org.display_name} için yeni şifre oluşturuldu.`);
      } else if (confirmAction.type === "delete") {
        await apiDelete(`/api/admin/organizations/${confirmAction.org.id}`);
        toast.success(`${confirmAction.org.display_name} kalıcı olarak silindi.`);
      }
      setConfirmAction(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "İşlem başarısız oldu.");
    } finally {
      setConfirmBusy(false);
    }
  }

  const metrics = useMemo(() => {
    const active = organizations.filter(
      (org) => org.is_active && (org.license_status === "active" || org.license_status === "trial"),
    ).length;
    const pending = organizations.filter((org) => org.license_status === "pending").length;
    const trial = organizations.filter((org) => org.license_status === "trial").length;
    const inactive = organizations.filter(
      (org) =>
        !org.is_active || org.license_status === "suspended" || org.license_status === "expired",
    ).length;
    const candidates = organizations.reduce((acc, org) => acc + org.candidate_count, 0);
    const debates = organizations.reduce((acc, org) => acc + org.debate_count, 0);
    return { active, pending, trial, inactive, candidates, debates };
  }, [organizations]);

  const filteredOrganizations = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return organizations.filter((org) => {
      if (statusFilter === "pending" && org.license_status !== "pending") return false;
      if (statusFilter === "active" && (!org.is_active || org.license_status !== "active")) {
        return false;
      }
      if (statusFilter === "trial" && org.license_status !== "trial") return false;
      if (
        statusFilter === "inactive" &&
        org.is_active &&
        org.license_status !== "suspended" &&
        org.license_status !== "expired"
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        org.display_name.toLowerCase().includes(needle) ||
        (org.username ?? "").toLowerCase().includes(needle) ||
        (org.license_key_prefix ?? "").toLowerCase().includes(needle) ||
        (org.notes ?? "").toLowerCase().includes(needle)
      );
    });
  }, [organizations, searchQuery, statusFilter]);

  function openNotesModal(org: Organization) {
    setNotesOrg(org);
    setEditedNotes(org.notes ?? "");
  }

  function renderStatusControls(org: Organization, row: RowEdit, compact = false) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", compact && "w-full")}>
        <Select
          value={row.license_status}
          onValueChange={(value) => {
            if (value) updateEdit(org.id, { license_status: value });
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`${org.display_name} lisans durumu`}
            className={compact ? "w-full sm:w-[130px]" : "w-[126px]"}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LICENSE_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={row.is_active ? "active" : "inactive"}
          onValueChange={(value) => {
            if (value) updateEdit(org.id, { is_active: value === "active" });
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`${org.display_name} hesap durumu`}
            className={compact ? "w-full sm:w-[100px]" : "w-[96px]"}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="inactive">Pasif</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="date"
          aria-label={`${org.display_name} lisans bitiş tarihi`}
          value={row.license_expires_at}
          onChange={(event) => updateEdit(org.id, { license_expires_at: event.target.value })}
          className={compact ? "h-8 w-full text-xs sm:w-[140px]" : "h-8 w-[136px] text-xs"}
        />
      </div>
    );
  }

  function renderActionButtons(org: Organization, isPending: boolean) {
    const isBusy = savingId === org.id || approvingId === org.id;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {isPending ? (
          <Button
            type="button"
            size="xs"
            disabled={isBusy}
            onClick={() => handleApprove(org)}
            className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {approvingId === org.id ? "Onaylanıyor..." : "Onayla"}
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="default"
          disabled={isBusy}
          onClick={() => handleSave(org)}
          className="gap-1"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {savingId === org.id ? "Kaydediliyor..." : "Kaydet"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={isBusy}
          onClick={() => setConfirmAction({ type: "reset_password", org })}
          title="Kurum şifresini sıfırla"
          className="gap-1"
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          Şifre Sıfırla
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={isBusy}
          onClick={() => setConfirmAction({ type: "rotate", org })}
          title="Lisans anahtarını yenile"
          className="gap-1"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Anahtar Yenile
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => openNotesModal(org)}
          title="Notu görüntüle ve düzenle"
          className="gap-1"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          Not
        </Button>
        <Button
          type="button"
          size="xs"
          variant="destructive"
          disabled={isBusy}
          onClick={() => setConfirmAction({ type: "delete", org })}
          className="gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Sil
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Kurum &amp; Güvenlik Yönetimi
            </h1>
            {metrics.pending > 0 ? (
              <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30">
                {metrics.pending} Onay Bekliyor
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Kurumsal lisansları onaylayın, şifre/anahtar rotasyonunu yönetin ve AI altyapı
            sağlığını anlık izleyin.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing || loading}
          onClick={() => void handleRefresh()}
          className="w-fit gap-1.5"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          {refreshing ? "Yenileniyor..." : "Verileri Yenile"}
        </Button>
      </div>

      {/* System Health & Security Telemetry Strip */}
      {systemStatus ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up">
          <Card className="border-border/60">
            <CardContent className="flex items-start gap-3 px-4 py-3.5">
              <div
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  systemStatus.database_reachable
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-red-500/15 text-red-700 dark:text-red-300",
                )}
              >
                <Database className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Veritabanı &amp; Vektör</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {systemStatus.database_reachable ? "Bağlı (PostgreSQL)" : "Bağlantı Yok"}
                </p>
                <p className="text-[11px] text-muted-foreground">pgvector {systemStatus.embedding_dimensions}-boyut</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="flex items-start gap-3 px-4 py-3.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Cpu className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Hibrit Embedding Motoru</p>
                <p className="truncate text-sm font-semibold text-foreground" title={systemStatus.embedding_model}>
                  {systemStatus.embedding_model}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {Math.round(systemStatus.hybrid_dense_weight * 100)}% Dense /{" "}
                  {Math.round(systemStatus.hybrid_sparse_weight * 100)}% BM25+TF-IDF
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="flex items-start gap-3 px-4 py-3.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">AI Jüri &amp; Telemetri</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  {systemStatus.mistral_key_count} Mistral Anahtarı
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  Phoenix: {systemStatus.phoenix_enabled ? `Aktif (${systemStatus.phoenix_project_name})` : "Kapalı"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="flex items-start gap-3 px-4 py-3.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Siber Güvenlik Katmanı</p>
                <p className="text-sm font-semibold text-foreground">HMAC + CSRF + Rate-Limit</p>
                <p className="text-[11px] text-muted-foreground">
                  Cookie: {systemStatus.cookie_secure ? "Secure (HTTPS)" : "Geliştirme (HTTP)"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up animate-stagger-1">
        <StatCard label="Toplam Kurum" value={organizations.length} icon={Building2} className="hover-lift" />
        <StatCard label="Aktif / Deneme" value={metrics.active} icon={CheckCircle2} className="hover-lift" />
        <StatCard
          label="Onay Bekleyen"
          value={metrics.pending}
          icon={Clock}
          className={cn(
            "hover-lift",
            metrics.pending > 0 && "border-amber-500/40 bg-amber-500/5",
          )}
        />
        <StatCard
          label="Toplam Aday / Jüri"
          value={`${metrics.candidates} / ${metrics.debates}`}
          icon={Users}
          className="hover-lift"
        />
      </div>

      {/* Pending Alert Banner */}
      {metrics.pending > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between animate-scale-in"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {metrics.pending} kurum yönetici onayı bekliyor
              </p>
              <p className="text-xs text-muted-foreground">
                Onaylanan kurumlar anında giriş yapabilir ve lisans anahtarları aktif edilir.
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setStatusFilter("pending")}
            className="w-fit shrink-0 border-amber-500/40 bg-background/80"
          >
            Onay Bekleyenleri Filtrele ({metrics.pending})
          </Button>
        </div>
      ) : null}

      {/* Create Organization Card */}
      <Card className="border-border/60 animate-fade-in-up animate-stagger-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
            Yeni Kurum Hesabı Oluştur
          </CardTitle>
          <CardDescription>
            Sistem otomatik olarak kurum kullanıcı adı, güvenli geçici şifre ve lisans anahtarı
            üretir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-3 sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="orgDisplayName">Kurum Adı</Label>
              <Input
                id="orgDisplayName"
                placeholder="Örn: Acme Teknoloji A.Ş."
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="orgNotes">Yönetici Notu (isteğe bağlı)</Label>
              <Input
                id="orgNotes"
                placeholder="Paket, fatura veya yetkili iletişim bilgisi"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={creating} className="gap-1.5 sm:w-fit">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {creating ? "Oluşturuluyor..." : "Kurum Hesabı Oluştur"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Organization Filter + List */}
      <Card className="border-border/60 animate-fade-in-up animate-stagger-3">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
              Kayıtlı Kurumlar ({filteredOrganizations.length} / {organizations.length})
            </CardTitle>
            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Kurum, kullanıcı adı veya not ara"
                placeholder="Kurum, kullanıcı adı, anahtar ara..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-8 text-sm"
              />
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: "all", label: `Tümü (${organizations.length})` },
                { id: "pending", label: `Onay Bekleyen (${metrics.pending})` },
                {
                  id: "active",
                  label: `Aktif (${organizations.filter((o) => o.is_active && o.license_status === "active").length})`,
                },
                { id: "trial", label: `Deneme (${metrics.trial})` },
                { id: "inactive", label: `Askıda / Pasif (${metrics.inactive})` },
              ] as { id: StatusFilter; label: string }[]
            ).map((pill) => (
              <Button
                key={pill.id}
                type="button"
                size="xs"
                variant={statusFilter === pill.id ? "default" : "outline"}
                onClick={() => setStatusFilter(pill.id)}
                className="rounded-full"
              >
                {pill.label}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0 sm:px-6 sm:pb-6">
          {loading ? (
            <div className="flex flex-col gap-3 px-6 pb-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredOrganizations.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              {organizations.length === 0
                ? "Henüz kayıtlı kurum yok."
                : "Seçilen filtre veya arama kriteriyle eşleşen kurum bulunamadı."}
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kurum &amp; Kullanıcı</TableHead>
                      <TableHead>Mevcut Durum</TableHead>
                      <TableHead>Lisans / Hesap / Bitiş Tarihi</TableHead>
                      <TableHead>Kullanım</TableHead>
                      <TableHead>İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrganizations.map((org) => {
                      const row = edits[org.id] ?? {
                        license_status: org.license_status,
                        is_active: org.is_active,
                        license_expires_at: toDateValue(org.license_expires_at),
                      };
                      const meta = getStatusMeta(org.license_status);
                      const isPending = org.license_status === "pending";

                      return (
                        <TableRow key={org.id}>
                          <TableCell className="min-w-[190px] whitespace-normal">
                            <p className="font-medium text-foreground">{org.display_name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-mono">{org.username ?? "—"}</span>
                              {org.license_key_prefix ? (
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {org.license_key_prefix}***
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                              <span className="text-[11px] text-muted-foreground">
                                Hesap: {org.is_active ? "Aktif" : "Pasif"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[380px]">
                            {renderStatusControls(org, row)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            <div>{org.candidate_count} aday</div>
                            <div>{org.debate_count} jüri</div>
                          </TableCell>
                          <TableCell className="min-w-[290px] whitespace-normal">
                            {renderActionButtons(org, isPending)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="flex flex-col gap-3 px-4 pb-4 md:hidden">
                {filteredOrganizations.map((org) => {
                  const row = edits[org.id] ?? {
                    license_status: org.license_status,
                    is_active: org.is_active,
                    license_expires_at: toDateValue(org.license_expires_at),
                  };
                  const meta = getStatusMeta(org.license_status);
                  const isPending = org.license_status === "pending";

                  return (
                    <div
                      key={org.id}
                      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{org.display_name}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {org.username ?? "—"}
                            {org.license_key_prefix ? ` • ${org.license_key_prefix}***` : ""}
                          </p>
                        </div>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                        <span>{org.candidate_count} aday</span>
                        <span>{org.debate_count} jüri değerlendirmesi</span>
                      </div>

                      {renderStatusControls(org, row, true)}
                      {renderActionButtons(org, isPending)}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* One-time Credentials / Secret Modal */}
      <Dialog
        open={Boolean(secretModal)}
        onOpenChange={(open) => {
          if (!open) setSecretModal(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {secretModal?.title}
            </DialogTitle>
            <DialogDescription>{secretModal?.description}</DialogDescription>
          </DialogHeader>

          {secretModal ? (
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-sm">
              <div className="text-xs font-medium text-muted-foreground">
                Kurum: <span className="font-semibold text-foreground">{secretModal.organizationName}</span>
              </div>

              {secretModal.username ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">Kullanıcı Adı</p>
                    <p className="truncate font-mono text-xs font-semibold text-foreground">
                      {secretModal.username}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => copyText("username", secretModal.username ?? "")}
                    className="shrink-0 gap-1"
                  >
                    {copiedKey === "username" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Kopyala
                  </Button>
                </div>
              ) : null}

              {secretModal.password ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">Geçici Şifre</p>
                    <p className="truncate font-mono text-xs font-semibold text-foreground">
                      {secretModal.password}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => copyText("password", secretModal.password ?? "")}
                    className="shrink-0 gap-1"
                  >
                    {copiedKey === "password" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Kopyala
                  </Button>
                </div>
              ) : null}

              {secretModal.licenseKey ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">Lisans Anahtarı</p>
                    <p className="break-all font-mono text-xs font-semibold text-foreground">
                      {secretModal.licenseKey}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => copyText("license_key", secretModal.licenseKey ?? "")}
                    className="shrink-0 gap-1"
                  >
                    {copiedKey === "license_key" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Kopyala
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            {secretModal ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const lines = [`Kurum: ${secretModal.organizationName}`];
                  if (secretModal.username) lines.push(`Kullanıcı Adı: ${secretModal.username}`);
                  if (secretModal.password) lines.push(`Şifre: ${secretModal.password}`);
                  if (secretModal.licenseKey) lines.push(`Lisans Anahtarı: ${secretModal.licenseKey}`);
                  void copyText("all", lines.join("\n"));
                }}
                className="gap-1.5"
              >
                {copiedKey === "all" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Tüm Bilgileri Kopyala
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => setSecretModal(null)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editable Notes Dialog */}
      <Dialog
        open={Boolean(notesOrg)}
        onOpenChange={(open) => {
          if (!open) setNotesOrg(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{notesOrg?.display_name} — Yönetici Notu</DialogTitle>
            <DialogDescription>
              Kuruma ait iç değerlendirme, paket veya iletişim notlarını güncelleyin.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adminOrgNotesEdit">Kurum Notu</Label>
            <Textarea
              id="adminOrgNotesEdit"
              rows={4}
              value={editedNotes}
              onChange={(event) => setEditedNotes(event.target.value)}
              placeholder="İç yönetici notunu buraya yazın..."
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingNotes}
              onClick={() => setNotesOrg(null)}
            >
              İptal
            </Button>
            <Button type="button" size="sm" disabled={savingNotes} onClick={handleSaveNotes}>
              {savingNotes ? "Kaydediliyor..." : "Notu Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Destructive / Sensitive Actions */}
      <ConfirmDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction?.type === "delete"
            ? `${confirmAction.org.display_name} Silinsin mi?`
            : confirmAction?.type === "reset_password"
              ? `${confirmAction.org.display_name} Şifresini Sıfırla`
              : `${confirmAction?.org.display_name ?? ""} Lisans Anahtarını Yenile`
        }
        description={
          confirmAction?.type === "delete"
            ? "Bu kuruma ait tüm ilanlar, aday başvuruları, jüri değerlendirmeleri ve hesaplar kalıcı olarak silinecektir. Bu işlem geri alınamaz."
            : confirmAction?.type === "reset_password"
              ? "Mevcut kurum şifresi geçersiz kılınacak ve tek seferlik görüntülenecek yeni bir güvenli şifre üretilecektir."
              : "Mevcut lisans anahtarı geçersiz kılınacak ve yeni bir anahtar üretilecektir."
        }
        confirmLabel={
          confirmAction?.type === "delete"
            ? "Kalıcı Olarak Sil"
            : confirmAction?.type === "reset_password"
              ? "Şifreyi Sıfırla"
              : "Anahtarı Yenile"
        }
        cancelLabel="Vazgeç"
        variant={confirmAction?.type === "delete" ? "destructive" : "default"}
        busy={confirmBusy}
        onConfirm={executeConfirmedAction}
      />
    </div>
  );
}
