// Vektör simülasyonları için ortak koordinat düzlemi: ızgara, ok, tutamak, sürükleme
const V = {
  add: (u, v) => ({ x: u.x + v.x, y: u.y + v.y }),
  neg: (v) => ({ x: -v.x, y: -v.y }),
  mag: (v) => Math.hypot(v.x, v.y),
  dot: (u, v) => u.x * v.x + u.y * v.y,
  cross: (u, v) => u.x * v.y - u.y * v.x,
  ang: (v) => { const a = Math.atan2(v.y, v.x) * 180 / Math.PI; return a < 0 ? a + 360 : a; },
  fmt: (n) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2),
  // Formül içinde negatif sayıyı paranteze alır: 3.00 − (−1.00)
  par: (n) => (V.fmt(n).startsWith("-") ? `(${V.fmt(n)})` : V.fmt(n)),
};

// Tuvaldeki matematik etiketleri KaTeX'in yazı tipiyle çizilir; paneldeki formüllerle aynı görünür
const MATH_FONT = "KaTeX_Math, 'Times New Roman', serif";

function Plane(canvas) {
  const { ctx, size } = FR.canvas(canvas);
  const P = { ctx, size, unit: 30, O: { x: 0, y: 0 }, snap: () => true };
  P.toPx = (p) => ({ x: P.O.x + p.x * P.unit, y: P.O.y - p.y * P.unit });
  P.toW = (x, y) => ({ x: (x - P.O.x) / P.unit, y: (P.O.y - y) / P.unit });

  // Orijin tuvalin (fx, fy) oranında; birim ekranda ~22×14 kare sığacak şekilde
  P.layout = (fx = 0.4, fy = 0.65) => {
    const { w, h } = size();
    P.unit = Math.max(18, Math.min(w / 22, h / 14));
    P.O = { x: Math.round(w * fx), y: Math.round(h * fy) };
    ctx.clearRect(0, 0, w, h);
    return { W: w, H: h };
  };

  // "A", "−B", "A_x" gibi etiketi (x, y) merkezine çizer; vec ise harfin üstüne ok koyar
  P.label = (text, x, y, color, { size = 22, vec = true } = {}) => {
    const neg = text.startsWith("−") ? "−" : "";
    const [base, sub = ""] = text.slice(neg.length).split("_");
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = color; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const fBase = `italic ${size}px ${MATH_FONT}`, fSub = `italic ${Math.round(size * 0.68)}px ${MATH_FONT}`;
    ctx.font = `${size}px ${MATH_FONT}`; const wNeg = neg ? ctx.measureText(neg).width + 2 : 0;
    ctx.font = fBase; const wBase = ctx.measureText(base).width;
    ctx.font = fSub; const wSub = sub ? ctx.measureText(sub).width + 1 : 0;
    let cx = x - (wNeg + wBase + wSub) / 2;
    if (neg) { ctx.font = `${size}px ${MATH_FONT}`; ctx.fillText(neg, cx, y); cx += wNeg; }
    ctx.font = fBase; ctx.fillText(base, cx, y);
    if (vec) {
      const ay = y - size * 0.62, x0 = cx + 1, x1 = cx + wBase + 2, hd = size * 0.2;
      ctx.lineWidth = Math.max(1.3, size / 14);
      ctx.beginPath(); ctx.moveTo(x0, ay); ctx.lineTo(x1, ay);
      ctx.moveTo(x1 - hd, ay - hd * 0.6); ctx.lineTo(x1, ay); ctx.lineTo(x1 - hd, ay + hd * 0.6); ctx.stroke();
    }
    if (sub) { ctx.font = fSub; ctx.fillText(sub, cx + wBase + 1, y + size * 0.3); }
    ctx.restore();
  };

  P.grid = (c) => {
    const { w: W, h: H } = size(), { O, unit } = P;
    const x0 = Math.floor(-O.x / unit), x1 = Math.ceil((W - O.x) / unit);
    const y0 = Math.floor((O.y - H) / unit), y1 = Math.ceil(O.y / unit);
    ctx.lineWidth = 1; ctx.strokeStyle = c.line; ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let i = x0; i <= x1; i++) { const X = O.x + i * unit; ctx.moveTo(X, 0); ctx.lineTo(X, H); }
    for (let j = y0; j <= y1; j++) { const Y = O.y - j * unit; ctx.moveTo(0, Y); ctx.lineTo(W, Y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c.muted; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, O.y); ctx.lineTo(W, O.y); ctx.moveTo(O.x, 0); ctx.lineTo(O.x, H); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.font = "13px 'JetBrains Mono', monospace";
    const step = unit < 34 ? 2 : 1;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i = x0; i <= x1; i++) if (i && i % step === 0) ctx.fillText(i, O.x + i * unit, O.y + 4);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let j = y0; j <= y1; j++) if (j && j % step === 0) ctx.fillText(j, O.x - 5, O.y - j * unit);
    P.label("x", W - 12, O.y - 14, c.muted, { size: 20, vec: false });
    P.label("y", O.x + 14, 14, c.muted, { size: 20, vec: false });
  };

  P.arrow = (from, v, color, { width = 2.5, dash = null, label = "", alpha = 1, side = 1, vec = true } = {}) => {
    const a = P.toPx(from), b = P.toPx(V.add(from, v));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, h = Math.min(16, len * 0.4);
    ctx.save();
    ctx.globalAlpha = alpha; ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x - ux * h * 0.8, b.y - uy * h * 0.8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - ux * h - uy * h * 0.45, b.y - uy * h + ux * h * 0.45);
    ctx.lineTo(b.x - ux * h + uy * h * 0.45, b.y - uy * h - ux * h * 0.45);
    ctx.closePath(); ctx.fill();
    if (label) P.label(label, (a.x + b.x) / 2 - uy * 24 * side, (a.y + b.y) / 2 + ux * 24 * side, color, { vec });
    ctx.restore();
  };

  P.dashed = (p, q, color, alpha = 0.55) => {
    const a = P.toPx(p), b = P.toPx(q);
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  };

  // Başlangıç açısından bitişe yay (derece, x ekseninden saat yönü tersine)
  P.arc = (center, r, fromDeg, toDeg, color, label = "") => {
    const o = P.toPx(center), a0 = -fromDeg * Math.PI / 180, a1 = -toDeg * Math.PI / 180;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.arc(o.x, o.y, r, a0, a1, a1 < a0); ctx.stroke();
    ctx.restore();
    if (label) {
      const m = (a0 + a1) / 2;
      P.label(label, o.x + (r + 14) * Math.cos(m), o.y + (r + 14) * Math.sin(m), color, { size: 19, vec: false });
    }
  };

  P.handle = (p, color) => {
    const s = P.toPx(p);
    ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, 7);
    ctx.fillStyle = FR.colors().bg; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
  };

  // handles(): [{ id, p }] ; onMove(id, dünyaNoktası) ; onEnd()
  P.draggable = (handles, onMove, onEnd = () => {}) => {
    let drag = null;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const hit = (m) => handles().find((h) => { const s = P.toPx(h.p); return Math.hypot(s.x - m.x, s.y - m.y) < 24; });
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => {
      const h = hit(local(e));
      if (h) {
        drag = h.id; canvas.setPointerCapture(e.pointerId);
        canvas.parentElement.querySelector(".stage-hint")?.remove(); // ipucu ilk sürüklemede kaybolur
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const m = local(e);
      if (!drag) { canvas.style.cursor = hit(m) ? "grab" : "default"; return; }
      let p = P.toW(m.x, m.y);
      p = P.snap() ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: +p.x.toFixed(2), y: +p.y.toFixed(2) };
      onMove(drag, p);
      canvas.style.cursor = "grabbing";
    });
    const stop = () => { if (drag) onEnd(); drag = null; };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
  };

  return P;
}

