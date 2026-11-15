# TalentSift AI

TalentSift AI; adaylar, kurumlar (İK ekipleri) ve platform yöneticileri için tasarlanmış, **hibrit arama + çok ajanlı yapay zeka jürisi** tabanlı uçtan uca bir işe alım ve özgeçmiş eleme platformudur.

Sistem; bulut tabanlı **NVIDIA NIM `nvidia/nemotron-3.5-embed-1b`** (`1024`-boyutlu Matryoshka vektörler, isteğe bağlı yerel `dmis-lab/UltraBERT-Embed-150M`) + **`Okapi BM25` / 1-2 gram `TF-IDF`** hibrit füzyonu ile adayları sıralar, ardından **LangGraph** üzerinde kör (blind) ve paralel çalışan **Optimist**, **Pessimist** ve **Arbitrator (Hakem)** ajanlarıyla CV içindeki doğrulanabilir kanıtlara dayalı nihai değerlendirme üretir.

---

## Mimari Genel Bakış

```text
Next.js 16 (App Router, Tailwind CSS v4, shadcn/ui)
  ├─ /                     -> Ana sayfa ve portal yönlendirmesi
  ├─ /candidate/*          -> Aday Portalı (CV profili, açık ilanlar, tek tıkla başvuru, mülakat yanıtı)
  ├─ /org/*                -> Kurumsal Portal (ilan yönetimi, toplu CV yükleme, hibrit arama, AI Jüri, mülakat planlama)
  └─ /admin/*              -> TalentSift Yöneticisi (kurum onay/lisans/şifre/anahtar yönetimi, sistem sağlığı, LLM telemetri)
           │  (/api/* Next.js rewrite proxy — CORS gerektirmez)
           ▼
FastAPI Backend (CSRF + Rate Limit + Rol Bazlı HMAC-SHA256 HttpOnly Cookie)
  ├─ Ingest Pipeline       -> .pdf / .docx / .txt / .md ayrıştırma + Mistral yapılandırılmış çıkarım + Nemotron 3.5 1B embedding
  ├─ Hybrid Search         -> PostgreSQL SQL filtre + pgvector (1024-dim) + Okapi BM25 & TF-IDF (60/40 blend) + Yetkinlik skoru
  ├─ Multi-Agent AI Jury   -> PII maskeleme -> Paralel (Optimist || Pessimist) -> Arbitrator + Kanıt/Grounding doğrulaması
  └─ Supabase Postgres     -> pgvector vektörleri + multi-tenant kurum izolasyonu, adaylar, başvurular ve kullanım kayıtları
```

---

## Temel Özellikler

### 1. Yapay Zeka ve Arama Mimarisi
- **NVIDIA NIM Bulut Embedding (`nvidia/nemotron-3.5-embed-1b`, `1024d`):** Hafif HTTP istemcisi üzerinden (`input_type="passage"` / `"query"`) çalışan asimetrik embedding üretimi. `dimensions=1024` Matryoshka çıktısı sayesinde Supabase `pgvector` indeksleriyle tam uyumludur ve sunucuda PyTorch/GPU belleği tüketmez. (Yerel çalıştırma için `EMBEDDING_PROVIDER=ultrabert`, fallback için `mistral` seçilebilir.)
- **Sparse + Dense Hibrit Füzyon:** Türkçe ve İngilizce teknik terimleri koruyan özel tokenizer ile **Okapi BM25 + alt-karakter/1-2 gram TF-IDF** seyrek puanlaması, yoğun vektör benzerliği ile ağırlıklı olarak (`HYBRID_DENSE_WEIGHT=0.60`, `HYBRID_SPARSE_WEIGHT=0.40`) birleştirilir.
- **Kişilik / Önyargı Arındırılmış Paralel AI Jürisi:**
  - Değerlendirme öncesinde aday CV'sindeki kişisel/demografik bilgiler maskelenir.
  - **Optimist** ve **Pessimist** ajanları birbirinden habersiz paralel (`Send` / fan-out) çalışarak tarafsız argüman üretir.
  - **Arbitrator** ajanı iki raporu birleştirerek nihai skoru (`0-100`), eşleşen/eksik yetkinlikleri ve CV'de birebir geçen kanıt alıntılarını (`evidence_quotes`, `grounding_score`) üretir.
