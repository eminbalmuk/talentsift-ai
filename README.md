# TalentSift AI

TalentSift AI, yüksek sayıdaki özgeçmişi yapay zeka destekli ve çok aşamalı bir süreçle değerlendiren bir resume screening platformudur. Sistem; Mistral OCR ve extraction, PostgreSQL + pgvector ile semantic ranking ve LangGraph tabanlı Optimist, Pessimist ve Arbitrator review akışını birlikte kullanır.

## Özellikler

- Mistral modelleriyle asenkron OCR ve yapılandırılmış resume extraction
- Organization bazlı tenant isolation
- PostgreSQL ve pgvector üzerinde filtreleme ve semantic ranking
- LangGraph agent'larıyla aday skorlarının adversarial review sürecinden geçirilmesi
- Admin ve organization kullanıcıları için Next.js tabanlı web arayüzü
- İsteğe bağlı Phoenix tracing ve RAGAS evaluation entegrasyonu

## Gereksinimler

- Python 3.11 veya üzeri
- Node.js ve npm
- Docker Desktop
- Mistral API key

Yerel geliştirme için Docker üzerinde PostgreSQL ve pgvector çalıştırılır. Python backend ile Next.js frontend ayrı süreçler olarak başlatılır.

## Yerel Kurulum

### 1. Python ortamını hazırlayın

PowerShell içinde repository kök dizininde:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev,observability,eval]"
copy .env.example .env
```

`.env` dosyasını açıp `MISTRAL_API_KEYS`, `PRODUCT_KEY_PEPPER` ve `ADMIN_SESSION_SECRET` değerlerini doldurun. Değişkenlerin açıklamaları için `.env.example` dosyasına bakabilirsiniz.

### 2. PostgreSQL'i başlatın

```powershell
docker compose up -d
talentsift db init
```

`db init` migration'ları idempotent biçimde çalıştırır; aynı komutu tekrar çalıştırmak mevcut şemaya zarar vermez.

### 3. Admin kullanıcısını oluşturun

```powershell
talentsift admin provision
```

Komut, kullanıcı adı ve parolayı tamamen rastgele üretir ve bunları yalnızca bir kez terminale yazdırır. Parolayı güvenli bir yerde saklayın.

### 4. Backend'i başlatın

```powershell
talentsift admin serve
```

JSON API varsayılan olarak `http://127.0.0.1:8000` adresinde çalışır. Admin ve organization endpoint'leri sırasıyla `/api/admin/*` ve `/api/org/*` altında bulunur.

### 5. Frontend'i başlatın

Ayrı bir terminal açın:

```powershell
cd frontend
npm install
npm run dev
```

Geliştirme ortamında frontend'i `http://localhost:3000` adresinden açın. Admin kullanıcısıyla `/admin/login` üzerinden giriş yaptıktan sonra `Organizasyon ekle` ile lisanslı organization oluşturabilirsiniz. Organization kullanıcıları `/org/login` üzerinden giriş yaparak adayları arayabilir, debate pipeline'ını çalıştırabilir ve final ranking sonuçlarını inceleyebilir.

Frontend, `/api/*` isteklerini `BACKEND_URL` değişkeni üzerinden backend'e proxy eder. Değişken belirtilmezse `http://127.0.0.1:8000` kullanılır. Bu nedenle yerel geliştirmede backend ve frontend aynı anda çalışmalıdır. Next.js'in development asset kuralları nedeniyle frontend'i `127.0.0.1` yerine `localhost` üzerinden açın.

İsterseniz organization kaydını CLI üzerinden de oluşturabilirsiniz:

```powershell
talentsift admin add-organization --display-name "Acme Corp"
```

Bir organization credential'ının geçerli olduğunu kontrol etmek için:

```powershell
talentsift auth login-check --username "org_..." --password "pw_..."
```

Resume dosyalarını sisteme alın:

```powershell
talentsift ingest --organization-id 1 --resume-dir .\resumes
```

Bir role göre adayları sıralayın:

```powershell
talentsift rank --organization-id 1 --job-description ".\job.txt" --min-gpa 2.75 --class-year 3 --limit 50
```

Sıralanan bir aday için adversarial review çalıştırın:

```powershell
talentsift debate --organization-id 1 --job-description ".\job.txt" --candidate-id 1
```

Final ranking sonuçlarını gösterin:

