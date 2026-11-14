# CLAUDE.md

Bu dosya, bu depoda çalışan Claude'a (claude.ai/code) rehberlik eder.

## Proje

**Talking Avatar** — Türkçe animasyon/film üretme prototipi. Kullanıcı karakter görseli seçer, isim verir ve replik yazar; sistem metni seslendirir, karakterin dudaklarını senkronlar ve sahneleri birleştirip tek bir `mp4` üretir.

Tamamen **ücretsiz / açık kaynak** ve **Google Colab (ücretsiz T4 GPU)** üzerinde çalışır; kendi sunucu gerektirmez. Dil: **Türkçe** (arayüz metinleri, kod yorumları ve commit mesajları Türkçe; bu düzen korunmalı).

## Pipeline (akış)

`Girdi (project.json) → TTS → Lip-sync → Montaj → final.mp4`

| Adım | İş | Araç |
|------|-----|------|
| 1. Girdi | Karakterler + replikler | ipywidgets form → `project.json` |
| 2. TTS | Metin → Türkçe ses, karaktere özel ses | Coqui **XTTS v2** (`language="tr"`, built-in speaker adı) |
| 3. Lip-sync | Yüz görseli + ses → konuşan klip | **Wav2Lip** (GPU), `justinjohn0306` forku |
| 4. Montaj | Klipleri ortak tuvale getirip birleştir | **FFmpeg** (scale+pad → concat demuxer) |

## Çalıştırma

Notebook: `notebooks/talking_avatar_tr.ipynb` — 8 hücre, **sırayla** çalıştırılır. Başlamadan `Runtime → Change runtime type → T4 GPU`.

- Hücre 0: ortam/GPU kontrolü, klasörler (`assets/ audio/ clips/ output/`)
- Hücre 1: `pip install coqui-tts`, XTTS v2 yükle (`COQUI_TOS_AGREED=1`)
- Hücre 2: Wav2Lip klonla + `wav2lip_gan.pth` & `mobilenet.pth` indir + `librosa==0.10.2 numba batch-face`
- Hücre 3: `google.colab.files.upload()` ile yüz görselleri → `assets/`
- Hücre 4: ipywidgets form → `project.json`
- Hücre 5: repliklerden `audio/line_XXX.wav`
- Hücre 6: her replik için `clips/line_XXX.mp4` (Wav2Lip `inference.py`)
- Hücre 7: normalize + concat → `output/final.mp4` (+ Hücre 7b opsiyonel altyazı)

## Girdi yapısı (`project.json`)

```json
{
  "characters": { "Ayşe": { "image": "ayse.png", "speaker": "Sofia Hellen" } },
  "lines": [ { "char": "Ayşe", "text": "Merhaba..." } ]
}
```

- `characters[isim].speaker` → XTTS v2'nin **built-in konuşmacı adı** (ses klonlama için referans wav gerekmez). Örnekler: `Sofia Hellen`, `Damien Black`, `Eugenio Mataracı`.
- `lines` sıralıdır; montaj bu sırayı korur.
- Görseller: önden bakan, net, **tek yüz**, iyi ışık, 512px+ (jpg/png).

## Dikkat edilecekler (gotchas)

- **Hücre 2 en kırılgan adım.** Checkpoint linkleri değişirse forkun README'sindeki güncel linki kullan; dosya adlarını (`wav2lip_gan.pth`, `mobilenet.pth`) koru. Dosya 0 byte / 404 → indirme başarısız.
- **"Face not detected"** → görsel net frontal değil. Lip-sync için yüz algılama `batch_face` ile yapılır.
- **librosa/numba çakışması** → `Runtime > Restart`, hücreleri sırayla tekrar çalıştır. XTTS 24 kHz üretir; Wav2Lip içinde 16 kHz'e yeniden örnekler.
- **Montaj:** klipler farklı görsel boyutlarından farklı çözünürlükte çıkar; Hücre 7 hepsini 720×720 / 25fps tuvale `scale+pad` ile oturtup `concat` demuxer ile birleştirir. Ses `aac -ar 24000` sabit tutulur (desync önlenir).
- **Colab ücretsiz sınırı:** uzun (3-5 dk) video oturumu zorlar; replikleri azalt ya da Hücre 5-6'yı parça parça çalıştır, Hücre 7 hepsini birleştirir.

## Sunucusuz "tek tık" sürüm (yol haritası)

Tarayıcıda form → **Replicate API** (XTTS + Wav2Lip, kullandıkça öde) → **ffmpeg.wasm** ile tarayıcıda montaj. API anahtarı için küçük serverless proxy (Vercel/Cloudflare Workers) gerekir. Tam ücretsiz + kartsız barındırılan GPU mümkün değil; o durumda prototip Colab'de kalır.

## Gizlilik

Gerçek yüz görselleri, üretilen ses/video ve `project.json` repoya girmez (`.gitignore`: `assets/ audio/ clips/ output/ Wav2Lip/ *.mp4 *.wav`).
