// Astronomik yardımcılar: ay evresi ve basitleştirilmiş solunar periyotlar.
// Harici kütüphane gerektirmez; balıkçılık için yeterli doğrulukta (±30 dk) yaklaşık hesap yapar.

const SYNODIC_MONTH = 29.530588853; // gün
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // referans yeni ay (UTC)

/** Verilen andaki ay yaşı (0 = yeni ay, ~14.77 = dolunay), gün cinsinden. */
export function moonAge(dateUtcMs) {
  const days = (dateUtcMs - KNOWN_NEW_MOON) / 86400000;
  return ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
}

/** Ayın aydınlanma oranı (0–1). */
export function moonIllumination(age) {
  return (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH)) / 2;
}

export function moonPhaseName(age) {
  const p = age / SYNODIC_MONTH;
  if (p < 0.033 || p >= 0.967) return { name: "Yeni ay", icon: "🌑" };
  if (p < 0.216) return { name: "Hilal (büyüyen)", icon: "🌒" };
  if (p < 0.283) return { name: "İlk dördün", icon: "🌓" };
  if (p < 0.466) return { name: "Şişkin ay (büyüyen)", icon: "🌔" };
  if (p < 0.533) return { name: "Dolunay", icon: "🌕" };
  if (p < 0.716) return { name: "Şişkin ay (küçülen)", icon: "🌖" };
  if (p < 0.783) return { name: "Son dördün", icon: "🌗" };
  return { name: "Hilal (küçülen)", icon: "🌘" };
}

/**
 * Ayın meridyen geçişi (tepe noktası) için yaklaşık yerel saat.
 * Yeni ayda ay, güneşle birlikte öğlen tepe yapar; güneşe göre her gün ~49 dk gecikir.
 * @param age ay yaşı (gün)
 * @param solarNoonHour yerel güneş öğlesi (saat, ondalıklı)
 */
export function moonTransitHour(age, solarNoonHour) {
  const lag = age * (24 / SYNODIC_MONTH); // bir sinodik ayda tam 24 saat kayar (~49 dk/gün)
  return (solarNoonHour + lag) % 24;
}

/** İki saat arasındaki dairesel fark (0–12). */
export function hourDistance(a, b) {
  const d = Math.abs(a - b) % 24;
  return d > 12 ? 24 - d : d;
}

/**
 * Solunar etkisi 0–1:
 *  - Büyük periyot: ay tepe/ayak noktasında (±1 saat)  → 1.0
 *  - Küçük periyot: ay doğuşu/batışı civarı (±45 dk)   → 0.6
 */
export function solunarFactor(hour, transitHour) {
  const underfoot = (transitHour + 12.42) % 24;
  const rise = (transitHour - 6.2 + 24) % 24;
  const set = (transitHour + 6.2) % 24;
  const major = Math.min(hourDistance(hour, transitHour), hourDistance(hour, underfoot));
  const minor = Math.min(hourDistance(hour, rise), hourDistance(hour, set));
  const majorScore = Math.max(0, 1 - major / 1.5);
  const minorScore = Math.max(0, 0.6 * (1 - minor / 1.0));
  return Math.max(majorScore, minorScore);
}
