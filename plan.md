# PLAN.md: TalentDuplex Swarm - Üretim Hazır Yapay Zeka İşe Alım Pipeline'ı

Bu döküman, 100.000+ CV'yi ölçeklenebilir, maliyet ve hız odaklı, asenkron ve çoklu ajanlı (Multi-Agent) bir mimariyle işleyecek sistemin uygulama kılavuzudur. Geliştirici Ajan (Developer Agent), aşağıdaki adımları, model eşleşmelerini ve veri akış şemalarını sırasıyla kodlamalıdır.

---

## 1. MİMARİ GENEL BAKIŞ (MULTI-STAGE FILTER PIPELINE)

Sistem, token maliyetlerini düşürmek ve hız limitlerine (Rate Limits) takılmamak için 3 aşamalı bir eleme hunisi kullanır:


```

[100.000 CV (PDF)] ──> 1. AŞAMA: mistral-ocr & ministral-3b (Katı Filtreleme) ──> [~5.000 CV]
│
▼
2. AŞAMA: mistral-embed & pgvector (Semantik Sıralama) ──> [~50 CV]
│
▼
3. AŞAMA: LangGraph Multi-Agent Debate (Derin Analiz) ──> [İstenen Sayıda Aday]

```

---

## 2. MİSTRAL AI MODEL DAĞILIM MATRİSİ

Uygulama esnasında API limitlerini optimize etmek için her görev için tanımlanmış spesifik Mistral modelleri asenkron (`asyncio`) olarak çağrılacaktır:

| Pipeline Aşaması | Görev | Model Adı | Hedef Metrik / Limit Avantajı |
| :--- | :--- | :--- | :--- |
| **Aşama 1 (Parsing)** | PDF mizanpajını bozmadan metne çevirme | `mistral-ocr-2512` | 1.00 RPS / Tablo & Sütun koruma |
| **Aşama 1 (Extraction)** | Metinden Pydantic/JSON şeması çıkarma | `ministral-3b-2512` | **12.50 RPS** / 1.3M TPM (Yüksek Hız) |
| **Aşama 2 (Embedding)** | Semantik arama için vektör üretimi | `mistral-embed-2312` | **20.00.000 TPM** (Büyük Veri Havuzu) |
| **Aşama 3 (Debate)** | İyimser ve Kötümser ajan analizleri | `mistral-small-2506` | 5.00 RPS / 2.25M TPM (Dengeli Akıl Yürütme) |
| **Aşama 4 (Arbitration)**| Hakem Kararı ve Nihai Puanlama | `mistral-large-2512` | Üst Düzey Muhakeme ve Adil Eleştiri |

---

## 3. VERİ MODELİ VE VERİTABANI TASARIMI (POSTGRESQL + PGVECTOR)

Sistem, hem yapılandırılmış verileri (GANO, Sınıf) hızlıca filtrelemek hem de iş deneyimlerini semantik olarak aramak için hibrit bir veritabanı şeması kullanır.

```sql
-- pgvector eklentisini etkinleştir
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE candidates (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255),
    university VARCHAR(255),
    gpa NUMERIC(3, 2),
    current_class INT, -- 1, 2, 3, 4 veya Mezun
    experience_years INT,
    raw_cv_text TEXT,
    cv_embedding VECTOR(1024), -- mistral-embed boyutu
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE debate_results (
    id SERIAL PRIMARY KEY,
    candidate_id INT REFERENCES candidates(id),
    optimist_score INT,
    optimist_arguments TEXT,
    pessimist_score INT,
    pessimist_arguments TEXT,
    final_score NUMERIC(5, 2),
    arbitrator_rationale TEXT,
    is_selected BOOLEAN DEFAULT FALSE
);

```

---

## 4. ADIM ADIM UYGULAMA ADIMLARI

### AŞAMA 1: Asenkron Veri İşleme & Pydantic Filtreleme

**Hedef:** 100k CV'yi hızlıca tarayıp veritabanına yapılandırılmış veri olarak yazmak.

1. **Extraction Şeması:** `pydantic` kullanarak LLM'den zorunlu dönecek alanları tanımla:

```python
    from pydantic import BaseModel, Field
    from typing import List, Optional

    class CVStructure(BaseModel):
        full_name: str = Field(description="Adayın adı ve soyadı")
        university: str = Field(description="En son okuduğu veya mezun olduğu üniversite")
        gpa: Optional[float] = Field(description="Not ortalaması (GANO) 4.00 üzerinden")
        current_class: int = Field(description="Mevcut sınıfı. Okuyorsa 1-4 arası, mezunsa 5 yazın.")
        experience_years: int = Field(description="Toplam yazılım/iş deneyimi yılı.")
        skills: List[str] = Field(description="Öne çıkan teknik yetenekler.")
    ```
