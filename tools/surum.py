"""Ortak dosya bağlantılarına içerik özeti ekler: assets/vec.js -> assets/vec.js?v=1a2b3c4d

Dosya değişince adresi de değişir; tarayıcı önbellekteki eski sürümü kullanamaz.
Her commit'ten önce çalıştırın:  python tools/surum.py
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
for page in [ROOT / "index.html", *sorted((ROOT / "sims").glob("*.html"))]:
    text = page.read_text(encoding="utf-8")
    new = REF.sub(lambda m: f'{m.group(1)}?v={digest(m.group(2))}"', text)
    if new != text:
        page.write_text(new, encoding="utf-8", newline="")
        changed += 1
        print("güncellendi:", page.relative_to(ROOT))
print(f"{changed} sayfa güncellendi")
