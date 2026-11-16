import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarCheck2,
  Check,
  CheckCircle2,
  FileText,
  Quote,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { LogoFull } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const WORKFLOW_STEPS = [
  {
    number: "01",
    title: "Tek profil veya toplu CV aktarımı",
    description:
      "Adaylar özgeçmişini bir kez yükleyip tüm açık rollere tek tıkla başvurur; İK ekipleri isterse mevcut CV havuzunu topluca içeri aktarır.",
  },
  {
    number: "02",
    title: "Kanıta dayalı akıllı ön eleme",
    description:
      "Başvurular yalnızca anahtar kelimeye değil, pozisyonun gerçek sorumluluklarıyla örtüşen deneyimlere göre sıralanır ve CV alıntılarıyla gerekçelendirilir.",
  },
  {
    number: "03",
    title: "Şeffaf kısa liste ve mülakat",
    description:
      "Ekibiniz güçlü yönleri ve gelişim alanlarını tek ekranda karşılaştırır; uygun adaylara doğrudan panel üzerinden mülakat daveti gönderir.",
  },
];

const ORG_BENEFITS = [
  "Dakikalar içinde ilan yayınlayın ve başvuruları tek havuzda toplayın",
  "GANO, sınıf veya deneyim filtresiyle uyumlu adayları anında öne çıkarın",
  "Her puanın altında özgeçmişten alınmış somut kanıt cümlelerini görün",
  "Seçilen adaylara tarih, saat ve toplantı bağlantısıyla mülakat daveti iletin",
];

const CANDIDATE_BENEFITS = [
  "PDF veya Word özgeçmişinizi bir kez yükleyin, profiliniz otomatik oluşsun",
  "Açık pozisyonları arayın ve form doldurmadan tek tıkla başvuru yapın",
  "Başvuru sonucunuzu ve değerlendirme geri bildirimlerini şeffafça izleyin",
  "Gelen mülakat davetlerini uygunluk durumunuza göre kolayca yanıtlayın",
];

const TRUST_PILLARS = [
  {
    icon: ShieldCheck,
    title: "Objektif ve önyargısız inceleme",
    description:
      "Değerlendirme sırasında kişisel tanımlayıcı bilgiler maskelenir; kararlar yalnızca yetkinlik ve deneyim üzerinden şekillenir.",
  },
  {
    icon: Quote,
    title: "Özgeçmişten birebir kanıt",
    description:
      "Öne çıkarılan her güçlü yön veya risk notu, adayın CV'sinde yer alan gerçek ifadelerle desteklenir.",
  },
  {
    icon: CalendarCheck2,
    title: "Kopukluk olmadan uçtan uca akış",
    description:
      "Başvurudan kısa listeye, geri bildirimden mülakat onayına kadar tüm süreç aynı panelde tamamlanır.",
  },
];

