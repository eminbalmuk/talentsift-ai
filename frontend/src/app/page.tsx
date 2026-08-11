import Link from "next/link";
import { ArrowRight, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoMark } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    icon: Sparkles,
    title: "OCR + Yapılandırma",
    description: "mistral-ocr ve ministral-3b ile binlerce CV saniyeler içinde yapılandırılmış veriye dönüşür.",
  },
  {
    icon: Scale,
    title: "Hibrit Sıralama",
    description: "pgvector ile SQL filtreleri ve semantik benzerlik birleşerek en uygun 50 aday öne çıkar.",
  },
  {
    icon: ShieldCheck,
    title: "Çoklu Ajan Değerlendirmesi",
    description: "İyimser, kötümser ve hakem ajanları CV'yi tartışarak adil ve gerekçeli bir puan üretir.",
  },
];

export default function HomePage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-background">
      <AuroraBackground />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <LogoMark size={30} />
          <span className="text-sm font-medium tracking-tight">TalentSift AI</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/org/login" className={cn(buttonVariants({ variant: "ghost" }))}>
            Organizasyon girişi
          </Link>
          <Link href="/admin/login" className={cn(buttonVariants())}>
            Yönetici girişi
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <div className="max-w-2xl">
          <span className="animate-fade-in-up inline-flex items-center rounded-full border border-border bg-muted/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            Mistral AI ile çalışır
          </span>
          <h1
            className="animate-fade-in-up mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
            style={{ animationDelay: "80ms" }}
          >
            Binlerce CV&apos;yi dakikalar içinde adil biçimde eleyin.
          </h1>
          <p
            className="animate-fade-in-up mt-4 text-lg text-muted-foreground"
            style={{ animationDelay: "160ms" }}
          >
            TalentSift AI, OCR&apos;dan çoklu ajan tartışmasına kadar tüm işe alım huninizi
            uçtan uca otomatikleştiren, yalnızca Mistral modelleriyle çalışan bir
            değerlendirme platformudur.
          </p>
          <div
            className="animate-fade-in-up mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link href="/org/login" className={cn(buttonVariants({ size: "lg" }))}>
              Organizasyon panelini aç
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/admin/login"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
            >
              Yönetici konsolu
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {STAGES.map((stage, index) => (
            <Card
              key={stage.title}
              className="animate-fade-in-up border-border/60 bg-card/80 shadow-sm backdrop-blur-sm transition-transform duration-300 hover:-translate-y-1 hover:shadow-md"
              style={{ animationDelay: `${320 + index * 80}ms` }}
            >
              <CardContent className="flex flex-col gap-3 px-5 py-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <stage.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-medium text-foreground">{stage.title}</h3>
                <p className="text-sm text-muted-foreground">{stage.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-muted-foreground">
        TalentSift AI &mdash; Mistral OCR, embeddings ve LangGraph çoklu ajan pipeline&apos;ı.
      </footer>
    </div>
  );
}
