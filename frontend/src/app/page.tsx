import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
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
    title: "Tek Seferlik CV Profili",
    description:
      "Adaylar özgeçmişlerini bir kez yükler; eğitim, deneyim ve yetkinlik bilgileri otomatik yapılandırılır.",
  },
  {
    icon: Sparkles,
    title: "Tek Tıkla Anında Başvuru",
    description:
      "Hazır profil ile yayınlanan tüm açık pozisyonlara yeniden dosya yüklemeden tek tıkla başvurulur.",
  },
  {
    icon: FileSearch,
    title: "UltraBERT + BM25 Hibrit Arama",
    description:
      "Anlamsal vektör araması (UltraBERT) ile kelime eşleşmesi (BM25) birlikte çalışarak en uyumlu adayları öne çıkarır.",
  },
  {
    icon: Scale,
    title: "Çok Ajanlı AI Jürisi",
    description:
      "İyimser, Kötümser ve Hakem ajanları her adayı özgeçmişteki doğrulanabilir kanıtlarla tartışıp puanlar.",
  },
];

const PORTALS = [
  {
    icon: UserCheck,
    badge: "Adaylar İçin",
    title: "Aday Portalı",
    description:
      "Hesap oluşturun, özgeçmişinizi bir kez yükleyin; açık iş ilanlarını filtreleyip tek tıkla başvurun ve mülakat teklifleriyle jüri raporlarını takip edin.",
    href: "/candidate/login",
    cta: "Aday Girişi / Kayıt",
    primary: false,
  },
  {
    icon: Briefcase,
    badge: "İK & Şirketler İçin",
    title: "Kurumsal Şirket Paneli",
    description:
      "İş ilanları yayınlayın, başvuruları UltraBERT + BM25 hibrit aramasıyla sıralayın, Çok Ajanlı AI Jürisi ile analiz edin ve mülakat planlayın.",
    href: "/org/login",
    cta: "Şirket Girişi / Kayıt Ol",
    primary: true,
  },
];

export default function HomePage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-background">
      <AuroraBackground />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="TalentSift AI Ana Sayfa"
        >
          <LogoFull height={44} />
        </Link>
        <nav aria-label="Portal bağlantıları" className="flex items-center gap-2">
          <Link
            href="/candidate/login"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "text-xs font-medium sm:h-9",
            )}
          >
            Aday Portalı
          </Link>
          <Link
            href="/org/login"
            className={cn(buttonVariants({ size: "sm" }), "text-xs font-medium sm:h-9")}
          >
            Şirket Girişi / Kayıt
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-20 pt-8 sm:pt-16">
        <section className="max-w-3xl">
          <span className="animate-fade-in-up inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            UltraBERT + BM25 Hibrit Arama &bull; Çok Ajanlı AI Jürisi
          </span>
          <h1
            className="animate-fade-in-up mt-5 text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl"
            style={{ animationDelay: "80ms" }}
          >
            Binlerce CV&apos;yi dakikalar içinde adil, kanıta dayalı ve hızlı biçimde eleyin.
          </h1>
          <p
            className="animate-fade-in-up mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg"
            style={{ animationDelay: "160ms" }}
          >
            TalentSift AI; adayların özgeçmişlerini tek seferde profilleştirdiği, şirketlerin ise{" "}
            <span className="font-medium text-foreground">UltraBERT + BM25 hibrit araması</span> ve{" "}
            <span className="font-medium text-foreground">
              Çok Ajanlı AI Jürisi (İyimser / Kötümser / Hakem)
            </span>{" "}
            ile tarafsız değerlendirme yaptığı kurumsal işe alım platformudur.
          </p>
          <div
            className="animate-fade-in-up mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link href="/org/login" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
              Kurumsal Paneli Aç
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/candidate/login"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
            >
              Aday Girişi / Kayıt
            </Link>
          </div>
        </section>

        <section className="mt-20 sm:mt-24" aria-labelledby="how-it-works-heading">
          <div className="max-w-xl">
            <h2
              id="how-it-works-heading"
              className="text-xs font-semibold uppercase tracking-wide text-primary"
            >
              Nasıl Çalışır
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              Yüklemeden jüri kararına, dört şeffaf adım
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <Card
                key={step.title}
                className="animate-fade-in-up relative border-border/70 bg-card/85 shadow-sm backdrop-blur-sm transition-transform duration-300 hover:-translate-y-1 hover:shadow-md"
                style={{ animationDelay: `${320 + index * 80}ms` }}
              >
                <CardContent className="flex flex-col gap-3 px-5 py-5">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <step.icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <span className="tabular-nums text-xs font-semibold text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-20 sm:mt-24" aria-labelledby="portals-heading">
          <div className="max-w-xl">
            <h2
              id="portals-heading"
              className="text-xs font-semibold uppercase tracking-wide text-primary"
            >
              İki Özel Portal
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              Rolünüze uygun paneli seçin
            </p>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {PORTALS.map((portal, index) => (
              <Card
                key={portal.title}
                className={cn(
                  "animate-fade-in-up hover-lift bg-card/85 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md",
                  portal.primary ? "border-primary/40 ring-1 ring-primary/15" : "border-border/70",
                )}
                style={{ animationDelay: `${320 + index * 100}ms` }}
              >
                <CardContent className="flex h-full flex-col justify-between gap-4 px-6 py-6">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <portal.icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                      </div>
                      <span className="rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {portal.badge}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-foreground">{portal.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {portal.description}
                    </p>
                  </div>
                  <Link
                    href={portal.href}
                    className={cn(
                      buttonVariants({ variant: portal.primary ? "default" : "outline" }),
                      "mt-2 w-fit gap-2",
                    )}
                  >
                    {portal.cta}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-20 sm:mt-24">
          <Card className="animate-fade-in-up border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
            <CardContent className="flex flex-col items-start gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3.5 sm:items-center">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Kanıta dayalı, izlenebilir değerlendirme
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Çok Ajanlı AI Jürisi (İyimser / Kötümser / Hakem), kararlarını yalnızca özgeçmişte yer alan doğrulanabilir kanıtlara dayandırır; her aday için puan dökümü ve şeffaf gerekçe sunar.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-border/50 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>TalentSift AI &mdash; Kurumsal Akıllı İşe Alım ve Özgeçmiş Eleme Platformu.</span>
        <Link
          href="/admin/login"
          className="w-fit rounded-sm text-muted-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Yönetici Girişi
        </Link>
      </footer>
    </div>
  );
}