- **Esnek Mistral İstemcisi & Telemetri:** Birden fazla API anahtarı rotasyonu, geçici 429/5xx hatalarında üstel geri çekilme (exponential backoff), JSON onarımı ve isteğe bağlı **Arize Phoenix** OpenInference trace entegrasyonu.

### 2. Üçlü Web Portalı (Next.js 16 + FastAPI)
- **Aday Portalı (`/candidate/login`, `/candidate/dashboard`, `/candidate/jobs/[id]`):**
  - E-posta ile kayıt/giriş (veya misafir oturumu), `.pdf`, `.docx`, `.txt`, `.md` formatında tek seferlik CV yükleme ve profil çıkarımı.
  - Açık ilanları arama, tek tıkla başvuru, başvuru geri çekme, jüri özetini görme ve gelen mülakat tekliflerini kabul/ret etme.
- **Kurumsal Şirket Portalı (`/org/login`, `/org/dashboard`, `/org/dashboard/postings/[id]`):**
  - Kurum kaydı (yönetici onaylı `pending` -> `active`), lisans anahtarı ile giriş.
  - İş ilanı oluşturma, düzenleme (`PATCH /api/org/postings/{id}` — açıklama değiştiğinde ilan embedding'ini otomatik yenileme işareti), aktif/pasif yapma ve silme.
  - İlan bazlı toplu CV yükleme (en fazla 20 dosya, dosya başı 10 MB), min. GANO / sınıf / deneyim yılı + UltraBERT/BM25 hibrit sıralama, arka planda ilerleme takipli toplu AI Jüri çalıştırma, nihai seçim/ilan sonuçlandırma, değerlendirmeleri sıfırlama ve mülakat teklifi gönderme.
- **TalentSift Yöneticisi / Admin Paneli (`/admin/login`, `/admin/dashboard`, `/admin/dashboard/usage`):**
  - Canlı **Sistem & AI Güvenlik Durumu** şeridi (`GET /api/admin/system/status`): Veritabanı bağlantısı, embedding modeli/ağırlıkları, Mistral anahtar sayısı, Phoenix ve HTTPS cookie durumu.
  - Kurum oluşturma, bekleyen kurumları onaylama, lisans durumu (`active`, `trial`, `pending`, `suspended`, `expired`), hesap aktifliği ve bitiş tarihi yönetimi.
  - Tek seferlik panoya kopyalanabilir **Şifre Sıfırlama** (`POST /api/admin/organizations/{id}/password/reset`) ve **Lisans Anahtarı Yenileme** modalı, düzenlenebilir kurum notları, durum filtreleri ve arama.
  - Model bazlı token payı ve son çağrı kayıtlarıyla **Mistral LLM Kullanım Telemetrisi**.

### 3. Siber Güvenlik Katmanı
- **Rol Bazlı Oturum İzolasyonu:** `admin`, `org` ve `candidate` portalları için ayrı çerez adları (`talentsift_admin_session`, `talentsift_org_session`, `talentsift_candidate_session`), HMAC-SHA256 imzası, `iat` zaman damgası, maksimum token boyutu kontrolü ve askıya alınmış kurumların anlık engellenmesi.
- **CSRF & Güvenlik Başlıkları:** Durum değiştiren `POST`/`PUT`/`PATCH`/`DELETE` `/api/*` isteklerinde `Origin`–`Host` doğrulaması; tüm yanıtlarda `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy`; `/api/*` yollarında `Cache-Control: no-store, private`.
- **Rate Limiting & Girdi Doğrulama:** Giriş ve kayıt uç noktalarında IP + scope bazlı pencere hız sınırlaması (`429` + `Retry-After`), CV yüklemelerinde dosya adı/uzantı ve magic-byte (`%PDF`, `PK\x03\x04`) doğrulaması, mülakat bağlantılarında `javascript:` / `data:` / `vbscript:` şemalarının reddi.

---

## Gereksinimler

- **Python 3.11+**
- **Node.js 20+ ve npm**
- **Docker Desktop** (yerel PostgreSQL 16 + `pgvector` için)
- **NVIDIA NIM API Key** (`NVIDIA_API_KEY` — varsayılan `nvidia/nemotron-3.5-embed-1b` 1024d embedding için)
- **Mistral API Key** (`MISTRAL_API_KEYS` — OCR, yapılandırılmış extraction ve AI Jüri LLM çağrıları için)

> **Not:** Yerel UltraBERT embedding modunu (`EMBEDDING_PROVIDER=ultrabert`) kullanmak isterseniz `pip install -e ".[local-embed]"` ile opsiyonel PyTorch/SentenceTransformers paketlerini kurabilirsiniz. Varsayılan bulut kurulumunda (`nvidia`) ağır model kütüphaneleri gerekmez.

---

## Yerel Kurulum

### 1. Python ortamını hazırlayın

Repository kök dizininde PowerShell içinde:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev,observability,eval]"
copy .env.example .env
```

`.env` dosyasını açıp özellikle `NVIDIA_API_KEY`, `MISTRAL_API_KEYS`, `PRODUCT_KEY_PEPPER` ve `ADMIN_SESSION_SECRET` değerlerini güncelleyin (tüm ortam değişkenleri için [.env.example](.env.example) dosyasına bakın).

### 2. PostgreSQL ve migration'ları başlatın

```powershell
docker compose up -d
talentsift db init
```

`db init`, `migrations/` altındaki `001_initial.sql` – `013_nim_1024_embeddings.sql` migration dosyalarını idempotent biçimde sırayla çalıştırır.

### 3. Yönetici (Admin) kullanıcısını oluşturun

```powershell
talentsift admin provision
```

Kullanıcı adı ve parola rastgele üretilir ve güvenlik nedeniyle **yalnızca bir kez** terminale yazdırılır.

### 4. Backend'i başlatın

```powershell
talentsift admin serve
```

FastAPI sunucusu varsayılan olarak `http://127.0.0.1:8000` adresinde çalışır. Sağlık kontrolü: `GET /healthz`.

