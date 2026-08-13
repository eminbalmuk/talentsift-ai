import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  FileSearch,
  Scale,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
} from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoMark } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: UserCheck,
    title: "1 Kere CV Yükleyin",
    description: "Profilinizi oluşturun ve CV'nizi 1 kere yükleyin. Mistral OCR ve Vektörleme 1 kere çalışır.",
  },
  {
    icon: Sparkles,
    title: "Tek Tıkla Başvurun",
    description: "Açık ilanlara sıfır ek bekleme ve sıfır ek maliyetle tek tıkla anında başvurun.",
  },
  {
    icon: Scale,
    title: "Pre-LLM Reranking",
    description: "BM25 keyword eşleşmesi ve BGE Cross-Encoder donanım puanlaması ile Top 1.000 aday süzülür.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-Agent Düellosu",
    description: "İyimser, Kötümser ve Hakem ajanlar CV'yi tartışarak adil, gerekçeli bir puan verir.",
  },
];

const PORTALS = [
  {
    icon: UserCheck,
    title: "Aday Portalı",
    description:
      "Hesap oluşturun, CV'nizi 1 kere yükleyin ve profilleştirin. Tüm şirket ilanlarını inceleyin ve tek tıkla başvurun.",
    href: "/candidate/login",
    cta: "Aday Girişi / Kayıt",
  },
  {
    icon: Briefcase,
    title: "Organizasyon paneli",
    description:
      "İş ilanları oluşturun, başvuran veya toplu yüklenen adayları Pre-LLM Reranker ve Multi-Agent ile sıralayın.",
    href: "/org/login",
    cta: "Organizasyon girişi",
  },
  {
    icon: Settings,
    title: "Yönetici konsolu",
    description:
      "Yeni organizasyonlar oluşturun, lisans durumlarını ve son kullanma tarihlerini yönetin.",
    href: "/admin/login",
    cta: "Yönetici girişi",
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
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/candidate/login"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "sm:h-8")}
          >
            Aday Girişi
          </Link>
          <Link
            href="/org/login"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "sm:h-8")}
          >
            Organizasyon girişi
          </Link>
          <Link href="/admin/login" className={cn(buttonVariants({ size: "sm" }), "sm:h-8")}>
            Yönetici
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-20 pt-8 sm:pt-16">
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
            TalentSift AI, CV yüklemeden çoklu ajan tartışmasına kadar tüm işe alım huninizi
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

        <section className="mt-20 sm:mt-24">
          <div className="max-w-xl">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
              Nasıl çalışır
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              Yüklemeden nihai karara, dört adım
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <Card
                key={step.title}
                className="animate-fade-in-up relative border-border/60 bg-card/80 shadow-sm backdrop-blur-sm transition-transform duration-300 hover:-translate-y-1 hover:shadow-md"
                style={{ animationDelay: `${320 + index * 80}ms` }}
              >
                <CardContent className="flex flex-col gap-3 px-5 py-5">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <step.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground/60">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-foreground">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-20 sm:mt-24">
          <div className="max-w-xl">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
              İki panel
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              Rolünüze uygun paneli seçin
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {PORTALS.map((portal, index) => (
              <Card
                key={portal.title}
                className="animate-fade-in-up border-border/60 bg-card/80 shadow-sm backdrop-blur-sm"
                style={{ animationDelay: `${320 + index * 100}ms` }}
              >
                <CardContent className="flex flex-col gap-3 px-6 py-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <portal.icon className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <h3 className="text-base font-medium text-foreground">{portal.title}</h3>
                  <p className="text-sm text-muted-foreground">{portal.description}</p>
                  <Link
                    href={portal.href}
                    className={cn(buttonVariants({ variant: "outline" }), "mt-2 w-fit")}
                  >
                    {portal.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-20 sm:mt-24">
          <Card className="animate-fade-in-up border-border/60 bg-card/80 shadow-sm backdrop-blur-sm">
            <CardContent className="flex flex-col items-start gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileSearch className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Adil ve izlenebilir değerlendirme
                  </h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Hakem ajan, kararını yalnızca CV metnindeki kanıtlara dayandırır; cinsiyet,
                    köken gibi örtülü verilerden etkilenmez.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-muted-foreground">
        TalentSift AI &mdash; Mistral OCR, embeddings ve LangGraph çoklu ajan pipeline&apos;ı.
      </footer>
    </div>
  );
}