```powershell
talentsift top --organization-id 1 --limit 5
```

## Proje Yapısı

- `src/talentsift_ai/`: Python backend, CLI, pipeline, agent'lar ve database erişimi
- `src/talentsift_ai/web/`: FastAPI endpoint'leri ve web katmanı
- `migrations/`: PostgreSQL şema migration'ları
- `tests/`: Backend testleri
- `frontend/`: Next.js, TypeScript, Tailwind ve shadcn/ui tabanlı web uygulaması
- `Dockerfile`: Backend container tanımı
- `render.yaml`: Render Blueprint deployment tanımı

Frontend PostgreSQL'e doğrudan bağlanmaz. Tüm database erişimi `asyncpg` ve backend içindeki SQL repository katmanı üzerinden yapılır; frontend yalnızca FastAPI JSON API'sini kullanır.

## Test ve Kalite Kontrolleri

Python development bağımlılıklarını kurduktan sonra:

```powershell
pytest
ruff check .
```

Frontend için:

```powershell
cd frontend
npm run lint
npm run build
```

## Database Stratejisi

Yerel geliştirmede `docker compose` ile PostgreSQL 16 ve pgvector kullanılır. Production ortamında Supabase Postgres kullanılabilir. Uygulama standart PostgreSQL bağlantısı üzerinden `asyncpg` kullandığı için aynı migration'lar iki ortamda da çalışır.

Supabase kullanırken:

1. Database ayarlarından `vector` extension'ını etkinleştirin.
2. Uygulama çalışırken kullanılacak transaction pooler bağlantısını `DATABASE_URL` olarak tanımlayın. Bu bağlantı port `6543` kullanır.
3. Migration'lar için direct/session bağlantısını `DIRECT_DATABASE_URL` olarak tanımlayın. Bu bağlantı port `5432` kullanır.
4. Her iki URL'den de `?pgbouncer=true` parametresini kaldırın. Bu parametre Prisma içindir; `asyncpg` tarafından tanınmaz.

Migration'lar production'da container başlarken otomatik olarak çalıştırılır. Supabase migration'larını yerelde çalıştırmanız gerekirse doğrudan bağlantıyı kullanarak `talentsift db init` komutunu çalıştırın.

## Production Deployment

Önerilen deployment modeli:

- **Supabase**: PostgreSQL ve pgvector
- **Render**: FastAPI backend ve LangGraph pipeline
- **Vercel**: Next.js frontend

### Backend: Render

Kök dizindeki `render.yaml` bir Render Blueprint'tir. Yeni bir Blueprint oluşturup repository'yi bağlayın. Render, `Dockerfile` üzerinden `talentsift-api` web service'ini oluşturur.

Gerekli environment variable'lar:

| Değişken | Açıklama |
| --- | --- |
| `DATABASE_URL` | Supabase transaction pooler URL'si, port `6543` |
| `DIRECT_DATABASE_URL` | Migration'lar için Supabase direct URL'si, port `5432` |
| `MISTRAL_API_KEYS` | Virgülle ayrılmış Mistral API key listesi |
| `PRODUCT_KEY_PEPPER` | Render tarafından üretilebilen uzun, rastgele secret |
| `ADMIN_SESSION_SECRET` | Render tarafından üretilebilen uzun, rastgele secret |

Blueprint, `COOKIE_SECURE` ve `MISTRAL_BASE_URL` değerlerini zaten tanımlar. Container başlarken migration'lar ve `talentsift admin provision --skip-if-exists` çalışır. İlk açılışta Render Logs bölümünde üretilen admin credential'ını kaydedin; parola tekrar gösterilmez.

### Frontend: Vercel

1. Repository'yi Vercel'e import edin ve **Root Directory** değerini `frontend` yapın.
2. `BACKEND_URL` değişkenini Render backend URL'si olarak tanımlayın.
3. Deploy edin ve `/admin/login` üzerinden giriş yaparak kurulumu doğrulayın.

`frontend/next.config.ts`, `/api/*` isteklerini build sırasında `BACKEND_URL` değerine yönlendirir. Böylece tarayıcı yalnızca Vercel domain'iyle iletişim kurar; backend tarafında CORS ayarı yapmanız gerekmez.

## Lisans

Lisans bilgileri için [LICENSE](LICENSE) dosyasına bakın.

