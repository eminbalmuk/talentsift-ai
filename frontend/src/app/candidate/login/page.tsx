"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Lock, Mail, Sparkles, User, UserPlus } from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoFull } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiPost, ApiError } from "@/lib/api";

export default function CandidateLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost("/api/candidate/login", { email, password });
      toast.success("Giriş başarılı! Aday paneline yönlendiriliyorsunuz.");
      router.push("/candidate/dashboard");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Giriş yapılamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost("/api/candidate/register", {
        email,
        password,
        full_name: fullName,
      });
      toast.success("Kayıt başarılı! Profilinize yönlendiriliyorsunuz.");
      router.push("/candidate/dashboard?tab=profile");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Kayıt olunamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-4 sm:p-8">
      <AuroraBackground />
      <div className="absolute left-6 top-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Ana sayfaya dön
        </Link>
      </div>

      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3">
            <LogoFull height={40} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Aday Portalı</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CV&apos;nizi 1 kez yükleyin, tüm açık ilanlara tek tıkla başvurun.
          </p>
        </div>

        <Tabs
          value={mode}
          onValueChange={(val) => {
            if (val === "login" || val === "register") {
              setMode(val);
            }
          }}
          className="w-full"
        >
          <TabsList className="mb-4 grid w-full grid-cols-2">
            <TabsTrigger value="login" className="gap-1.5 text-xs">
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              Giriş Yap
            </TabsTrigger>
            <TabsTrigger value="register" className="gap-1.5 text-xs">
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Kayıt Ol
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card className="border-border/60 bg-card/90 shadow-lg backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Hesabınıza Giriş Yapın</CardTitle>
                <CardDescription className="text-xs">
                  Daha önce oluşturduğunuz aday hesabı ile devam edin.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-email" className="text-xs font-medium">
                      E-posta Adresi
                    </Label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        placeholder="ornek@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-9 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="login-password" className="text-xs font-medium">
                      Şifre
                    </Label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-9 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={submitting} className="mt-2 w-full gap-2 font-medium">
                    {submitting ? "Giriş yapılıyor..." : "Giriş Yap"}
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card className="border-border/60 bg-card/90 shadow-lg backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Yeni Aday Hesabı Oluşturun</CardTitle>
                <CardDescription className="text-xs">
                  CV&apos;nizi profilleştirmek ve ilanlara başvurmak için kaydolun.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRegister} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-fullname" className="text-xs font-medium">
                      Ad Soyad
                    </Label>
                    <div className="relative">
                      <User
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="reg-fullname"
                        autoComplete="name"
                        placeholder="Ahmet Yılmaz"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="pl-9 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-email" className="text-xs font-medium">
                      E-posta Adresi
                    </Label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        placeholder="ahmet@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-9 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-password" className="text-xs font-medium">
                      Şifre (en az 6 karakter)
                    </Label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="reg-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-9 text-sm"
                        minLength={6}
                        required
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={submitting} className="mt-2 w-full gap-2 font-medium">
                    {submitting ? "Kayıt yapılıyor..." : "Kayıt Ol ve Başla"}
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Şirket hesabı için{" "}
          <Link
            href="/org/login"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            Kurumsal Giriş
          </Link>
        </p>
      </div>
    </div>
  );
}
