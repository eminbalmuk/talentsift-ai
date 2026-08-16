import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  FileSearch,
  Scale,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoFull } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: UserCheck,
    title: "1 Kere CV Yükleme",
    description: "Adaylar özgeçmişlerini sisteme 1 kez yükler, profilleri otomatik oluşturulur.",
  },
  {
    icon: Sparkles,
    title: "Tek Tıkla Başvuru",
    description: "Adaylar yayınlanan tüm açık pozisyonlara anında ve zahmetsizce başvurabilir.",
  },
  {
    icon: Scale,
    title: "Akıllı Sıralama & Eleme",
    description: "İş tanımına ve donanım kriterlerine en uygun adaylar öncelikli olarak sıralanır.",
  },
  {
    icon: ShieldCheck,
    title: "Objektif Değerlendirme",
    description: "Aday yetkinlikleri tarafsız analiz raporları ve detaylı puanlama ile sunulur.",
  },
];

const PORTALS = [
  {
    icon: UserCheck,
    title: "Aday Portalı",
    description:
      "Hesap oluşturun, özgeçmişinizi yükleyin ve tüm şirket ilanlarını inceleyerek tek tıkla başvurunuzu yapın.",
    href: "/candidate/login",
    cta: "Aday Girişi / Kayıt",
  },
  {
    icon: Briefcase,
    title: "Kurumsal Şirket Paneli",
    description:
      "İş ilanları oluşturun, başvuruları yönetin ve adayları otomatik akıllı sıralama süreçlerinden geçirin.",
    href: "/org/login",
    cta: "Şirket Girişi / Kayıt Ol",
  },
];

export default function HomePage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-background">
      <AuroraBackground />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <LogoFull height={44} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/candidate/login"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "sm:h-9 text-xs font-medium")}
          >
            Aday Portalı
          </Link>
          <Link
            href="/org/login"
            className={cn(buttonVariants({ size: "sm" }), "sm:h-9 text-xs font-medium")}
          >
            Şirket Girişi / Kayıt
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-20 pt-8 sm:pt-16">
        <div className="max-w-2xl">
          <span className="animate-fade-in-up inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary backdrop-blur-sm">
            Yapay Zekâ Destekli İşe Alım Platformu
          </span>
          <h1
            className="animate-fade-in-up mt-5 text-4xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight"
            style={{ animationDelay: "80ms" }}
          >
            Binlerce CV&apos;yi dakikalar içinde adil ve hızlı biçimde eleyin.
          </h1>
          <p
            className="animate-fade-in-up mt-4 text-lg text-muted-foreground leading-relaxed"
            style={{ animationDelay: "160ms" }}
          >
            TalentSift AI, özgeçmiş toplama sürecinden aday sıralamasına kadar tüm işe alım huninizi otomatikleştiren, tarafsız ve veriye dayalı bir değerlendirme platformudur.
          </p>
          <div
            className="animate-fade-in-up mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link href="/org/login" className={cn(buttonVariants({ size: "lg" }))}>
              Kurumsal Paneli Aç
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/candidate/login"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
            >
              Aday Girişi
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
                    Değerlendirme sistemimiz kararlarını yalnızca özgeçmişteki doğrulanabilir kanıtlara dayandırır; tarafsız ve adil sonuçlar üretir.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-muted-foreground">
        TalentSift AI &mdash; Kurumsal Akıllı İşe Alım ve Özgeçmiş Eleme Platformu.
      </footer>
    </div>
  );
}
