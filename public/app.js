// BalıkTahmin arayüzü: harita, tür seçimi, mera sıralaması ve 72 saatlik detay.

const state = {
  species: localStorage.getItem("species") || "genel",
  meta: null,
  overview: null,
  selectedId: null,
  forecast: null,
  hourIdx: 0,
  chart: null,
};

const $ = (sel) => document.querySelector(sel);
const panelBody = $("#panelBody");
const panel = $("#panel");

// ---- Yardımcılar ---------------------------------------------------------
const DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const parseLocal = (iso) => new Date(iso + ":00Z"); // yerel saati UTC gibi tutuyoruz
const fmtHour = (iso) => iso.slice(11, 16);
const fmtDayHour = (iso) => `${DAYS[parseLocal(iso).getUTCDay()]} ${fmtHour(iso)}`;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function scoreColor(score, flagged) {
  if (flagged) return cssVar("--danger");
  if (score >= 70) return cssVar("--good");
  if (score >= 50) return "#3f8f9a";
  if (score >= 35) return cssVar("--mid");
  return cssVar("--low");
}

function scoreWord(score) {
  if (score >= 75) return "Çok iyi";
  if (score >= 60) return "İyi";
  if (score >= 45) return "Orta";
  if (score >= 25) return "Düşük";
  return "Zayıf";
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Sunucu hatası (${res.status})`);
  return body;
}

// ---- Harita --------------------------------------------------------------
// Telif yazısı mobilde alt panelin altında kalmasın diye sağ üste alındı.
const map = L.map("map", { zoomControl: true, attributionControl: false }).setView([39.3, 33.0], 6);
L.control.attribution({ position: "topright", prefix: false }).addTo(map);

const isMobile = () => window.matchMedia("(max-width: 820px)").matches;
let initialFitDone = false;
// Açılışta tüm meraları göster; mobilde alt panelin kapladığı alanı hesaba kat.
function fitAllSpots() {
  const pts = state.overview?.spots?.map((s) => [s.lat, s.lng]) ?? [];
  if (!pts.length) return;
  const panelH = isMobile() ? document.getElementById("panel").offsetHeight : 0;
  map.fitBounds(L.latLngBounds(pts), {
    paddingTopLeft: [20, 20],
    paddingBottomRight: [20, 20 + panelH],
    maxZoom: 9,
  });
}
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
// Deniz işaretleri (fener, şamandıra) katmanı
L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>',
}).addTo(map);

const markers = new Map();
// Yakın meraları kümele; küme balonunda içindeki en yüksek skor görünür.
const cluster = L.markerClusterGroup({
  maxClusterRadius: 45,
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  iconCreateFunction(c) {
    const kids = c.getAllChildMarkers();
    const best = Math.max(...kids.map((m) => m.options.score ?? 0));
    const flagged = kids.every((m) => m.options.flagged);
    return L.divIcon({
      className: "",
      html: `<div class="pin cluster" style="background:${scoreColor(best, flagged)}">${best}<small>${kids.length}</small></div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
  },
}).addTo(map);

