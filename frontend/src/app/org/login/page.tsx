"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Lock,
  User,
  UserPlus,
} from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoFull } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, ApiError } from "@/lib/api";

const MIN_PASSWORD_LENGTH = 6;

export default function OrgLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleModeChange(nextMode: string) {
    setMode(nextMode as "login" | "register");
    setFormError(null);
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!username.trim()) {
      const message = "Kullanıcı adı zorunludur.";
      setFormError(message);
      toast.error(message);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      const message = `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`;
      setFormError(message);
      toast.error(message);
      return;
    }

    setLoading(true);
    try {
      await apiPost("/api/org/login", { username: username.trim(), password });
      toast.success("Giriş başarılı! Kurumsal panele yönlendiriliyorsunuz.");
      router.push("/org/dashboard");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Giriş başarısız oldu.";
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!displayName.trim()) {
      const message = "Şirket veya kurum adı zorunludur.";
      setFormError(message);
      toast.error(message);
      return;
    }
    if (!username.trim()) {
      const message = "Kullanıcı adı zorunludur.";
      setFormError(message);
      toast.error(message);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      const message = `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`;
      setFormError(message);
      toast.error(message);
      return;
    }

    setLoading(true);
    try {
      await apiPost("/api/org/register", {
        display_name: displayName.trim(),
        username: username.trim(),
        password,
        notes: notes.trim() || null,
      });
      setRegisterSuccess(true);
      toast.success("Kayıt talebiniz alındı! Yönetici onayından sonra giriş yapabilirsiniz.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Kayıt talebi gönderilemedi.";
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  return (
    <div className="theme-org relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-muted/30 p-4 sm:p-8">
      <AuroraBackground />
      <div className="absolute left-6 top-6 z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Ana sayfaya dön
        </Link>
      </div>

      <div className="z-10 w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3">
            <LogoFull height={40} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Kurumsal Şirket Portalı
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            İş ilanlarınızı yönetin ve adayları yapay zeka destekli jüri ile değerlendirin.
          </p>
        </div>

        <Tabs value={mode} onValueChange={handleModeChange} className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-2">
            <TabsTrigger value="login" className="gap-1.5 text-xs">
              <User className="h-3.5 w-3.5" />
              Giriş Yap
            </TabsTrigger>
            <TabsTrigger value="register" className="gap-1.5 text-xs">
              <UserPlus className="h-3.5 w-3.5" />
              Şirket Kaydı Oluştur
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card className="border-border/60 bg-card/90 shadow-lg backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Kurumsal Giriş</CardTitle>
                <CardDescription className="text-xs">
                  Onaylı şirket hesabınız ile panele giriş yapın.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="flex flex-col gap-4" noValidate>
                  {formError ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{formError}</span>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-username" className="text-xs font-medium">
                      Kullanıcı Adı
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="login-username"
                        name="username"
                        autoComplete="username"
                        placeholder="sirket_ik"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="pl-9 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-password" className="text-xs font-medium">
                      Parola
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="login-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="En az 6 karakter"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-invalid={passwordTooShort}
                        minLength={MIN_PASSWORD_LENGTH}
                        className="pl-9 text-sm"
                        required
                      />
                    </div>
                    {passwordTooShort ? (
                      <p className="text-[11px] text-destructive">
                        Parola en az {MIN_PASSWORD_LENGTH} karakter olmalıdır.
                      </p>
                    ) : null}
                  </div>

                  <Button type="submit" disabled={loading} className="mt-1 text-xs font-medium">
                    {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card className="border-border/60 bg-card/90 shadow-lg backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Yeni Kurumsal Kayıt Talebi</CardTitle>
                <CardDescription className="text-xs">
                  Şirket hesabı oluşturun. Hesabınız yönetici onayının ardından aktifleştirilecektir.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {registerSuccess ? (
                  <div className="space-y-4 py-4 text-center">
                    <div className="flex justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                    </div>
                    <h2 className="text-base font-semibold text-foreground">Kayıt Talebi Alındı!</h2>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Kurumsal hesabınız başarıyla oluşturuldu. Sistem yöneticimiz hesabınızı
                      inceleyip onayladıktan sonra giriş yapabileceksiniz.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRegisterSuccess(false);
                        setFormError(null);
                        setMode("login");
                      }}
                      className="text-xs"
                    >
                      Giriş Ekranına Dön
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleRegister} className="flex flex-col gap-4" noValidate>
                    {formError ? (
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                      >
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{formError}</span>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-dispname" className="text-xs font-medium">
                        Şirket / Kurum Adı
                      </Label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reg-dispname"
                          name="organization"
                          autoComplete="organization"
                          placeholder="Örn: Yıldız Teknoloji A.Ş."
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="pl-9 text-sm"
                          required
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-username" className="text-xs font-medium">
                        Kullanıcı Adı
                      </Label>
                      <div className="relative">
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reg-username"
                          name="username"
                          autoComplete="username"
                          placeholder="yildiz_ik"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="pl-9 text-sm"
                          required
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-password" className="text-xs font-medium">
                        Parola (en az {MIN_PASSWORD_LENGTH} karakter)
                      </Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reg-password"
                          name="new-password"
                          type="password"
                          autoComplete="new-password"
                          placeholder="En az 6 karakter"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          aria-invalid={passwordTooShort}
                          minLength={MIN_PASSWORD_LENGTH}
                          className="pl-9 text-sm"
                          required
                        />
                      </div>
                      {passwordTooShort ? (
                        <p className="text-[11px] text-destructive">
                          Parola en az {MIN_PASSWORD_LENGTH} karakter olmalıdır.
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Güvenliğiniz için en az {MIN_PASSWORD_LENGTH} karakter belirleyin.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-notes" className="text-xs font-medium">
                        Sektör / Açıklama (Opsiyonel)
                      </Label>
                      <Textarea
                        id="reg-notes"
                        autoComplete="off"
                        placeholder="Yazılım teknolojileri, e-ticaret vb."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="text-xs"
                      />
                    </div>

                    <Button type="submit" disabled={loading} className="mt-1 text-xs font-medium">
                      {loading ? "Kayıt talebi gönderiliyor..." : "Kayıt Talebi Gönder"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
