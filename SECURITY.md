# Güvenlik

MaLeTiLabs statik bir sitedir: sunucu tarafında kod, veritabanı, kullanıcı hesabı veya form yoktur.

- **Veri toplama yok.** Analitik, çerez veya takip betiği kullanılmaz.
- **Tarayıcıda saklanan tek şey** tema tercihidir (açık/koyu, `localStorage`).
- **Linkteki parametreler** yalnızca sayı olarak okunur ve sayfaya metin olarak yazılır, kod olarak çalıştırılmaz.
- **Dış kaynak** olarak yalnızca Google Fonts yüklenir. Dalga simülatörü tamamen yereldir, katı bir Content Security Policy ile ağ isteğini tamamen kapatır.
- Cloudflare Pages üzerinde `_headers` dosyasıyla temel güvenlik başlıkları eklenir.

## Sorun bildirme

Bir güvenlik sorunu bulursanız lütfen herkese açık issue açmak yerine GitHub'daki **Security → Report a vulnerability** bölümünden özel olarak bildirin.