function renderMarkers() {
  cluster.clearLayers();
  markers.clear();
  for (const s of state.overview.spots) {
    const flagged = s.now.flags.length > 0;
    const icon = L.divIcon({
      className: "",
      html: `<div class="pin${s.id === state.selectedId ? " selected" : ""}" style="background:${scoreColor(s.now.score, flagged)}">${s.now.score}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    const marker = L.marker([s.lat, s.lng], {
      icon, title: `${s.name}: ${s.now.score}`, keyboard: true, score: s.now.score, flagged,
    }).on("click", () => selectSpot(s.id));
    markers.set(s.id, marker);
    cluster.addLayer(marker);
  }
  if (!initialFitDone) {
    initialFitDone = true;
    fitAllSpots();
  }
}

// ---- Tür seçimi ----------------------------------------------------------
function renderSpecies() {
  const nav = $("#species");
  nav.innerHTML = state.meta.species
    .map((s) => `<button data-key="${s.key}" aria-pressed="${s.key === state.species}">${s.label}</button>`)
    .join("");
  nav.onclick = (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (!key || key === state.species) return;
    state.species = key;
    localStorage.setItem("species", key);
    renderSpecies();
    loadAll();
  };
}

// ---- Sıralama görünümü ---------------------------------------------------
function renderRanking() {
  const sorted = [...state.overview.spots].sort((a, b) => b.now.score - a.now.score);
  const label = state.meta.species.find((s) => s.key === state.species)?.label ?? "";
  panelBody.innerHTML = `
    <h1>Şu an en iyi meralar</h1>
    <p class="spot-meta">${escapeHtml(label)} için, saatlik skor (0–100). Haritadan ya da listeden bir mera seçin.</p>
    <ul class="ranking">
      ${sorted
        .map(
          (s) => `
        <li><button data-id="${s.id}">
          <span><span class="r-name">${escapeHtml(s.name)}</span>
          <span class="r-sub">${escapeHtml(s.region)} · 24 saatte en iyi: ${s.peak.score} (${fmtDayHour(s.peak.time)})</span></span>
          <span class="r-score" style="color:${scoreColor(s.now.score, s.now.flags.length)}">${s.now.score}</span>
        </button></li>`
        )
        .join("")}
    </ul>
    <p class="disclaimer">Tahminler bilgilendirme amaçlıdır. Denize çıkmadan önce resmî meteoroloji uyarılarını kontrol edin.</p>`;
  panelBody.querySelector(".ranking").onclick = (e) => {
    const id = e.target.closest("button")?.dataset.id;
    if (id) selectSpot(id);
  };
}

// ---- Detay görünümü ------------------------------------------------------
async function selectSpot(id) {
  state.selectedId = id;
  history.replaceState(null, "", `#${id}`);
  renderMarkers();
  const spot = state.overview.spots.find((s) => s.id === id);
  if (spot) map.flyTo([spot.lat, spot.lng], Math.max(map.getZoom(), 12), { duration: 0.6 });
  panel.classList.add("expanded");
  panelBody.innerHTML = `<p class="muted">${escapeHtml(spot?.name ?? "")} yükleniyor…</p>`;
  try {
    state.forecast = await api(`/api/forecast/${id}?species=${state.species}`);
    state.hourIdx = 0;
    renderDetail();
  } catch (err) {
    panelBody.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function renderDetail() {
  const { spot, series, best } = state.forecast;
  const cur = series[0];
  const flagged = cur.flags.length > 0;

  panelBody.innerHTML = `
    <button class="back" id="back">← Tüm meralar</button>
    <h1>${escapeHtml(spot.name)}</h1>
    <p class="spot-meta">${escapeHtml(spot.region)} · ${spot.type} · ${spot.depth} m · zemin: ${spot.bottom}</p>

    <div class="score-now">
      <div class="score-dial" style="color:${scoreColor(cur.score, flagged)}">${cur.score}</div>
      <div>
        <div class="score-word">${flagged ? "Tehlikeli koşullar" : scoreWord(cur.score)}</div>
        <div class="score-sub">Şu an (${fmtHour(cur.time)})</div>
      </div>
    </div>
    ${cur.flags.map((f) => `<span class="flag">${escapeHtml(f)}</span>`).join("")}

    <h2>En iyi saatler</h2>
    <ul class="windows">
      ${best
        .map(
          (w) => `<li><span class="when">${fmtDayHour(w.start)}–${fmtHour(w.end).replace(/:00$/, ":59")}</span><span class="pts">${w.score}</span></li>`
        )
        .join("")}
    </ul>

    <h2>72 saatlik tahmin</h2>
    <div class="chart-wrap"><canvas id="chart" aria-label="72 saatlik skor grafiği"></canvas></div>
    <p class="chart-hint">Bir saate dokunarak o saatin koşullarını görün. Sarı çubuklar en iyi saatlerdir.</p>

    <div id="hourDetail"></div>
    <p class="disclaimer">Veri: Open-Meteo (GFS/ECMWF harmanı, deniz modeli). Tahminler bilgilendirme amaçlıdır; denize çıkmadan önce resmî uyarıları kontrol edin.</p>`;

  $("#back").onclick = () => {
    state.selectedId = null;
    history.replaceState(null, "", location.pathname);
    panel.classList.remove("expanded");
    renderMarkers();
    renderRanking();
  };

  renderChart();
  renderHourDetail();
}

function renderChart() {
  const { series, best } = state.forecast;
  const bestSet = new Set();
  for (const w of best) {
    const i0 = series.findIndex((s) => s.time === w.start);
    const i1 = series.findIndex((s) => s.time === w.end);
    for (let i = i0; i <= i1; i++) bestSet.add(i);
  }
  const colors = series.map((s, i) =>
    bestSet.has(i) ? cssVar("--buoy") : scoreColor(s.score, s.flags.length)
  );
  const ink = cssVar("--ink");

  state.chart?.destroy();
  state.chart = new Chart($("#chart"), {
    type: "bar",
    data: {
      labels: series.map((s) => s.time),
      datasets: [
        {
          data: series.map((s) => s.score),
          backgroundColor: colors,
          borderColor: series.map((_, i) => (i === state.hourIdx ? ink : "transparent")),
          borderWidth: 2,
          barPercentage: 1,
          categoryPercentage: 0.9,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => fmtDayHour(items[0].label),
            label: (item) => `Skor: ${item.raw}`,
          },
        },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { stepSize: 25, color: cssVar("--ink-soft") }, grid: { color: cssVar("--line") } },
        x: {
          grid: { display: false },
          ticks: {
            color: cssVar("--ink-soft"),
            autoSkip: false,
            maxRotation: 0,
            callback: (_v, i) => {
              const t = series[i].time;
              if (t.endsWith("T00:00")) return DAYS[parseLocal(t).getUTCDay()];
              if (t.endsWith("T12:00")) return "12";
              return "";
            },
          },
        },
      },
      onClick: (_e, els) => {
        if (!els.length) return;
        state.hourIdx = els[0].index;
        state.chart.data.datasets[0].borderColor = series.map((_, i) => (i === state.hourIdx ? ink : "transparent"));
        state.chart.update();
        renderHourDetail();
      },
    },
  });
}

function renderHourDetail() {
  const h = state.forecast.series[state.hourIdx];
  const c = h.conditions;
  const labels = state.meta.factors;
  const n = (v, d = 1) => (v == null ? "–" : Number(v).toFixed(d));
  const trend = h.pressureTrend == null ? "" : `${h.pressureTrend > 0 ? "+" : ""}${h.pressureTrend} hPa/3s`;

  $("#hourDetail").innerHTML = `
    <h2>${fmtDayHour(h.time)} · skor ${h.score}</h2>
    <dl class="conds">
      <div><dt>Rüzgâr</dt><dd><span class="arrow" style="transform:rotate(${(c.windDir ?? 0) + 180}deg)" aria-hidden="true">↑</span> ${n(c.windSpeed, 0)} km/s <small>hamle ${n(c.gusts, 0)} · ${h.notes.shore}</small></dd></div>
      <div><dt>Dalga</dt><dd>${n(c.wave)} m <small>${c.wavePeriod != null ? n(c.wavePeriod, 0) + " sn periyot" : ""}</small></dd></div>
      <div><dt>Su sıcaklığı</dt><dd>${n(c.sst)} °C <small>hava ${n(c.airTemp, 0)} °C</small></dd></div>
      <div><dt>Basınç</dt><dd>${n(c.pressure, 0)} hPa <small>${trend}</small></dd></div>
      <div><dt>Ay</dt><dd>${h.notes.moon.icon} %${h.moonIllumination} <small>${h.notes.moon.name}</small></dd></div>
      <div><dt>Bulut / yağış</dt><dd>%${n(c.cloud, 0)} <small>${n(c.precip)} mm</small></dd></div>
    </dl>

    <h2>Skoru etkileyenler</h2>
    <div class="factors">
      ${Object.entries(h.factors)
        .map(([k, v]) => {
          const note = k === "pressure" ? h.notes.pressure : k === "light" ? h.notes.light : k === "shore" ? h.notes.shore : "";
          return `<div class="factor">
            <span>${labels[k]}</span>
            <span class="bar"><span style="width:${v}%;background:${scoreColor(v)}"></span></span>
            <span class="v">${v}</span>
            ${note ? `<span class="note">${escapeHtml(note)}</span>` : ""}
          </div>`;
        })
        .join("")}
    </div>`;
}

// ---- Yükleme -------------------------------------------------------------
async function loadAll() {
  try {
    state.overview = await api(`/api/overview?species=${state.species}`);
    renderMarkers();
    if (state.selectedId) await selectSpot(state.selectedId);
    else renderRanking();
  } catch (err) {
    panelBody.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>
      <button class="back" onclick="location.reload()">Yeniden dene</button>`;
  }
}

$("#sheetHandle").onclick = () => panel.classList.toggle("expanded");

(async function init() {
  state.meta = await api("/api/meta");
  if (!state.meta.species.some((s) => s.key === state.species)) state.species = "genel";
  renderSpecies();
  const fromHash = location.hash.slice(1);
  if (fromHash) state.selectedId = fromHash;
  await loadAll();
  // Veriyi 30 dakikada bir tazele
  setInterval(loadAll, 30 * 60 * 1000);
})();
