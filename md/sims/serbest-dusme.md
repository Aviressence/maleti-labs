# Serbest Düşme ve Düşey Atış

*Fizik 1 · Hafta 3 · Tek Boyutlu Hareket*

Adres: https://maletilabs.quatressence.dev/sims/serbest-dusme

Bir top belirli yükseklikten bırakılır veya yukarı/aşağı atılır. Dünya, Ay ve Mars için $g$ seçilebilir. Çoklu flaş görüntüsü, y–t ve v–t grafikleri, tepe noktası ve yere çarpma anı gösterilir. Hava direnci yoktur.

## Ayarlar
- Gezegen: Dünya (9.81) / Ay (1.62) / Mars (3.71 m/s²)
- Başlangıç yüksekliği h₀
- İlk hız v₀ (+ yukarı)
- Zaman t, oynat (0.5× / 1×)

## Formüller ve kurallar
- $y = h_0 + v_0t - \tfrac12gt^2$, $v = v_0 - gt$, ivme hep $-g$
- Tepe: $t = v_0/g$, $h_{\max} = h_0 + v_0^2/2g$; tepede $v = 0$ ama ivme yine $-g$
- Yere çarpma: $v = -\sqrt{v_0^2 + 2gh_0}$; aynı yüksekliğe aynı süratle döner

## Bağlantı parametreleri
Ayarlar adreste saklanır; paylaşılan bağlantı aynı ayarlarla açılır: `gz` (dunya | ay | mars), `h0`, `v0`.

Tüm simülasyonlar: https://maletilabs.quatressence.dev/
