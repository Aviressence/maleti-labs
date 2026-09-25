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
  }

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

  return { colors, canvas, params, fullscreen, isDark };
})();
