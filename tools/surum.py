"""Ortak dosya bağlantılarına içerik özeti ekler: assets/vec.js -> assets/vec.js?v=1a2b3c4d

Dosya değişince adresi de değişir; tarayıcı önbellekteki eski sürümü kullanamaz.
Her commit'ten önce çalıştırın:  python tools/surum.py   (sitemap.xml de burada güncellenir)
"""
import hashlib
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = pathlib.Path(__file__).resolve().parent.parent
REF = re.compile(r'((?:\.\./)*assets/([\w.-]+\.(?:js|css)))(?:\?v=\w+)?"')


def digest(name):
    return hashlib.sha1((ROOT / "assets" / name).read_bytes()).hexdigest()[:8]


changed = 0
for page in [ROOT / "index.html", ROOT / "404.html", *sorted((ROOT / "sims").glob("*.html"))]:
    text = page.read_text(encoding="utf-8")
    new = REF.sub(lambda m: f'{m.group(1)}?v={digest(m.group(2))}"', text)
    if new != text:
        page.write_text(new, encoding="utf-8", newline="")
        changed += 1
        print("güncellendi:", page.relative_to(ROOT))
# Dalga simülatörü: kendi klasöründeki js/ ve css/ dosyaları
WAVE = ROOT / "sims" / "dalga-simulatoru"
WREF = re.compile(r'((?:src|href)=")((?:js|css|fonts)/[\w.-]+\.(?:js|css))(?:\?v=\w+)?"')
page = WAVE / "index.html"
text = page.read_text(encoding="utf-8")
new = WREF.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={hashlib.sha1((WAVE / m.group(2)).read_bytes()).hexdigest()[:8]}"', text)
if new != text:
    page.write_text(new, encoding="utf-8", newline="")
    changed += 1
    print("güncellendi:", page.relative_to(ROOT))
print(f"{changed} sayfa güncellendi")

# Site haritası (sitemap.xml): ana sayfa, simülasyonlar ve dalga simülatörü.
# Adresler Cloudflare'in uzantısız biçiminde; lastmod dosyanın son commit tarihi (yoksa bugün).
import datetime
import subprocess

SITE = "https://maletilabs.quatressence.dev"
HARIC = {"yakinda.html"}                     # iskelet sayfa, parametreyle açılır


def son_tarih(path):
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(path)], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout.strip()
        return out or datetime.date.today().isoformat()
    except (OSError, subprocess.CalledProcessError):
        return datetime.date.today().isoformat()


girdiler = [("/", ROOT / "index.html", "1.0")]
girdiler += [(f"/sims/{p.stem}", p, "0.8") for p in sorted((ROOT / "sims").glob("*.html")) if p.name not in HARIC]
girdiler.append(("/sims/dalga-simulatoru/", WAVE / "index.html", "0.9"))
xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for yol, dosya, onc in girdiler:
    xml.append(f"  <url><loc>{SITE}{yol}</loc><lastmod>{son_tarih(dosya)}</lastmod><priority>{onc}</priority></url>")
xml.append("</urlset>\n")
harita = ROOT / "sitemap.xml"
yeni = "\n".join(xml)
if not harita.exists() or harita.read_text(encoding="utf-8") != yeni:
    harita.write_text(yeni, encoding="utf-8", newline="\n")
    print("güncellendi: sitemap.xml")
