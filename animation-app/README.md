# 🎬 Talking Avatar — Türkçe Animasyon/Film Üretme

Karakter görseli + metin yaz → sistem otomatik olarak **seslendirir**, **dudaklarını senkronlar** ve sahneleri birleştirip tek bir **video** üretir. Tamamen ücretsiz, **Google Colab (ücretsiz GPU)** üzerinde çalışır. Dil: **Türkçe**.

## 🚀 Çalıştır

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/luciferangeldcsv/animation-app/blob/main/notebooks/talking_avatar_tr.ipynb)

1. Yukarıdaki **Open in Colab** rozetine tıkla.
2. `Runtime → Change runtime type → T4 GPU` seç.
3. Hücreleri **sırayla** çalıştır.

## 🧩 Pipeline mimarisi

| Adım | İş | Araç |
|------|-----|------|
| 1. Girdi | Karakterler + replikler (form/JSON) | ipywidgets → `project.json` |
| 2. TTS | Metin → Türkçe ses, her karaktere ayrı ses | Coqui **XTTS v2** |
| 3. Lip-sync | Yüz görseli + ses → konuşan klip | **Wav2Lip** (GPU) |
| 4. Montaj | Klipler + (ops.) altyazı → tek mp4 | **FFmpeg** |
| 5. Çıktı | İndirilebilir `final.mp4` | — |

## 📥 Girdi yapısı (`project.json`)

```json
{
  "characters": {
    "Ayşe": { "image": "ayse.png", "speaker": "Sofia Hellen" },
    "Mert": { "image": "mert.png", "speaker": "Damien Black" }
  },
  "lines": [
    { "char": "Ayşe", "text": "Merhaba Mert, bugün hava çok güzel değil mi?" },
    { "char": "Mert", "text": "Evet Ayşe, böyle bir günde dışarı çıkmamak olmaz." }
  ]
}
```

Karakter görselleri: **önden bakan, net, tek yüz, iyi ışık, 512px+** (jpg/png).

## 🛠️ Sık hatalar

- **GPU yok / yavaş** → `Runtime > Change runtime type > T4 GPU`, baştan çalıştır.
- **Hücre 2 model 0 byte / 404** → Wav2Lip forkunun README'sindeki güncel checkpoint linkini kullan; dosya adlarını (`wav2lip_gan.pth`, `mobilenet.pth`) koru.
- **"Face not detected"** → görsel net frontal değil; tek yüz, iyi ışık, 512px+.
- **librosa / numba hatası** → `Runtime > Restart`, hücreleri sırayla tekrar çalıştır.
- **Oturum kopuyor / uzun video** → Colab ücretsizde süre sınırı var; replikleri azalt ya da Hücre 5–6'yı parça parça çalıştır.

## 🔮 İleride: sunucusuz "tek tık" sürüm

- **Arayüz:** tarayıcıda form (aynı JSON).
- **TTS + lip-sync:** kendi GPU yerine **Replicate API** (kullandıkça öde).
- **Montaj:** **ffmpeg.wasm** ile doğrudan tarayıcıda → video kullanıcı cihazında oluşur.
- **Tek şart:** API anahtarı için küçük bir serverless proxy (Vercel/Cloudflare Workers).
- **Dürüst sınır:** barındırılan GPU'yu *hem tamamen ücretsiz hem kartsız* yapmak mümkün değil; tam ücretsiz kalınacaksa prototip Colab'de kalır.

## Lisans / krediler

- [Coqui XTTS v2](https://github.com/coqui-ai/TTS) · [Wav2Lip](https://github.com/Rudrabha/Wav2Lip) ([Colab forku](https://github.com/justinjohn0306/Wav2Lip)) · FFmpeg
- Modeller kendi lisanslarına tabidir (XTTS: CPML — ticari kullanımda koşullara bak).