### 5. Frontend'i başlatın

Yeni bir terminal açın:

```powershell
cd frontend
npm install
npm run dev
```

Tarayıcıdan `http://localhost:3000` adresini açın:
- **Ana Sayfa:** `http://localhost:3000`
- **Aday Portalı:** `http://localhost:3000/candidate/login`
- **Kurumsal Şirket Paneli:** `http://localhost:3000/org/login`
- **TalentSift Yöneticisi (Admin):** `http://localhost:3000/admin/login`

> `frontend/next.config.ts`, `/api/*` isteklerini `BACKEND_URL` (varsayılan `http://127.0.0.1:8000`) adresine proxy eder. Next.js geliştirme kuralları nedeniyle yerel ortamda `127.0.0.1` yerine `localhost` kullanın.

---

## CLI Komutları

Kurulum sonrası `talentsift` CLI üzerinden aşağıdaki işlemleri de doğrudan çalıştırabilirsiniz:

```powershell
# Veritabanı migration'larını uygula
talentsift db init

# Eksik (veya --all ile tüm) CV/profil/ilan vektörlerini yapılandırılmış embedder ile yeniden hesapla
talentsift db reembed
talentsift db reembed --all

# Admin & kurum yönetimi
talentsift admin provision --skip-if-exists
talentsift admin add-organization --display-name "Acme Teknoloji A.Ş."
talentsift admin reset-organization-password --organization-id 1
talentsift admin reset-posting-evaluations --organization-id 1 --posting-id 1
talentsift auth login-check --username "org_..." --password "pw_..."

# İlan oluşturma, toplu CV alma, hibrit sıralama, AI Jüri ve sonuçlar
talentsift posting create --organization-id 1 --title "Backend Mühendisi" --description ".\job.txt"
talentsift ingest --organization-id 1 --job-posting-id 1 --resume-dir .\resumes
talentsift rank --organization-id 1 --job-posting-id 1 --job-description ".\job.txt" --min-gpa 2.75 --class-year 3 --limit 50
talentsift debate --organization-id 1 --job-posting-id 1 --candidate-id 1 --job-description ".\job.txt"
talentsift top --organization-id 1 --job-posting-id 1 --limit 5
```

