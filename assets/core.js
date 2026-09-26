// FizikRehberi — tüm sayfaların paylaştığı yardımcılar
const FR = (() => {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // Tema: kayıtlı tercih > sistem
  const saved = store.get("fr-theme");
  // Varsayılan koyu tema; kullanıcı seçtiyse onun tercihi
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";

  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function toggleTheme() {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("fr-theme", next);
    syncSwitch();
  }
  // Tema anahtarının erişilebilirlik durumu (ekran okuyucu: açık = koyu tema)
  function syncSwitch() {
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.setAttribute("aria-checked", isDark()));
  }
  document.addEventListener("DOMContentLoaded", syncSwitch);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncSwitch);

  // Canvas çizimleri için CSS token'larını oku
  function colors() {
    const s = getComputedStyle(document.documentElement);
    const v = (n) => s.getPropertyValue(n).trim();
    return { bg: v("--panel"), ink: v("--ink"), muted: v("--muted"), line: v("--line"),
             accent: v("--accent"), accent2: v("--accent-2"), ok: v("--ok") };
  }

  // Retina-uyumlu canvas; boyut değişince yeniden ölçekler.
  // Tampon, ekrandaki gerçek piksel sayısına eşitlenir (kesirli CSS boyutunda esneyip bulanıklaşmasın).
  function canvas(el) {
    const ctx = el.getContext("2d");
    const fit = (entry) => {
      const r = el.getBoundingClientRect(), d = devicePixelRatio || 1;
      const b = entry?.devicePixelContentBoxSize?.[0];
      const w = b ? b.inlineSize : Math.round(r.width * d), h = b ? b.blockSize : Math.round(r.height * d);
      if (!r.width || !r.height) return;
      el.width = w; el.height = h;
      ctx.setTransform(w / r.width, 0, 0, h / r.height, 0, 0);
    };
    const ro = new ResizeObserver(([e]) => fit(e));
    try { ro.observe(el, { box: "device-pixel-content-box" }); } catch { ro.observe(el); }
    fit();
    return { ctx, size: () => ({ w: el.clientWidth, h: el.clientHeight }) };
  }

  // data-param'lı kaydırıcıları URL ile eşle: ?L=1.2&th=30 linkiyle aynı ayarlar açılır
  function params(root = document) {
    const q = new URLSearchParams(location.search);
    const vals = {};
    root.querySelectorAll("input[data-param]").forEach((inp) => {
      const k = inp.dataset.param, out = inp.closest(".ctrl")?.querySelector("output");
      if (q.has(k)) inp.value = q.get(k);
      const sync = () => {
        vals[k] = parseFloat(inp.value);
        if (out) out.textContent = inp.value + (inp.dataset.unit || "");
      };
      inp.addEventListener("input", () => {
        sync();
        q.set(k, inp.value);
        history.replaceState(null, "", "?" + q);
      });
      sync();
    });
    return vals;
  }

  // Tam ekran (Safari/iPad: webkit önekli). iPhone Safari öğe tam ekranını hiç desteklemez: düğme gizlenir.
  const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  function fullscreen(el) {
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  }

  // Eski Safari (iOS < 16.4) canvas'ta roundRect bilmez: basit yedek
  if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r = 0) {
      r = Math.max(0, Math.min(Array.isArray(r) ? r[0] || 0 : r, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
    };
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) toggleTheme();
  });

  // Sol alt: GitHub bağlantısı (+ ana sayfada öneri/hata e-postası)
  const GH = "https://github.com/Aviressence/maleti-labs", MAIL = "maletilabs@quatressence.dev";
  const GH_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
  document.addEventListener("DOMContentLoaded", () => {
    const sim = document.body.classList.contains("sim-page");
    if (!fsSupported()) document.querySelectorAll("#fs").forEach((b) => (b.hidden = true));
    // Telefonda döndürme önerisi. Sayfa <body data-orient="…"> ile seçer:
    //   "landscape" → dikeyken "yan çevirin"; "portrait" → yatayken "dikey çevirin"; yok / "none" → öneri yok.
    // CSS yalnız ilgili ekran yönünde gösterir; kapatılınca oturum boyunca o öneri gelmez.
    const layout = document.querySelector(".sim-layout");
    const orient = document.body.dataset.orient || "none";   // şimdilik varsayılan: öneri yok (sayfa isterse açar)
    const key = "fr-rotate-" + orient;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(key) === "1"; } catch {}
    if (sim && layout && orient !== "none" && !dismissed) {
      const hint = document.createElement("div");
      hint.className = "rotate-hint to-" + orient;
      hint.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="17" rx="2"/><path d="M20.5 14a8.5 8.5 0 0 1-6 7.5M3.5 10a8.5 8.5 0 0 1 6-7.5"/></svg>' +
        `<span>Daha rahat görmek için telefonu ${orient === "portrait" ? "dikey" : "yan"} çevirin.</span><button type="button" aria-label="Kapat">×</button>`;
      hint.querySelector("button").onclick = () => { hint.remove(); try { sessionStorage.setItem(key, "1"); } catch {} };
      layout.before(hint);
    }
    const el = document.createElement(sim ? "div" : "footer");
    el.className = sim ? "gh-corner" : "site-foot";
    el.innerHTML = `<a class="gh" href="${GH}" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub">${GH_ICON}</a>` +
      (sim ? "" : `<span>İstek, öneri ve geri bildirimleriniz için: <a href="mailto:${MAIL}">${MAIL}</a></span>`);
    (sim ? document.body : document.querySelector("main")?.parentNode || document.body).appendChild(el);
  });

  return { colors, canvas, params, fullscreen, isDark };
})();
