// FizikRehberi — tüm sayfaların paylaştığı yardımcılar
const FR = (() => {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // Tema: kayıtlı tercih > sistem
  const saved = store.get("fr-theme");
  if (saved) document.documentElement.dataset.theme = saved;

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

  // Retina-uyumlu canvas; boyut değişince yeniden ölçekler
  function canvas(el) {
    const ctx = el.getContext("2d");
    const fit = () => {
      const r = el.getBoundingClientRect(), d = devicePixelRatio || 1;
      el.width = r.width * d; el.height = r.height * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    new ResizeObserver(fit).observe(el);
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

  function fullscreen(el) {
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.();
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) toggleTheme();
  });

  // Sol alt: GitHub bağlantısı (+ ana sayfada öneri/hata e-postası)
  const GH = "https://github.com/Aviressence/maleti-labs", MAIL = "maletilabs@quatressence.dev";
  const GH_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
  document.addEventListener("DOMContentLoaded", () => {
    const sim = document.body.classList.contains("sim-page");
    const el = document.createElement(sim ? "div" : "footer");
    el.className = sim ? "gh-corner" : "site-foot";
    el.innerHTML = `<a class="gh" href="${GH}" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub">${GH_ICON}</a>` +
      (sim ? "" : `<span>Öneri ve hata bildirimi için: <a href="mailto:${MAIL}">${MAIL}</a></span>`);
    (sim ? document.body : document.querySelector("main")?.parentNode || document.body).appendChild(el);
  });

  return { colors, canvas, params, fullscreen, isDark };
})();
