import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getConditions, cacheStats } from "./src/weather.js";
import { scoreSeries, bestWindows, SPECIES, FACTOR_LABELS } from "./src/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const spots = JSON.parse(await readFile(path.join(__dirname, "data/spots.json"), "utf8"));
const spotById = new Map(spots.map((s) => [s.id, s]));

const app = express();
// HTML her seferinde tazelenir; JS/CSS sürüm etiketiyle (?v=) önbelleği aşar.
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  setHeaders(res, file) {
    if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

const speciesParam = (req) => (SPECIES[req.query.species] ? req.query.species : "genel");

// Tür listesi ve faktör adları (arayüz için)
app.get("/api/meta", (_req, res) => {
  res.json({
    species: Object.entries(SPECIES).map(([key, s]) => ({ key, label: s.label })),
    factors: FACTOR_LABELS,
  });
});

// Tüm meralar + şu anki skor ve önümüzdeki 24 saatin en yüksek skoru
app.get("/api/overview", async (req, res, next) => {
  try {
    const species = speciesParam(req);
    const conditions = await getConditions(spots);
    const items = spots.map((spot) => {
      const series = scoreSeries({ data: conditions.get(spot.id), spot, speciesKey: species, count: 24 });
      const now = series[0];
      const peak = series.reduce((a, b) => (b.score > a.score ? b : a), now);
      return {
        ...spot,
        now: { score: now.score, flags: now.flags },
        peak: { score: peak.score, time: peak.time },
      };
    });
    res.json({ species, updated: new Date().toISOString(), spots: items });
  } catch (err) {
    next(err);
  }
});

// Tek mera için 72 saatlik detaylı tahmin
app.get("/api/forecast/:id", async (req, res, next) => {
  try {
    const spot = spotById.get(req.params.id);
    if (!spot) return res.status(404).json({ error: "Mera bulunamadı" });
    const species = speciesParam(req);
    const conditions = await getConditions([spot]);
    const series = scoreSeries({ data: conditions.get(spot.id), spot, speciesKey: species, count: 72 });
    res.json({
      spot,
      species,
      series,
      best: bestWindows(series),
      sun: conditions.get(spot.id).sun,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, version: "1.1.2", node: process.version, cache: cacheStats() }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(502).json({
    error: "Hava verisi şu an alınamıyor. Birkaç dakika sonra tekrar deneyin.",
    detay: String(err?.message ?? err).slice(0, 300),
  });
});

app.listen(PORT, () => console.log(`BalıkTahmin çalışıyor → http://localhost:${PORT}`));
