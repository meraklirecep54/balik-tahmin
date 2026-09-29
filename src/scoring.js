// Av olasılığı skorlama algoritması.
// Her faktör 0–1 arası puanlanır, ağırlıklı geometrik ortalama alınır ve 0–100'e yayılır.
// Buradaki eşikler saha tecrübesiyle ayarlanmaya açık başlangıç değerleridir.

import { moonAge, moonIllumination, moonPhaseName, moonTransitHour, solunarFactor } from "./astro.js";

// ---- Tür profilleri -------------------------------------------------------
// temp: [min, optMin, optMax, max] °C su sıcaklığı
// wave: [min, optMin, optMax, max] m dalga
// wind: [min, optMin, optMax, max] km/s rüzgâr
// months: Ocak..Aralık mevsim katsayısı (0–1)
// light: gündüz / alacakaranlık / gece tercihi (0–1)
// onshore: karaya doğru esen rüzgârı ne kadar sever (0–1)
// bottoms: tercih ettiği zeminler
export const SPECIES = {
  genel: {
    label: "Genel",
    temp: [8, 14, 24, 30], wave: [0, 0.2, 1.0, 2.2], wind: [0, 4, 22, 40],
    months: [0.7, 0.7, 0.7, 0.8, 0.9, 0.9, 0.8, 0.8, 1, 1, 0.9, 0.8],
    light: { day: 0.55, twilight: 1, night: 0.7 }, onshore: 0.4,
    bottoms: ["kaya", "karışık", "çayır", "kum"],
  },
  levrek: {
    label: "Levrek",
    temp: [9, 13, 20, 26], wave: [0.1, 0.4, 1.3, 2.2], wind: [0, 8, 28, 45],
    months: [1, 1, 0.95, 0.85, 0.6, 0.4, 0.35, 0.4, 0.7, 0.95, 1, 1],
    light: { day: 0.4, twilight: 1, night: 0.85 }, onshore: 1,
    bottoms: ["kaya", "karışık"],
  },
  cipura: {
    label: "Çipura",
    temp: [13, 18, 25, 29], wave: [0, 0.1, 0.6, 1.4], wind: [0, 0, 15, 30],
    months: [0.4, 0.35, 0.4, 0.55, 0.8, 1, 1, 1, 1, 0.9, 0.65, 0.5],
    light: { day: 0.75, twilight: 1, night: 0.45 }, onshore: 0.2,
    bottoms: ["çayır", "kum", "karışık"],
  },
  lufer: {
    label: "Lüfer",
    temp: [11, 15, 21, 25], wave: [0, 0.3, 1.1, 2.0], wind: [0, 6, 25, 40],
    months: [0.6, 0.4, 0.3, 0.3, 0.3, 0.3, 0.35, 0.5, 0.9, 1, 1, 0.85],
    light: { day: 0.45, twilight: 1, night: 0.85 }, onshore: 0.5,
    bottoms: ["kaya", "karışık", "kum"],
  },
  palamut: {
    label: "Palamut",
    temp: [13, 16, 22, 26], wave: [0, 0.2, 1.0, 1.8], wind: [0, 4, 20, 35],
    months: [0.3, 0.2, 0.2, 0.2, 0.2, 0.25, 0.4, 0.8, 1, 1, 0.9, 0.5],
    light: { day: 0.65, twilight: 1, night: 0.3 }, onshore: 0.3,
    bottoms: ["kaya", "karışık", "kum", "çayır"],
  },
  istavrit: {
    label: "İstavrit",
    temp: [8, 13, 23, 28], wave: [0, 0, 0.8, 1.6], wind: [0, 0, 18, 35],
    months: [1, 1, 0.9, 0.8, 0.75, 0.7, 0.7, 0.75, 0.85, 1, 1, 1],
    light: { day: 0.5, twilight: 1, night: 0.9 }, onshore: 0.2,
    bottoms: ["kaya", "karışık", "kum", "çayır"],
  },
  kefal: {
    label: "Kefal",
    temp: [7, 13, 25, 30], wave: [0, 0, 0.7, 1.5], wind: [0, 0, 16, 32],
    months: [0.8, 0.8, 0.85, 0.9, 1, 1, 0.9, 0.9, 1, 1, 0.9, 0.8],
    light: { day: 0.85, twilight: 1, night: 0.4 }, onshore: 0.3,
    bottoms: ["kum", "çayır", "karışık"],
  },
};

