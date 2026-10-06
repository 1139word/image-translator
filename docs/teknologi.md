# Keputusan teknologi

Ringkasan keputusan teknologi proyek. Dokumen SRS, SDD, dan catatan lain disimpan terpisah di Drive.

## Pilihan

| Bagian | Pilihan | Alasan singkat |
|---|---|---|
| Extension | Chrome Manifest V3, JavaScript biasa | Target hanya Google Chrome; tanpa framework agar mudah |
| Backend | Node.js + Express | Satu bahasa dengan extension; menangani akun, credit, pembayaran, dan pemanggilan OCR serta Gemini |
| OCR | PaddleOCR (layanan Python kecil dipanggil backend) | Pustaka OCR mumpuni |
| Terjemahan | Gemini: mode Standar (1 credit) dan Advanced (2 credit, khusus Premium) | Untuk menjaga ekonimi |
| Database | MySQL | - |
| Pembayaran | QRIS lewat Midtrans | - |
| File Explorer | Native Messaging (menu klik kanan hanya untuk Premium) | Meningkatkan value dari premium |

## Alur pengaturan dan pembayaran

- Pengaturan popup (bahasa asal, bahasa tujuan, model) disimpan otomatis begitu dipilih, tanpa tombol Simpan. Disimpan di `chrome.storage.sync`.
- Tombol "Beli Premium" di popup membuka halaman tab Premium. QRIS dibayar di tab itu, dan status Premium dibaca dari server (notifikasi Midtrans ke backend).

## Kontrak API terjemahan (rencana)

`POST /api/translate`

Permintaan:

```json
{ "image": "<base64>", "src": "auto", "tgt": "en", "model": "std" }
```

Jawaban berhasil:

```json
{ "regions": [ { "box": [0.08, 0.06, 0.32, 0.10], "text": "Teks terjemahan" } ] }
```

`box` = `[x, y, lebar, tinggi]` sebagai pecahan 0..1 dari ukuran gambar.

Jawaban gagal: `{ "code": "NO_CREDIT" | "NO_TEXT" | "NOT_LOGGED_IN" | "ERROR", "message": "..." }`

## Tahap pengerjaan

1. Fitur utama: hover, tombol Translate, overlay hasil, popup pengaturan (extension; backend masih contoh/mock)
2. Akun dan credit mingguan
3. Tab Premium dan model Advanced
4. Pembayaran QRIS (Midtrans)
5. File Explorer
