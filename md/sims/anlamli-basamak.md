# Anlamlı Basamak ve Belirsizlik

*Fizik 1 · Hafta 1 · Fizik ve Ölçme*

Adres: https://maletilabs.quatressence.dev/sims/anlamli-basamak

İki sekme. Anlamlı basamak: yazılan sayının rakamları anlamlı / yer tutucu / belirsiz olarak renklenir; A4 kâğıdı şerit metre, cetvel ve kumpasla ölçülüp alan ve çevre doğru basamakla hesaplanır. Belirsizlik: sarkaçla $g$ ölçümünde uzunluk ve zaman hatalarının $g$'ye katkısı gösterilir.

## Ayarlar
- Sayı (ör. 0.004050, 1200, 2.50e3)
- Ölçüm aleti: şerit metre / cetvel / kumpas
- İp uzunluğu L, cetvel hatası ΔL, kronometre hatası Δt, salınım sayısı n

## Formüller ve kurallar
- Sıfır olmayan rakamlar her zaman anlamlıdır; arada kalan sıfır anlamlıdır ($105 \to 3$).
- Öndeki sıfırlar anlamlı değildir ($0.0045 \to 2$); sondaki sıfır yalnız ondalık varsa anlamlıdır ($2.50 \to 3$).
- Çarpma/bölme: sonuç en az anlamlı basamaklı çarpan kadar; toplama/çıkarma: en az ondalık basamak kadar.
- Bağıl belirsizlik: $\Delta g/g = \Delta L/L + 2\,\Delta T/T$; $n$ salınım birlikte ölçülürse $\Delta T = \Delta t / n$.

## Bağlantı parametreleri
Ayarlar adreste saklanır; paylaşılan bağlantı aynı ayarlarla açılır: `mod` (ab | bel), `sayi`, `alet` (0–2), `L`, `dL`, `dt`, `n`.

Tüm simülasyonlar: https://maletilabs.quatressence.dev/
