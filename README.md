# BalıkTahmin

Türkiye kıyıları için saatlik balık avı olasılığı. Open-Meteo'dan canlı hava ve deniz verisini çeker, her mera için tür bazlı 0–100 arası skor hesaplar ve harita üzerinde gösterir.

## Kurulum

Node.js 18 veya üstü gerekir.

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` adresini açın. API anahtarı gerekmez.

İnternetsiz hızlı test için: `npm test`

## Proje yapısı

```
server.js            Express sunucusu ve API uç noktaları
src/weather.js       Open-Meteo hava + deniz verisi, 30 dk önbellek, toplu istek
src/scoring.js       Skorlama algoritması ve tür profilleri
src/astro.js         Ay evresi ve solunar periyot hesabı
src/selftest.js      Sentetik veriyle test
data/spots.json      Mera listesi
public/              Arayüz (Leaflet harita + Chart.js grafik)
```

## API

| Uç nokta | Açıklama |
|---|---|
| `GET /api/meta` | Tür listesi ve faktör adları |
| `GET /api/overview?species=levrek` | Tüm meralar, şu anki skor ve 24 saatteki en yüksek skor |
| `GET /api/forecast/:id?species=levrek` | Tek mera için 72 saatlik seri, en iyi saatler, faktör dökümü |
| `GET /api/health` | Sunucu ve önbellek durumu |

Türler: `genel`, `levrek`, `cipura`, `lufer`, `palamut`, `istavrit`, `kefal`

## Skor nasıl hesaplanıyor

Her saat için sekiz faktör 0–1 arası puanlanır ve ağırlıklı toplanır:

| Faktör | Ağırlık | Mantık |
|---|---|---|
| Basınç trendi | %16 | Son 3 saatte yavaş düşüş en iyi, hızlı yükseliş en kötü |
| Rüzgâr | %14 | Türün sevdiği hız aralığı; 45 km/s üstü hamlede ceza |
| Dalga | %14 | Türün sevdiği dalga aralığı (levrek köpüklü suyu sever, çipura sakin suyu) |
| Su sıcaklığı | %15 | Türün optimum sıcaklık aralığı |
| Gün ışığı | %15 | Şafak ve gün batımının ±1,5 saati en iyi |
| Ay / solunar | %10 | Ayın tepe/ayak noktası (büyük periyot), doğuş/batış (küçük), yeni ay ve dolunay bonusu |
| Mevsim | %11 | Türün aylık av katsayısı |
| Rüzgâr yönü | %5 | Meranın baktığı yöne göre denizden karaya / karadan denize |

Mera zemini türün tercih ettiği zeminlerden değilse skor %15 düşer. Dalga 2,5 m'yi, hamle 55 km/s'yi veya yağış 5 mm/saati geçerse skor 15'e sınırlanır ve uyarı gösterilir.

Tüm eşikler `src/scoring.js` içindeki `SPECIES` ve `WEIGHTS` nesnelerinde. Gerçek av kayıtlarıyla karşılaştırarak ayarlamanız tahmin kalitesini en çok artıracak adımdır.

## Mera eklemek

`data/spots.json` dosyasına yeni bir kayıt ekleyin:

```json
{ "id": "benzersiz-id", "name": "Mera adı", "region": "İl", "lat": 41.0, "lng": 29.0,
  "facing": 90, "depth": 15, "bottom": "kaya", "type": "kıyı" }
```

`facing`: kıyıdan denize bakış yönü (derece; 0 kuzey, 90 doğu). `bottom`: `kaya`, `kum`, `çayır` veya `karışık`. Koordinatı karaya değil kıyıya yakın denize koyun; aksi halde deniz modeli dalga ve su sıcaklığı vermeyebilir (bu durumda o faktörler nötr puanlanır).

Birkaç bin mera için: Open-Meteo tek istekte çok sayıda koordinat kabul ediyor ve kod 50'şerli gruplar halinde istiyor. Çok büyük listelerde yakın meraları aynı ızgara hücresinde birleştirmek istek sayısını ciddi azaltır.

## Yayına alma

Herhangi bir Node.js barındırmasında çalışır (Render, Railway, Fly.io, VPS). Port `PORT` ortam değişkeninden okunur.

```bash
PORT=8080 npm start
```

## Lisans ve kullanım koşulları (önemli)

- **Open-Meteo** ücretsiz API'si ticari olmayan kullanım içindir. Reklam veya abonelik gelirli bir site için Open-Meteo'nun ücretli API planına geçmeniz gerekir. Güncel koşulları open-meteo.com üzerinden kontrol edin.
- **OpenStreetMap** harita karoları yoğun trafik için uygun değildir; yayında MapTiler, Stadia veya kendi karo sunucunuzu kullanın (`public/app.js` içindeki `tileLayer` adresini değiştirmeniz yeterli).
- Tahminler bilgilendirme amaçlıdır; kullanıcıları resmî meteoroloji uyarılarına yönlendirin.

## Sonraki adımlar

- Batimetri: EMODnet'ten derinlik ve zemin verisini otomatik çekmek
- Kullanıcı girişi ve favori meralar (ör. SQLite + oturum)
- İdeal koşullarda bildirim (Web Push)
- Kullanıcı av kayıtları ile skor ağırlıklarını kalibre etmek
- Mobil uygulama (bu arayüz PWA'ya kolayca dönüştürülebilir)

## Sürüm 1.1 değişiklikleri
- Skorlama ağırlıklı geometrik ortalamaya geçti: tek bir kötü koşul (sert rüzgâr, soğuk su, mevsim dışı) skoru artık belirgin düşürüyor. Skorlar 0–100 aralığına yayılıyor (`src/scoring.js` içindeki `STRETCH` ile ayarlanabilir).
- Yakın meralar haritada kümeleniyor; küme balonunda içindeki en yüksek skor ve mera sayısı görünüyor.
- Açılışta harita tüm meraları gösterecek şekilde ayarlanıyor (mobilde alt panel hesaba katılıyor).
- Harita telif yazısı sağ üste taşındı.