const WEIGHTS = {
  pressure: 0.16,
  wind: 0.14,
  wave: 0.14,
  water: 0.15,
  light: 0.15,
  solunar: 0.1,
  season: 0.11,
  shore: 0.05,
};

// Ham skoru 0–100'e yayan parametreler (saha verisiyle ayarlanabilir)
const STRETCH = { lo: 0.3, hi: 0.95, gamma: 1.1 };

export const FACTOR_LABELS = {
  pressure: "Basınç trendi",
  wind: "Rüzgâr",
  wave: "Dalga",
  water: "Su sıcaklığı",
  light: "Gün ışığı",
  solunar: "Ay / solunar",
  season: "Mevsim",
  shore: "Rüzgâr yönü",
};

// ---- Yardımcılar -----------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Yamuk üyelik fonksiyonu: [a,b,c,d] aralığında b–c arası 1. */
function trapezoid(x, [a, b, c, d]) {
  if (x == null || Number.isNaN(x)) return null;
  if (x <= a || x >= d) return x === a && a === b ? 1 : x === d && c === d ? 1 : 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

const toHour = (localIso) => {
  const [, t] = localIso.split("T");
  const [hh, mm] = t.split(":").map(Number);
  return hh + mm / 60;
};

// "YYYY-MM-DDTHH:mm" yerel saatini UTC ms'e çevirir
const localToUtcMs = (localIso, offsetSec) => Date.parse(localIso + ":00Z") - offsetSec * 1000;

// ---- Faktörler -------------------------------------------------------------
function pressureScore(hours, i) {
  const p = hours[i].pressure;
  const prev = hours[Math.max(0, i - 3)].pressure;
  if (p == null || prev == null) return { score: 0.6, note: "veri yok", trend: null };
  const dp = p - prev; // hPa / 3 saat
  let score;
  let note;
  if (dp <= -3) { score = 0.4; note = "hızlı düşüyor (cephe yaklaşıyor)"; }
  else if (dp <= -0.6) { score = 1; note = "yavaş düşüyor"; }
  else if (dp < 0.6) { score = 0.75; note = "sabit"; }
  else if (dp < 2) { score = 0.55; note = "yükseliyor"; }
  else { score = 0.3; note = "hızlı yükseliyor"; }
  if (p > 1026) score *= 0.9;
  return { score, note, trend: +dp.toFixed(1) };
}

function lightScore(h, sun, profile) {
  const day = h.time.slice(0, 10);
  const s = sun[day];
  if (!s) return { score: profile.light.day, note: "" };
  const hour = toHour(h.time);
  const rise = toHour(s.sunrise);
  const set = toHour(s.sunset);
  const nearRise = Math.abs(hour - rise) <= 1.5;
  const nearSet = Math.abs(hour - set) <= 1.5;
  if (nearRise || nearSet) return { score: profile.light.twilight, note: nearRise ? "şafak" : "gün batımı" };
  if (hour > rise && hour < set) return { score: profile.light.day, note: "gündüz" };
  return { score: profile.light.night, note: "gece" };
}

function shoreScore(h, spot, profile) {
  if (h.windDir == null || spot.facing == null) return { score: 0.6, note: "" };
  // Rüzgâr yönü = rüzgârın geldiği yön. facing = kıyıdan denize bakış yönü.
  const onshore = Math.cos(((h.windDir - spot.facing) * Math.PI) / 180); // 1: denizden karaya
  const score = clamp01(0.6 + 0.4 * onshore * (profile.onshore * 2 - 1));
  const note = onshore > 0.5 ? "denizden karaya" : onshore < -0.5 ? "karadan denize" : "yandan";
  return { score, note };
}

// ---- Ana skor ------------------------------------------------------------
export function scoreHour({ hours, i, sun, spot, speciesKey, utcOffsetSeconds }) {
  const profile = SPECIES[speciesKey] ?? SPECIES.genel;
  const h = hours[i];
  const month = Number(h.time.slice(5, 7)) - 1;

  const pressure = pressureScore(hours, i);
  const light = lightScore(h, sun, profile);
  const shore = shoreScore(h, spot, profile);

  const utcMs = localToUtcMs(h.time, utcOffsetSeconds);
  const age = moonAge(utcMs);
  const s = sun[h.time.slice(0, 10)];
  const solarNoon = s ? (toHour(s.sunrise) + toHour(s.sunset)) / 2 : 12.5;
  const transit = moonTransitHour(age, solarNoon);
  const illum = moonIllumination(age);
  const phaseBonus = illum < 0.1 || illum > 0.9 ? 0.15 : 0; // yeni ay ve dolunay civarı
  const solunar = clamp01(0.35 + 0.5 * solunarFactor(toHour(h.time), transit) + phaseBonus);

  let wind = trapezoid(h.windSpeed, profile.wind);
  if (wind != null && h.gusts != null && h.gusts > 45) wind *= 0.5;
  const wave = trapezoid(h.wave, profile.wave);
  const water = trapezoid(h.sst, profile.temp);

  const factors = {
    pressure: pressure.score,
    wind: wind ?? 0.6,
    wave: wave ?? 0.6,
    water: water ?? 0.6,
    light: light.score,
    solunar,
    season: profile.months[month],
    shore: shore.score,
  };

  // Ağırlıklı geometrik ortalama: tek bir kötü faktör (ör. sert rüzgâr,
  // soğuk su, mevsim dışı) skoru belirgin şekilde aşağı çeker. Toplamsal
  // ortalamada kötü koşullar diğer faktörlerle telafi ediliyordu ve her
  // mera 70–90 bandına sıkışıyordu.
  let logSum = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) logSum += w * Math.log(Math.max(0.12, factors[k]));
  let total = Math.exp(logSum);

  // Zemin uyumu: tercih edilmeyen zeminde %15 düşüş
  if (spot.bottom && !profile.bottoms.includes(spot.bottom)) total *= 0.85;

  const flags = [];
  if ((h.wave ?? 0) >= 2.5) flags.push("Yüksek dalga");
  if ((h.gusts ?? 0) >= 55) flags.push("Fırtına hamlesi");
  if ((h.precip ?? 0) >= 5) flags.push("Kuvvetli yağış");
  // Kontrast germe: tipik 0.30–0.95 aralığını 0–100'e yayar.
  let score = Math.round(100 * Math.pow(clamp01((total - STRETCH.lo) / (STRETCH.hi - STRETCH.lo)), STRETCH.gamma));
  if (flags.length) score = Math.min(score, 15);

  return {
    time: h.time,
    score,
    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, Math.round(v * 100)])),
    notes: {
      pressure: pressure.note,
      light: light.note,
      shore: shore.note,
      moon: moonPhaseName(age),
    },
    pressureTrend: pressure.trend,
    moonIllumination: Math.round(illum * 100),
    flags,
    conditions: h,
  };
}