export default function HomePage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-background">
      <AuroraBackground />

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-primary-foreground focus:shadow-lg"
      >
        Ana içeriğe geç
      </a>

      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="TalentSift AI Ana Sayfa"
          >
            <LogoFull height={40} />
          </Link>

          <nav aria-label="Ana gezinme" className="flex items-center gap-2 sm:gap-5">
            <a
              href="#portallar"
              className="hidden text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-block"
            >
              Çözümler
            </a>
            <a
              href="#nasil-calisir"
              className="hidden text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-block"
            >
              Nasıl Çalışır
            </a>
            <div className="flex items-center gap-2">
              <Link
                href="/candidate/login"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "text-xs font-medium",
                )}
              >
                Aday Girişi
              </Link>
              <Link
                href="/org/login"
                className={cn(buttonVariants({ size: "sm" }), "text-xs font-medium")}
              >
                Kurumsal Giriş
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        {/* Hero Section */}
        <section className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-7">
            <span className="animate-fade-in-up inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Yeni Nesil İşe Alım ve Yetenek Değerlendirme
            </span>

            <h1 className="animate-fade-in-up animate-stagger-1 mt-5 text-3xl font-bold leading-[1.15] tracking-tight text-foreground sm:text-5xl">
              Doğru yeteneği gürültü olmadan,{" "}
              <span className="text-primary">somut kanıtlarla</span> bulun.
            </h1>

            <p className="animate-fade-in-up animate-stagger-2 mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              TalentSift AI; adayların tek özgeçmiş profiliyle saniyeler içinde başvurduğu, insan
              kaynakları ekiplerinin ise her başvuruyu pozisyon uyumu, güçlü yönler ve özgeçmişteki
              doğrudan kanıtlarla incelediği kurumsal işe alım platformudur.
            </p>

            <div className="animate-fade-in-up animate-stagger-3 mt-7 flex flex-wrap items-center gap-3">
              <Link href="/org/login" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
                Kurumsal Paneli Aç
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/candidate/login"
                className={cn(buttonVariants({ size: "lg", variant: "outline" }), "gap-2")}
              >
                Aday Hesabı / Başvur
              </Link>
            </div>

            <ul className="animate-fade-in-up animate-stagger-4 mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Tek seferlik CV profili
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Özgeçmişten doğrulanmış gerekçe
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Panel içi mülakat planlama
              </li>
            </ul>
          </div>

          {/* Product Preview Card */}
          <div className="lg:col-span-5">
            <figure
              aria-label="TalentSift AI aday değerlendirme ekranı önizlemesi"
              className="animate-fade-in-up animate-stagger-2 overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-xl shadow-primary/5 backdrop-blur-md"
            >
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Briefcase className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  <span>Kıdemli Backend Mühendisi</span>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  Kısa Liste
                </span>
              </div>

              <div className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-foreground">Zeynep Kaya</p>
                    <p className="text-xs text-muted-foreground">
                      6 yıl deneyim &bull; Bilgisayar Mühendisliği
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-right">
                    <div className="text-[10px] font-medium text-muted-foreground">Genel Uyum</div>
                    <div className="text-lg font-bold text-primary tabular-nums">91 / 100</div>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <div className="mb-1 flex justify-between text-muted-foreground">
                      <span>Pozisyon &amp; Deneyim Uyumu</span>
                      <span className="font-semibold text-foreground tabular-nums">%94</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-[94%] rounded-full bg-primary" />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-muted-foreground">
                      <span>Kanıt Doğrulaması</span>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                        %100
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-full rounded-full bg-emerald-600 dark:bg-emerald-400" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {["Python", "FastAPI", "PostgreSQL", "Docker"].map((skill) => (
                    <span
                      key={skill}
                      className="rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>

                <blockquote className="rounded-lg border-l-2 border-primary/60 bg-muted/35 p-3 text-xs italic leading-relaxed text-muted-foreground">
                  &ldquo;Dağıtık ödeme servislerinin yanıt süresini %42 düşürerek yüksek eşzamanlı
                  trafikte kesintisiz ölçeklenme sağladı.&rdquo;
                </blockquote>

                <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    Özgeçmiş raporu hazır
                  </span>
                  <span className="font-medium text-primary">Mülakat Daveti &rarr;</span>
                </div>
              </div>
              <figcaption className="sr-only">
                Kurumsal değerlendirme panelindeki aday uyum puanı, yetkinlik rozetleri ve özgeçmiş
                kanıt alıntısının örnek görünümü.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Dual Portals Bento Section */}
        <section id="portallar" className="mt-20 sm:mt-24" aria-labelledby="portals-heading">
          <div className="max-w-2xl">
            <h2
              id="portals-heading"
              className="text-xs font-semibold uppercase tracking-wider text-primary"
            >
              İki Taraf İçin Tek Platform
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Hem işe alım ekipleri hem adaylar için zahmetsiz deneyim
            </p>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {/* Organization Card */}
            <Card className="hover-lift flex flex-col border-primary/35 bg-card/90 shadow-sm ring-1 ring-primary/10 backdrop-blur-sm">
              <CardContent className="flex flex-1 flex-col justify-between gap-6 p-6 sm:p-7">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Briefcase className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                      İK &amp; Şirketler
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">Kurumsal Şirket Paneli</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      Başvuru yoğunluğunda kaybolmadan doğru adaylara odaklanın ve kararlarınızı
                      ölçülebilir verilerle destekleyin.
                    </p>
                  </div>
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    {ORG_BENEFITS.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link href="/org/login" className={cn(buttonVariants(), "w-fit gap-2")}>
                  Kurumsal Giriş / Kayıt Ol
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>

            {/* Candidate Card */}
            <Card className="hover-lift flex flex-col border-border/75 bg-card/90 shadow-sm backdrop-blur-sm">
              <CardContent className="flex flex-1 flex-col justify-between gap-6 p-6 sm:p-7">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <UserCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <span className="rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Adaylar
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">Aday Kariyer Portalı</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      Her ilanda aynı bilgileri tekrar tekrar yazmayın; profilinizi bir kez kurun ve
                      sürecinizi şeffaf biçimde takip edin.
                    </p>
                  </div>
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    {CANDIDATE_BENEFITS.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href="/candidate/login"
                  className={cn(buttonVariants({ variant: "outline" }), "w-fit gap-2")}
                >
                  Aday Girişi / Kayıt
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* How It Works */}
        <section id="nasil-calisir" className="mt-20 sm:mt-24" aria-labelledby="how-it-works-heading">
          <div className="max-w-2xl">
            <h2
              id="how-it-works-heading"
              className="text-xs font-semibold uppercase tracking-wider text-primary"
            >
              Nasıl Çalışır
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Üç adımda ilandan mülakata
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {WORKFLOW_STEPS.map((step) => (
              <Card key={step.number} className="hover-lift border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
                <CardContent className="flex flex-col gap-3 p-6">
                  <span className="text-xs font-bold tracking-wider text-primary tabular-nums">
                    {step.number}
                  </span>
                  <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Trust Pillars */}
        <section className="mt-20 sm:mt-24" aria-labelledby="trust-heading">
          <h2 id="trust-heading" className="sr-only">
            Güvenlik ve şeffaflık ilkeleri
          </h2>
          <div className="grid gap-4 rounded-2xl border border-border/70 bg-card/85 p-6 shadow-sm backdrop-blur-sm md:grid-cols-3 md:gap-6 md:p-8">
            {TRUST_PILLARS.map((pillar) => (
              <div key={pillar.title} className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <pillar.icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{pillar.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {pillar.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/50 bg-background/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>TalentSift AI &mdash; Kurumsal Akıllı İşe Alım ve Yetenek Eleme Platformu.</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/candidate/login" className="hover:text-foreground hover:underline">
              Aday Portalı
            </Link>
            <Link href="/org/login" className="hover:text-foreground hover:underline">
              Kurumsal Portal
            </Link>
            <Link
              href="/admin/login"
              className="rounded-sm text-muted-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Yönetici Girişi
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
