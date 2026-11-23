# Rencana Kerja: bring-the-humans-03

Target: Membuat iklan video vertikal orisinal (9:16) untuk make.fun, mengunggahnya ke TikTok publik, dan menyerahkan entri repo (peringkat berdasarkan real views TikTok, hadiah $500).

## Rencana Kerja (Milestone)
1. **Prasyarat & Press Pack**: Verifikasi Node 22+, ffmpeg, referral code, dan play code make.fun; ambil manifest (`make.fun/press/manifest.json`), panduan (`llms.txt`), brand badge 9:16, dan referral end card 9:16 tanpa mengubah aset resmi.
2. **Konsep & Naskah Kreatif**: Rancang naskah iklan singkat (hook kuat, penjelasan make.fun & alasan bergabung, CTA) serta aset visual/suara orisinal sepenuhnya di dalam sesi agen.
3. **Produksi & Render Video**: Rakit video 1080x1920 via ffmpeg dengan brand badge tampil sejak frame pertama hingga sebelum end card, lalu akhiri dengan referral end card berisi referral code pribadi.
4. **Inspeksi Kualitas**: Periksa frame pertama, transisi, teks/audio, dan frame terakhir (end card + referral code) untuk memastikan kepatuhan brand pack dan bebas kesalahan visual.
5. **Publikasi TikTok**: Unggah video secara publik (terlihat dari US) dengan caption memuat `$500 bounty`, `make.fun`, dan play code (di caption atau bio akun), lalu catat URL penuh `https://www.tiktok.com/@<handle>/video/<id>`.
6. **Implementasi Repo & Verifikasi**: Tulis `main.ts`, `VIDEO.json`, `LICENSE`, dan `README.md` menggunakan file tool; uji lokal dengan `MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts`; commit tiap milestone.

## Daftar Berkas yang Akan Dibuat
- `PLAN.md` — Dokumen rencana kerja dan daftar berkas ini.
- `main.ts` — Entrypoint Node 22 (stdlib) yang menyalin `VIDEO.json` ke `/output/VIDEO.json`.
- `VIDEO.json` — Berkas JSON berisi URL penuh video TikTok publik yang disubmit.
- `LICENSE` — Lisensi MIT (OSI-approved) sesuai persyaratan kompetisi.
- `README.md` — Dokumentasi singkat konsep iklan, proses render, dan langkah uji lokal.
- `ad/script.json` — Naskah kreatif iklan (hook, penjelasan make.fun, CTA, durasi tiap adegan).
- `ad/render.mjs` — Skrip pembuat video (fetch press pack, komposisi visual/audio, overlay brand badge & end card via ffmpeg).
- `.makefun/owner.json` — Berkas klaim alamat wallet pemilik (jika diperlukan saat submisi).

## Catatan Kepatuhan
- Semua berkas ditulis dengan file tool (bukan heredoc/tee/sed/cp), tanpa membundel aset press pack ke repo.
- Seluruh proses kreatif dan render terekam di transkrip sesi agen; dilarang membeli/memanipulasi views.
