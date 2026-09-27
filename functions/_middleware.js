// Markdown içerik anlaşması (Cloudflare Pages Functions).
// "Accept: text/markdown" isteyen istemciye (ör. yapay zekâ ajanları) sayfanın md/ altındaki
// Markdown özeti döner; tarayıcılar ve diğer tüm istekler normal HTML'i alır.
// Yalnız _routes.json'daki yollarda çalışır (ana sayfa ve sims/).

const MD = (path) => {
  const p = path.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
  if (p === "/" || p === "/index") return "/md/index.md";
  if (p === "/sims/dalga-simulatoru" || p === "/sims/dalga-simulatoru/") return "/md/sims/dalga-simulatoru.md";
  const m = p.match(/^\/sims\/([a-z0-9-]+)\/?$/);
  return m ? `/md/sims/${m[1]}.md` : null;
};

// text/markdown açıkça istenmiş ve q=0 ile reddedilmemiş mi
const wantsMarkdown = (accept) =>
  accept.split(",").some((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(";").map((s) => s.trim());
    const q = params.find((x) => x.startsWith("q="));
    return type === "text/markdown" && !(q && parseFloat(q.slice(2)) === 0);
  });

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  const md = (request.method === "GET" || request.method === "HEAD") ? MD(url.pathname) : null;

  if (md && wantsMarkdown(request.headers.get("Accept") || "")) {
    const res = await env.ASSETS.fetch(new URL(md, url.origin));
    if (res.ok) {
      return new Response(request.method === "HEAD" ? null : res.body, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Vary": "Accept",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  }

  const res = await next();
  if (!md) return res;
  // Aynı adres içerik türüne göre değişiyor: önbellekler karıştırmasın
  const out = new Response(res.body, res);
  out.headers.append("Vary", "Accept");
  return out;
}
