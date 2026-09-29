// Open-Meteo'dan hava ve deniz verisini çeker, önbelleğe alır ve tek tip saatlik kayıtlara dönüştürür.
// API anahtarı gerekmez. Ticari kullanımda Open-Meteo'nun lisans koşullarını kontrol edin.

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const TIMEZONE = "Europe/Istanbul";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 dakika
const BATCH_SIZE = 50; // Open-Meteo tek istekte birden çok koordinatı destekler

const HOURLY_WEATHER = [
  "temperature_2m",
  "pressure_msl",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "precipitation",
].join(",");

const HOURLY_MARINE = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "sea_surface_temperature",
  "ocean_current_velocity",
].join(",");

const cache = new Map(); // spotId -> { at, data }
const inflight = new Map(); // batchKey -> Promise

let lastError = null; // teşhis için son hata

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, params, tries = 3) {
  const qs = new URLSearchParams(params).toString();
  let err;
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(`${url}?${qs}`, {
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": "BalikTahmin/1.1.2" },
      });
      if (res.ok) return res.json();
      const body = await res.text().catch(() => "");
      err = new Error(`${url.split("/")[2]} → HTTP ${res.status} ${body.slice(0, 200)}`);
      // 4xx (429 hariç) tekrar denemeye değmez
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      err = new Error(`${url.split("/")[2]} → ${e.name}: ${e.message}`);
    }
    if (t < tries) await sleep(1500 * t);
  }
  lastError = { at: new Date().toISOString(), message: err.message };
  throw err;
}

function baseParams(spots) {
  return {
    latitude: spots.map((s) => s.lat).join(","),
    longitude: spots.map((s) => s.lng).join(","),
    timezone: TIMEZONE,
    past_days: "1", // basınç trendi için önceki saatler gerekli
    forecast_days: "4",
  };
}

const asArray = (x) => (Array.isArray(x) ? x : [x]);

/** Birden çok mera için hava + deniz verisini tek seferde çeker. */
async function fetchBatch(spots) {
  const params = baseParams(spots);
  const [weather, marine] = await Promise.all([
    getJson(FORECAST_URL, {
      ...params,
      hourly: HOURLY_WEATHER,
      daily: "sunrise,sunset",
      wind_speed_unit: "kmh",
    }),
    // Deniz verisi bazı kıyı noktalarında eksik olabilir; hata olursa hava verisiyle devam ederiz.
    getJson(MARINE_URL, { ...params, hourly: HOURLY_MARINE }).catch((err) => {
      console.warn("[marine] veri alınamadı:", err.message);
      return null;
    }),
  ]);

  const wArr = asArray(weather);
  const mArr = marine ? asArray(marine) : [];

  return spots.map((spot, i) => normalize(wArr[i], mArr[i]));
}

function normalize(w, m) {
  const h = w.hourly;
  const mh = m?.hourly ?? {};
  const pick = (arr, i) => (arr && arr[i] != null ? arr[i] : null);

  // Deniz saat dizisi hava dizisiyle aynı olmayabilir; zamana göre eşleştir.
  const marineIndex = new Map((mh.time ?? []).map((t, i) => [t, i]));

  const hours = h.time.map((time, i) => {
    const mi = marineIndex.get(time);
    return {
      time, // yerel saat, "YYYY-MM-DDTHH:mm"
      airTemp: pick(h.temperature_2m, i),
      pressure: pick(h.pressure_msl, i),
      windSpeed: pick(h.wind_speed_10m, i),
      windDir: pick(h.wind_direction_10m, i),
      gusts: pick(h.wind_gusts_10m, i),
      cloud: pick(h.cloud_cover, i),
      precip: pick(h.precipitation, i),
      wave: mi != null ? pick(mh.wave_height, mi) : null,
      waveDir: mi != null ? pick(mh.wave_direction, mi) : null,
      wavePeriod: mi != null ? pick(mh.wave_period, mi) : null,
      sst: mi != null ? pick(mh.sea_surface_temperature, mi) : null,
      current: mi != null ? pick(mh.ocean_current_velocity, mi) : null,
    };
  });

  const sun = {};
  (w.daily?.time ?? []).forEach((d, i) => {
    sun[d] = { sunrise: w.daily.sunrise[i], sunset: w.daily.sunset[i] };
  });

  return { utcOffsetSeconds: w.utc_offset_seconds ?? 10800, hours, sun };
}

/**
 * Meralar için veriyi döndürür (önbellekli). Eksik olanları toplu olarak çeker.
 * @returns Map<spotId, data>
 */
export async function getConditions(spots) {
  const now = Date.now();
  const result = new Map();
  const missing = [];

  for (const s of spots) {
    const c = cache.get(s.id);
    if (c && now - c.at < CACHE_TTL_MS) result.set(s.id, c.data);
    else missing.push(s);
  }

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const key = batch.map((s) => s.id).join("|");
    if (!inflight.has(key)) {
      inflight.set(
        key,
        fetchBatch(batch).finally(() => inflight.delete(key))
      );
    }
    const datas = await inflight.get(key);
    batch.forEach((s, j) => {
      cache.set(s.id, { at: Date.now(), data: datas[j] });
      result.set(s.id, datas[j]);
    });
  }

  return result;
}

export function cacheStats() {
  return { entries: cache.size, ttlMinutes: CACHE_TTL_MS / 60000, lastError };
}
