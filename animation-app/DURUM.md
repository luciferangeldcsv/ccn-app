# DURUM / HANDOFF — Talking Avatar

Bu dosya, projenin mevcut durumunu ve yeni bir Claude Code oturumunda devam etmek için gereken adımları özetler. (Sohbette alınan kararların kalıcı kaydı.)

## Ne istendi

Türkçe animasyon/film üretme uygulaması: kullanıcı karakter görseli seçer, isim verir, replik yazar → sistem seslendirir (TTS) + dudak senkronu (lip-sync) + montaj → tek `mp4`. Kısıt: **kendi sunucu yok, kredi kartı yok, önce tamamen ücretsiz**; prototip **Google Colab (ücretsiz GPU)**'da, dil **Türkçe**.

## Alınan kararlar (sohbette netleşti)

| Konu | Seçim |
|------|-------|
| Lip-sync | **Wav2Lip** (`justinjohn0306` forku, Colab-uyumlu) |
| TTS | **Coqui XTTS v2** (`language="tr"`, built-in speaker adıyla karaktere özel ses) |
| Karakter görselleri | Kullanıcı kendi önden-yüz görsellerini yükler |
| Colab arayüzü | **ipywidgets** form |
| Çıktı | normalize + FFmpeg concat → `output/final.mp4` |

Mimari ve hücre hücre akış `CLAUDE.md` + `README.md`'de.

## Yapıldı

- `notebooks/talking_avatar_tr.ipynb` (8 hücre, uçtan uca çalışır)
- `README.md` (Colab rozeti, mimari, hata çözümü, sunucusuz yol haritası)
- `project.example.json`, `.gitignore`, `CLAUDE.md` (codebase memory)
- Hepsi `ccn-app` reposunun **`animation-app` dalı** altında `animation-app/` klasöründe çalışır durumda.

## Bekleyen tek iş: dedicated repoya push

`luciferangeldcsv/animation-app` reposu açıldı ve Claude GitHub App'e erişim verildi, ama push veren **oturumun GitHub token'ı izinden ÖNCE üretildiği** için 403 veriyor. **Yeni bir Claude Code oturumu** token'ı tazeler ve sorun biter.

### Yeni oturumda çalıştırılacak (içerik hazır, 2 commit bekliyor)

Yerel `animation-app` deposunda `main` dalında commit'ler hazır (notebook + README + project.example.json + .gitignore + CLAUDE.md + bu DURUM.md). Erişimli taze oturumda:

```bash
# animation-app reposunu session'a ekle (add_repo, access=push), sonra:
cd /home/claude/animation-app
git -c push.negotiate=true push -u origin main
```

İçerik yeniden üretilecekse: `ccn-app` reposunun `animation-app` dalındaki `animation-app/` klasörü referanstır — birebir kopyalanıp yeni reponun köküne konur.
