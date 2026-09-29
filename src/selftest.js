// İnternet gerektirmeyen hızlı test: sentetik veriyle skorlama zincirini çalıştırır.
// Kullanım: npm test
import { scoreSeries, bestWindows, SPECIES } from "./scoring.js";

const offset = 10800;
const nowLocal = new Date(Date.now() + offset * 1000);
nowLocal.setUTCMinutes(0, 0, 0);
const start = new Date(nowLocal.getTime() - 24 * 3600 * 1000);

const hours = [];
const sun = {};
for (let i = 0; i < 24 * 5; i++) {
  const t = new Date(start.getTime() + i * 3600 * 1000).toISOString().slice(0, 16);
  const day = t.slice(0, 10);
  sun[day] ??= { sunrise: `${day}T06:55`, sunset: `${day}T18:45` };
  hours.push({
    time: t,
    airTemp: 20 + 4 * Math.sin(i / 4),
    pressure: 1015 - 0.4 * Math.sin(i / 10) * 5,
    windSpeed: 12 + 10 * Math.sin(i / 7),
    windDir: (i * 15) % 360,
    gusts: 20 + 12 * Math.sin(i / 7),
    cloud: 40,
    precip: 0,
    wave: 0.6 + 0.4 * Math.sin(i / 9),
    waveDir: 30,
    wavePeriod: 5,
    sst: 19.5,
    current: 0.2,
  });
}

const data = { hours, sun, utcOffsetSeconds: offset };
const spot = { id: "test", facing: 45, bottom: "kaya" };

for (const key of Object.keys(SPECIES)) {
  const series = scoreSeries({ data, spot, speciesKey: key, count: 72 });
  if (series.length !== 72) throw new Error(`${key}: 72 saat bekleniyordu, ${series.length} geldi`);
  if (series.some((s) => s.score < 0 || s.score > 100 || Number.isNaN(s.score))) throw new Error(`${key}: skor aralık dışı`);
  const best = bestWindows(series);
  console.log(
    `${SPECIES[key].label.padEnd(9)} şimdi ${String(series[0].score).padStart(3)}  en iyi: ${best
      .map((b) => `${b.start.slice(5, 16)} (${b.score})`)
      .join(", ")}`
  );
}
console.log("\nTamam: skorlama zinciri çalışıyor.");
