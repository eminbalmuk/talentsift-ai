"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost, ApiError } from "@/lib/api";

export default function OrgLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/org/login", { username, password });
      router.push("/org/dashboard");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Giriş başarısız oldu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-muted/30 px-4">
      <AuroraBackground />
      <Card className="animate-fade-in-up w-full max-w-sm border-border/60 bg-card/90 shadow-sm backdrop-blur-sm">
        <CardHeader className="items-center text-center">
          <LogoMark size={36} className="mb-1" />
          <CardTitle className="text-lg">Organizasyon girişi</CardTitle>
          <CardDescription>Aday sıralamalarını ve değerlendirme sonuçlarını görüntüleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Kullanıcı adı</Label>
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
              {loading ? "Giriş yapılıyor..." : "Giriş yap"}
            </Button>
          </form>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Yönetici misiniz?{" "}
            <Link href="/admin/login" className="font-medium text-foreground underline underline-offset-4">
              Yönetici girişi
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