2.  **Asenkron Pipeline:** `httpx` ve `asyncio` kullanarak, `mistral-ocr-2512` çıktısını `ministral-3b-2512` modeline structured output (JSON mode) protokolü ile gönder. 4 farklı API Key'i bir havuzda (`itertools.cycle`) döndürerek asenkron çağrıları paralel yürüt.

### AŞAMA 2: Hibrit Arama & Semantik Sıralama (The Top 50 Cut)
**Hedef:** Kullanıcı arayüzden isteklerini girdiğinde (Örn: "GANO >= 2.75 olsun, 3. sınıf olsun, en iyi 50 adayı getir"), SQL ve semantik aramayı birleştirmek.

1.  **SQL Ön Filtreleme:** Kullanıcının dinamik ön koşullarını PostgreSQL WHERE koşuluna çevir:
```sql
    SELECT id, raw_cv_text FROM candidates 
    WHERE gpa >= 2.75 AND current_class = 3;
    ```
2.  **Semantik Arama:** Filtreleme sonucu dönen adayların `cv_embedding` alanları ile kullanıcının iş ilanı metni (Örn: "RAG ve LLM bilen Python geliştirici") arasında kosinüs benzerliği (`<=>` operatörü) hesapla ve en iyi 50 adayı çek.

### AŞAMA 3: LangGraph Multi-Agent Düellosu
**Hedef:** En iyi 50 adayın CV'sini İyimser, Kötümser ve Hakem ajan döngüsüne sokarak adil puanlama üretmek.

#### LangGraph State Yapısı
Ajanlar arası paylaşılacak hafıza nesnesini tanımla:
```python
from typing import TypedDict, List

class AgentState(TypedDict):
    cv_text: str
    user_job_description: str
    optimist_analysis: dict # {"score": int, "arguments": str}
    pessimist_analysis: dict # {"score": int, "arguments": str}
    arbitrator_report: dict # {"final_score": float, "rationale": str}
    current_turn: int

```

#### Ajan Akış Diyagramı ve Prompt Stratejileri

```
[Start] ──> Node: Optimist Agent (mistral-small)
                 │
                 ▼
            Node: Pessimist Agent (mistral-small)
                 │
                 ▼
            Node: Arbitrator Agent (mistral-large) ──> [Save to DB & End]

```

1. **The Talent Optimist Node (`mistral-small-2506`):**
* **Sistem Promptu:** "Sen agresif, iyimser bir insan kaynakları uzmanısın. Görevin, adayın CV'sindeki zayıflıkları görmezden gelip projelerine, potansiyeline ve yeteneklerine odaklanarak işe alınması yönünde en az 3 güçlü argüman üretmek ve adaya yüksek puan vermektir."


2. **The Risk Auditor Node (`mistral-small-2506`):**
* **Sistem Promptu:** "Sen acımasız bir teknik denetçisin. Görevin, adayın CV'sindeki açıkları, kısa süreli iş değiştirmelerini, kopyala-yapıştır duran projelerini veya ilan kriterlerine göre deneyim eksikliklerini yakalamaktır. İyimser ajanın tezlerini çürüt, riskleri listele ve adayın puanını kır."


3. **The Executive Committee Node (`mistral-large-2512`):**
* **Sistem Promptu:** "Sen şirketin Yönetim Kurulu Başkanısın. Önünde bir adayın CV'si, İyimser ajanın savunması ve Kötümser ajanın risk raporu var. İki ajanın da argümanlarını tarafsızca değerlendir. Çelişen iddiaları CV metninden doğrula (Fact-check). Adayın ilana uyumluluğuna göre 100 üzerinden nihai ve adil bir puan ver, gerekçeni yaz."



### AŞAMA 4: Global Sıralama & Dashboard

1. **Sıralama Motoru:** 50 adayın tamamı hakem kurulundan geçtikten sonra, `debate_results` tablosundaki `final_score` alanına göre `ORDER BY final_score DESC` sorgusu çekerek kullanıcının istediği adet kadar (Örn: En iyi 5 aday) adayı nihai rapor halinde ön yüze (Streamlit/Next.js) gönder.
2. **Gözlemlenebilirlik (Observability):** Geliştirme boyunca tüm ajan konuşmalarını ve token tüketimlerini izlemek için projeye **Arize Phoenix** entegrasyonu (`phoenix.trace.langchain`) ekle.

---

## 5. BAŞARI METRİKLERİ VE EVALUATION (RAGAS)

Geliştirici Ajan, pipeline doğruluğunu onaylamak için `ragas` kütüphanesini kullanarak sistemi şu metriklerle test etmelidir:

* **Faithfulness (Doğruluk):** Hakem ajanın verdiği kararların ve argümanların, adayın orijinal CV metniyle ne kadar uyuştuğu (Halüsinasyon kontrolü).
* **Aspect Critique (Adillik):** Yapay zekanın adayın cinsiyeti, kökeni gibi örtülü verilerden etkilenmeyip sadece teknik metrikleri (GANO, Sınıf, Proje) baz aldığının denetimi.