// URL ↔ durum: sayısal anahtarları okur, save() ile geri yazar
function urlState(defaults) {
  const q = new URLSearchParams(location.search), s = {};
  for (const k in defaults) {
    const v = q.get(k);
    s[k] = typeof defaults[k] === "number" ? (v !== null && !isNaN(+v) ? +v : defaults[k]) : (v ?? defaults[k]);
  }
  s.save = () => {
    const p = new URLSearchParams();
    for (const k in defaults) p.set(k, s[k]);
    history.replaceState(null, "", "?" + p);
  };
  return s;
}

// Segmentli düğme grubu: <div class="seg" id> içindeki data-v düğmeleri
function segment(id, get, set) {
  const box = document.getElementById(id);
  const sync = () => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === get()));
  box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { set(b.dataset.v); sync(); } });
  sync();
}

// --- Formüller (KaTeX) ---
// \cA{…}, \cB{…} birinci/ikinci vektörün rengini verir (CSS .c1/.c2, temaya uyar)
const TEX_MACROS = {
  "\\cA": "\\htmlClass{c1}{#1}",
  "\\cB": "\\htmlClass{c2}{#1}",
  "\\vA": "\\cA{\\vec{A}}",
  "\\vB": "\\cB{\\vec{B}}",
  "\\vR": "\\vec{R}",
  "\\ii": "\\hat{\\imath}",
  "\\jj": "\\hat{\\jmath}",
  "\\kk": "\\hat{k}",
};

const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);

// KaTeX yüklenemezse sayfa durmaz; formül düz metin olarak görünür
function tex(src) {
  if (!window.katex) return `<code>${esc(src)}</code>`;
  return katex.renderToString(src, {
    throwOnError: false, strict: "ignore", macros: TEX_MACROS,
    trust: (c) => c.command === "\\htmlClass",
  });
}

// "**Kalın:** metin $\\vA + \\vB$ *italik*" → HTML; $…$ arası LaTeX
function rich(s) {
  return s.split(/(\$[^$]+\$)/).map((part) =>
    part.length > 1 && part.startsWith("$") && part.endsWith("$")
      ? tex(part.slice(1, -1))
      : esc(part).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>")
  ).join("");
}

// Denklem satırları: her satır tek parça, alta kaymaz; sığmazsa o satırın yazısı küçülür
function setEqs(el, lines) {
  const key = lines.join("\n");
  if (el._key === key) return;
  el._key = key;
  el.innerHTML = lines.map((l) => `<div class="eq">${rich(l)}</div>`).join("");
  fitEqs(el);
}

// Yalnızca paneldeki (.calc) satırlar küçültülür; başlık formülü kendi genişliğinde kalır
function fitEqs(el) {
  if (!el.classList.contains("calc")) return;
  el.querySelectorAll(".eq").forEach((d) => {
    d.style.fontSize = "";
    const over = d.scrollWidth / d.clientWidth;
    if (over > 1) d.style.fontSize = Math.max(11, parseFloat(getComputedStyle(d).fontSize) / over) + "px";
  });
}

// KaTeX yazı tipleri geç yüklenince satırlar genişler; ölçümü yazı tipleri gelince tekrarla
document.fonts?.addEventListener("loadingdone", () => document.querySelectorAll(".calc").forEach(fitEqs));
