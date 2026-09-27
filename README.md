# MaLeTiLabs

Üniversite fizik dersleri için tarayıcıda çalışan interaktif simülasyonlar. Simülasyonlar ders müfredatına göre hafta hafta düzenlenmiştir. Kurulum gerektirmez ve projeksiyonda kullanılabilir.

**Site:** https://maletilabs.quatressence.dev

## Şu an olanlar

**Fizik 1**
- Hafta 1: Birimler ve ön ekler (ölçek şeridi, dönüştürücü, alan/hacim)
- Hafta 1: Boyut analizi (denklem denetleyici, boyutlardan formül türetme)
- Hafta 1: Anlamlı basamak ve belirsizlik (A4 ölçümü, sarkaçla g ve hata yayılımı)
- Hafta 1: Vektör toplama (uç uca / paralelkenar, A + B ve A − B)
- Hafta 1: Vektörün bileşenleri (Aₓ, A_y, birim vektörler)
- Hafta 1: Skaler ve vektörel çarpım (izdüşüm, paralelkenar alanı, ⊙/⊗ yönü)

**Dalgalar ve Optik**
- Hafta 1: Basit sarkaç (büyük açı, sönüm, θ(t) grafiği)
- Hafta 2: Dalga simülatörü (2B dalga denklemi, girişim, mercekler)

Tüm simülasyonlarda parametreler adres satırına yazılır. Aynı link, simülasyonu aynı ayarlarla açar.

## Gelecek olanlar

**Fizik 1**
- Hafta 2: x–t / v–t / a–t grafikleri, ortalama ve anlık hız
- Hafta 3: Serbest düşme, eğik atış, bağıl hareket

**Dalgalar ve Optik**
- Hafta 1: Yay–kütle sistemi, basit harmonik hareket ve dairesel hareket ilişkisi
- Hafta 2: Enine / boyuna dalga, atma ilerlemesi, süperpozisyon
- Hafta 3: Sabit / serbest uçta yansıma, ortam değişiminde geçiş, harmonik dalga

Diğer haftalar dönem ilerledikçe eklenecek. Müfredatlar `docs/` klasöründe.

## Yerelde çalıştırma

Derleme adımı yok, dosyalar olduğu gibi yayınlanır.

```bash
python -m http.server 5500
```

Ardından `http://localhost:5500` adresini açın.

## Klasör yapısı

```
index.html        Ana sayfa (ders ve hafta listesi)
assets/           Ortak stil ve yardımcılar (core.js, vec.js)
sims/             Simülasyon sayfaları
docs/             Ders müfredatları
```

`assets/` içindeki bir dosya değiştiyse commit'ten önce `python tools/surum.py` çalıştırılır. Betik sayfalardaki bağlantılara içerik özetini (`?v=...`) yazar; böylece tarayıcılar eski dosyayı önbellekten kullanmaz. Aynı betik `sitemap.xml` dosyasını da yeniden üretir; yeni simülasyon eklenince haritaya kendiliğinden girer.

Yeni bir simülasyon `sims/` klasörüne eklenir. Ana sayfada görünmesi için `index.html` içindeki `COURSES` listesinde ilgili haftaya `{ ad, url }` yazılır.

## Lisans

Bu proje [MIT](LICENSE) lisansı ile yayınlanmıştır.
Dalga simülatörü dışındaki tüm içerik bana aittir.
Dalga simülatörü, Eliott Morgensztern'in [Wave Simulator](https://github.com/starrfree/wave-simulator) projesinden esinlenerek geliştirilmiştir.
Lisansı ve kaynakları `sims/dalga-simulatoru/` klasöründedir.
Formüller [KaTeX](https://katex.org) (MIT) ile gösterilir; lisansı `assets/katex-0.18.9/` klasöründedir.
