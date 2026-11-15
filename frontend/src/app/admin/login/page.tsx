"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoFull } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost, ApiError } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/admin/login", { username, password });
      toast.success("Yönetici konsoluna giriş yapıldı.");
      router.push("/admin/dashboard");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Giriş başarısız oldu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-muted/30 px-4">
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
      <Card className="animate-fade-in-up w-full max-w-sm border-border/60 bg-card/90 shadow-sm backdrop-blur-sm">
        <CardHeader className="items-center text-center">
          <LogoFull height={36} className="mb-2" />
          <CardTitle className="text-lg">Yönetici Konsolu</CardTitle>
          <CardDescription>Organizasyon ve lisans yönetimine giriş yapın.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Kullanıcı Adı</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Parola</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="mt-1">
              {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
            </Button>
          </form>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Kurumsal şirket hesabınız mı var?{" "}
            <Link
              href="/org/login"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              Şirket Girişi
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
