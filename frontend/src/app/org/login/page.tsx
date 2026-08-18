"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Building2, Lock, User, UserPlus, CheckCircle2 } from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoFull } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, ApiError } from "@/lib/api";

export default function OrgLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/org/login", { username, password });
      toast.success("Giriş başarılı! Kurumsal panele yönlendiriliyorsunuz.");
      router.push("/org/dashboard");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Giriş başarısız oldu.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/org/register", {
        display_name: displayName,
        username,
        password,
        notes: notes || null,
      });
      setRegisterSuccess(true);
      toast.success("Kayıt talebiniz alındı! Yönetici onayından sonra giriş yapabilirsiniz.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Kayıt talebi gönderilemedi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="theme-org relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-muted/30 p-4">
      <AuroraBackground />
      <div className="absolute left-6 top-6 z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
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
          <h1 className="text-xl font-bold tracking-tight text-foreground">Kurumsal Şirket Portalı</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            İş ilanlarınızı yönetin ve adayları akıllı algoritmalarla değerlendirin.
          </p>
        </div>

        <Tabs value={mode} onValueChange={(val) => setMode(val as "login" | "register")} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
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
            <Card className="border-border/60 shadow-lg backdrop-blur-sm bg-card/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Kurumsal Giriş</CardTitle>
                <CardDescription className="text-xs">
                  Şirket hesabınıza giriş yapın.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-username" className="text-xs">
                      Kullanıcı Adı
                    </Label>
                    <Input
                      id="login-username"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="text-sm"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-password" className="text-xs">
                      Parola
                    </Label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="text-sm"
                      required
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="mt-2 text-xs font-medium">
                    {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card className="border-border/60 shadow-lg backdrop-blur-sm bg-card/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Yeni Kurumsal Kayıt Talebi</CardTitle>
                <CardDescription className="text-xs">
                  Şirket hesabı oluşturun. Hesabınız yönetici onayının ardından aktifleştirilecektir.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {registerSuccess ? (
                  <div className="space-y-4 text-center py-4">
                    <div className="flex justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                    </div>
                    <h3 className="text-base font-semibold text-foreground">Kayıt Talebi Alındı!</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Kurumsal hesabınız başarıyla oluşturuldu. Sistem yöneticimiz hesabınızı inceleyip onayladıktan sonra giriş yapabileceksiniz.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => { setRegisterSuccess(false); setMode("login"); }} className="text-xs">
                      Giriş Ekranına Dön
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleRegister} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-dispname" className="text-xs">
                        Şirket / Kurum Adı
                      </Label>
                      <Input
                        id="reg-dispname"
                        placeholder="Örn: Trendyol A.Ş."
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="text-sm"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-username" className="text-xs">
                        Kullanıcı Adı
                      </Label>
                      <Input
                        id="reg-username"
                        placeholder="trendyol_hr"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="text-sm"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-password" className="text-xs">
                        Parola (en az 6 karakter)
                      </Label>
                      <Input
                        id="reg-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="text-sm"
                        minLength={6}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reg-notes" className="text-xs">
                        Sektör / Açıklama (Opsiyonel)
                      </Label>
                      <Textarea
                        id="reg-notes"
                        placeholder="Yazılım teknolojileri, e-ticaret vb."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                    <Button type="submit" disabled={loading} className="mt-2 text-xs font-medium">
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
