![Başvuru istatistik kapak görseli: LinkedIn ilan listesine büyüteçle bakılan bir sahne](assets/kapak.jpg)

# Başvuru istatistik

## Manifesto

Bu araç, LinkedIn’de **“Kolay Başvuru”** yöntemiyle yaptığınız iş başvurularının görüntülenip görüntülenmediğini ve başvurular sırasında CV’nizin indirilip indirilmediğini gerçek veriler üzerinden takip etmenizi sağlar.

**İş başvurularınızı takip edin, başvuru süreçlerinizi analiz edin ve tüm verilerinizi tek bir ekrandan kolayca görüntüleyin.**

Chrome tabanlı script ve eklenti olarak kullanılabilir.

Paylaşıldığı platform LinkedIn. Gönderi: [Son 1 yılda başvurduğum iş ilanları](https://www.linkedin.com/feed/update/urn:li:activity:7507938457974104065/). **300 bin gösterim**, **1.583 beğeni**.

> **Dipnot.** Bazı firmalar üçüncü parti servislerle CV topladığı için, görüntülenmemiş olması firmanın gerçekten görüntülemediği anlamına gelmez. Maillerinizi kontrol etmenizi tavsiye ederim.

## Teknik kaos özeti

LinkedIn, “başvurularımı düzgün bir dosya olarak ver” diye bir kapı bırakmadı. Bıraktığı şey, aynı listenin üç ayrı lehçede birden konuştuğu bir sayfa. Eklenti de o üç lehçeden hâlâ okunabileni okur. Başka bir sunucuya sormaz. İşe alımcının ekranına da bakmaz. LinkedIn’in **Başvuruldu** satırına kendi yazdığı cümleyi okur.

### Üç lehçe

**Ekran.** Liste kaydırdıkça doğar. Satırların bir kısmı daha iskelettir: gri titreme, boş kutu, “yazı birazdan gelir” vaadi. Sınıf adları da sözünde durmaz. Bugün `jobs-` ile başlayan kutu, yarın başka bir karmaşadır. Sanal listeye CSS seçicisiyle güvenmek, kumdan kale kurmaktır.

**Voyager.** Asıl liste çoğu zaman GraphQL ile gelir. Sayfalama bazen `start` ve `count`, bazen `offset`, bazen de gövdenin içine gömülü `variables=(start:…,count:…)` olur. “2. sayfa” diye bir düğme her zaman yoktur. Kaydırma çubuğu vardır, o da yorulur.

**RSC uçuşu.** Flagship cevabı her zaman DOM değildir. React Server Components notasıdır. Satırlar `1a2b:<payload>` diye dizilir, içlerindeki `$L` referansları başka satırlara işaret eder. Metin oradadır. Piksel henüz haberdar değildir.

### Kalan teknik

Sayfa yüklenirken, LinkedIn’in kendi kodundan önce, ana dünyada `fetch` ve `XHR` dinlenir. Yakalanan istek yalnızca dört adreste, senin oturumunla yeniden oynatılır:

- `/voyager/api/graphql`
- `/voyager/api/voyagerJobsDashJobCards`
- `/flagship-web/rsc-action/actions/server-request`
- `/flagship-web/rsc-action/actions/pagination`

Çerez ve csrf eklentiye ait değildir. Sayfa `JSESSIONID` içinden ne okuyorsa, yeniden oynatma da onu okur. İzin listesinin dışı tekrar gönderilmez. Rapora düşen örnekte csrf ve çerez karartılır.

Bu hızlı yol listeyi doldurursa tarama orada biter. Dolduramazsa — istek yakalanamadıysa ya da sayı ekrandaki başvuru çipine göre yarıda kaldıysa — eklenti eski usule döner. İskelet kaybolana kadar bekler, sayfayı sayfa sayfa okur. Sekmeyi kapatırsan hikâye de kapanır.

Her satır tek bir duruma iner. Öncelik bozulmaz:

1. **CV indirildi**
2. **Görüntülendi**
3. **Görüntülenmeden yeniden yayınlandı** — ilanın yayın tarihi başvurudan daha yeniyse. İkisi de “1 hafta önce” ise bu sayılmaz.
4. **Başvuru gönderildi fakat görüntülenmedi.**

“Başvurular kapandı” ayrı bir bayraktır. Gönderilip bakılmamış başvurunun cümlesini ezmez.

Sonuç `chrome.storage.local` içine yazılır. Evden çıkmaz. Sonra bir ilan açtığında firma adı A.Ş., Ltd, GmbH kuyruğundan arındırılıp bu kayıtla karşılaştırılır. Daha önce başvurduysan sağ altta sarı uyarı çıkar. Uyarıya basınca o firmanın ilanları, tarihleri ve durumları açılır.

Kısaca: veri gizlenmedi. Üç lehçeye bölünüp iskeletlerin arkasına kondu. Eklenti o lehçeleri sırayla dener, cümleyi ayıklar, gerisini senin bilgisayarında bırakır.

## Kurulum

Sürüm paketi: [v1.4.3](https://github.com/boracomet/linkedin-basvuru-takip/releases/tag/v1.4.3) içindeki `basvuru-istatistik-1.4.3.zip`.

1. Zip’i aç. İçinden `basvuru-istatistik-1.4.3` klasörü çıkar.
2. Chrome’da `chrome://extensions` adresini aç.
3. Geliştirici modunu aç.
4. “Paketlenmemiş öğe yükle” ile bu klasörü seç.
5. LinkedIn’de kendi hesabınla oturum aç. Eklenti simgesinden tarama aracını aç. **Başvuruldu** sayfasında değilsen eklenti seni oraya götürür.
6. Aralık seç, taramayı başlat, sekmeyi açık tut. Bitince sonuçlar tek ekranda açılır.

Kayıtlı sonuçlar aynı bilgisayarda durur. Yeni tarama, açık sonuç sayfasını da günceller.