---

## Proje Yapısı

```text
talentsift-ai/
├── src/talentsift_ai/
│   ├── agents/          # LangGraph Optimist/Pessimist/Arbitrator jüri akışı ve prompt'lar
│   ├── db/              # asyncpg havuzu ve SQL + pgvector repository katmanı
│   ├── observability/   # Arize Phoenix + OpenInference izleme entegrasyonu
│   ├── pipeline/        # NVIDIA NIM / UltraBERT embeddings, BM25/TF-IDF sparse, extraction, ingest, reranker, hybrid search
│   └── web/             # FastAPI uygulaması, CSRF/rate-limit/security, admin/org/candidate router'ları
├── migrations/          # PostgreSQL + pgvector şema dosyaları (001–013)
├── tests/               # Pytest birim ve FastAPI akış/güvenlik testleri
├── frontend/            # Next.js 16, TypeScript, Tailwind CSS v4, shadcn/ui web arayüzü
├── Dockerfile           # Python 3.11 container tanımı
├── docker-compose.yml   # Yerel pgvector:pg16 servis tanımı
└── render.yaml          # Render Blueprint deployment tanımı
```

---

## Test ve Kalite Kontrolleri

Backend lint ve test paketi:

```powershell
.\.venv\Scripts\python.exe -m ruff check src\talentsift_ai tests
.\.venv\Scripts\python.exe -m pytest -v
```

Frontend lint ve production derlemesi:

```powershell
cd frontend
npm run lint
npm run build
```

---

## Veritabanı ve Production Deployment

### Veritabanı Stratejisi
Yerel geliştirmede `docker compose` ile `pgvector/pgvector:pg16`, production'da Supabase Postgres kullanılabilir:
1. Veritabanında `vector` eklentisini etkinleştirin.
2. `DATABASE_URL` için Supabase transaction pooler bağlantısını (`port 6543`) tanımlayın.
3. Migration'lar için `DIRECT_DATABASE_URL` olarak direct/session bağlantısını (`port 5432`) tanımlayın.
4. URL sonlarına `?pgbouncer=true` eklemeyin; `asyncpg` bunu tanımaz (`statement_cache_size=0` kod içinde ayarlıdır).

### Backend (Render) ve Frontend (Vercel)
- **Render:** Kök dizindeki [render.yaml](render.yaml) ve [Dockerfile](Dockerfile) üzerinden servis oluşturun (`DATABASE_URL`, `DIRECT_DATABASE_URL`, `NVIDIA_API_KEY`, `MISTRAL_API_KEYS`, `PRODUCT_KEY_PEPPER`, `ADMIN_SESSION_SECRET`, `COOKIE_SECURE=true`, `EMBEDDING_PROVIDER=nvidia`, `EMBEDDING_MODEL_NAME=nvidia/nemotron-3.5-embed-1b`, `EMBEDDING_DIMENSIONS=1024`). PostgreSQL Render container'ının içinde lokal olarak tutulmaz; Render servisi uzaktaki **Supabase PostgreSQL + pgvector** veritabanına bağlanır. Container açılışında `talentsift db init` ve `talentsift admin provision --skip-if-exists` otomatik çalışır.
- **Vercel:** `Root Directory` değerini `frontend` olarak ayarlayın ve `BACKEND_URL` ortam değişkenini backend URL'sine yönlendirin.

---

## Lisans

Lisans bilgileri için [LICENSE](LICENSE) dosyasına bakın.