/** Şu andan itibaren `count` saatlik skor serisi. */
export function scoreSeries({ data, spot, speciesKey, count = 72 }) {
  const { hours, sun, utcOffsetSeconds } = data;
  const nowLocal = new Date(Date.now() + utcOffsetSeconds * 1000).toISOString().slice(0, 13);
  let start = hours.findIndex((h) => h.time.slice(0, 13) === nowLocal);
  if (start < 0) start = Math.max(0, hours.length - count);
  const out = [];
  for (let i = start; i < Math.min(hours.length, start + count); i++) {
    out.push(scoreHour({ hours, i, sun, spot, speciesKey, utcOffsetSeconds }));
  }
  return out;
}

/** Skor serisinden en iyi, birbiriyle çakışmayan 2 saatlik pencereler. */
export function bestWindows(series, n = 3, len = 2) {
  const cands = [];
  for (let i = 0; i + len <= series.length; i++) {
    const slice = series.slice(i, i + len);
    const avg = slice.reduce((a, b) => a + b.score, 0) / len;
    cands.push({ i, avg });
  }
  cands.sort((a, b) => b.avg - a.avg);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.i - c.i) >= len + 2)) picked.push(c);
    if (picked.length === n) break;
  }
  return picked
    .sort((a, b) => a.i - b.i)
    .map((p) => ({
      start: series[p.i].time,
      end: series[p.i + len - 1].time,
      score: Math.round(p.avg),
    }));
}
