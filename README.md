# Dükkan Takip (telefon sürümü)

Yedek parça dükkanı için cari ve stok takibi. Sunucu gerektirmez: tüm veriler telefonun içinde saklanır,
internet olmadan da çalışır. Ücretsiz olarak GitHub Pages üzerinden yayınlanır.

## Telefona kurulum

- **Android (Chrome):** Adresi açın → menü (⋮) → **Uygulamayı yükle** / **Ana ekrana ekle**.
- **iPhone (Safari):** Adresi açın → **Paylaş** → **Ana Ekrana Ekle**.
- Uygulamayı açıp **Ayarlar → Bildirimleri aç**.

## Kritik stok uyarısı

Her ürüne kritik seviye girilir. Satış veya sayım sonrası stok bu seviyeye inince telefon bildirim verir,
titreşir ve ekranda uyarı çıkar. Uyarıdaki **WhatsApp'tan gönder** düğmesi kritik listesini istenen kişiye
(ör. tedarikçiye) hazır mesaj olarak açar.

## Satış, teklif ve sipariş

- **Satış** sekmesi: sepete ürün ekle (arama veya barkod), peşin ya da veresiye satış. Stoktan düşer, veresiyede müşterinin hesabına yazar.
- **Teklif**: aynı sepet, stok değişmez. Kayıtlı teklif tek dokunuşla satışa çevrilir.
- Satış fişi, fiyat teklifi ve tedarikçi sipariş formu **PDF** olarak paylaş menüsünden WhatsApp'a gönderilir
  (PDF telefonda oluşturulur: `lib/jspdf.min.js` MIT lisansı, Türkçe karakterler için küçültülmüş DejaVu Sans yazı tipi).

## Barkod

Ürün kartına barkod veya QR kod okutulabilir. Stok sayfasında **Barkodla bul**, **Sayım yap** (okuttukça sayar, bitince
stokları günceller, yarıda kalırsa kaldığı yerden devam eder) ve sipariş ekranında **📷 Barkod** ile ürün eklenir.
Okuma iPhone'da uygulamayla gelen ZXing kütüphanesiyle (`lib/`, MIT lisansı), Android Chrome'da telefonun kendi okuyucusuyla yapılır.

## Yedek

Veriler yalnızca bu telefonda durur. **Ayarlar → Yedek al / gönder** ile haftada bir yedek alıp WhatsApp,
Drive ya da e-postaya gönderin. Yeni telefonda **Yedekten geri yükle** ile aynı dosyayı açmak yeterli.
Uygulama 7 günden eski yedek için Özet ekranında hatırlatır.

## Güncelleme yayınlarken

`sw.js` içindeki `SURUM` değerini artırın ki telefonlar yeni dosyaları alsın.
