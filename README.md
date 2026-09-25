![Başvuru istatistik kapak görseli: LinkedIn ilan listesine büyüteçle bakılan bir sahne](assets/kapak.jpg)

# Başvuru istatistik

## Manifesto

Bu araç, LinkedIn’de **“Kolay Başvuru”** yöntemiyle yaptığınız iş başvurularının görüntülenip görüntülenmediğini ve başvurular sırasında CV’nizin indirilip indirilmediğini gerçek veriler üzerinden takip etmenizi sağlar.

**İş başvurularınızı takip edin, başvuru süreçlerinizi analiz edin ve tüm verilerinizi tek bir ekrandan kolayca görüntüleyin.**

Chrome tabanlı script ve eklenti olarak kullanılabilir.

Paylaşıldığı platform LinkedIn. Gönderi: [Son 1 yılda başvurduğum iş ilanları](https://www.linkedin.com/feed/update/urn:li:activity:7507938457974104065/). **300 bin gösterim**, **1.583 beğeni**.

## Teknik kaos özeti

LinkedIn, başvurularının listesini tek tuşla indirtecek bir yer sunmuyor. Ekranda sade bir liste görürsün. O listenin arkası ise dağınıktır. Eklenti, bu dağınıklığın içinden hâlâ okunabilen kısmı okur.

Okuduğu yer, LinkedIn’in senin **Başvuruldu** satırına yazdığı cümledir. Örneğin “Başvuru görüntülendi” ya da “CV indirildi”. İşe alım uzmanının kendi ekranını görmez. Bilgileri başka bir yere de göndermez.

### Sayfa neden dağınık

Liste, sayfayı aşağı indirdikçe parça parça gelir. Bazı satırlar önce boş gri kutudur. Yazı sonradan oturur. O boş kutuları saymaya kalkarsan eksik liste çıkarırsın.

Asıl liste çoğu zaman ekrana çizilmeden önce gelir. Tarayıcın, senin adına LinkedIn’e “başvurularımı getir” diye sorar. Cevap düz bir tablo değildir. “2. sayfa” diye bir düğme de her zaman durmaz. Cevabın içinde “10. kayıttan itibaren 20 tane daha” gibi gizli bir sayfa bilgisi vardır.

Bir kısmı daha da gariptir. Yazılar, ekranda kutu olmadan önce bir notun içinde durur. Sen daha satırı görmemişsindir. Not ise çoktan gelmiştir.

### Eklenti ne yapar

Sen LinkedIn’e zaten giriş yapmışsındır. Eklenti senden şifre istemez. Sayfa açılırken LinkedIn’in kendi sorusunu duyar ve aynı soruyu, senin açık oturumunla, yalnızca başvuru listesini getiren adreslerde bir kez daha sorar.

Bu hızlı yol listeyi doldurursa tarama biter. Dolduramazsa eklenti ekrandaki yazıyı okur. Gri kutular yazıya dönene kadar bekler, sonra bir sonraki sayfaya geçer. Bu sırada sekmeyi kapatırsan tarama da durur.

Her başvuru tek bir cümleye iner. Sıra şöyledir:

1. **CV indirildi.** CV’n indirildiyse bu yazılır.
2. **Görüntülendi.** Başvuruna bakıldıysa bu yazılır.
3. **Görüntülenmeden yeniden yayınlandı.** İlan, sen başvurduktan sonra yeniden paylaşılmışsa ve hâlâ bakılmamışsa bu yazılır. İkisi de “1 hafta önce” diyorsa sayılmaz. Yeniden yayın, başvurudan daha yeni olmalıdır.
4. **Başvuru gönderildi fakat görüntülenmedi.** Yukarıdakilerin hiçbiri yoksa bu yazılır.

İlan kapanmış olabilir. Bu ayrı bir nottur. Gönderilip bakılmamış bir başvuruda cümle yine “Başvuru gönderildi fakat görüntülenmedi.” kalır.

Sonuç yalnızca senin bilgisayarında durur. Daha sonra bir ilan açtığında eklenti firma adını bu kayıtla karşılaştırır. “A.Ş.”, “Ltd.” gibi ekler aynı firmayı gizlemesin diye ayıklanır. O firmaya daha önce başvurduysan sağ altta sarı bir uyarı çıkar. Uyarıya basınca ilanlar, tarihler ve durumlar açılır.

Kısaca LinkedIn listeyi tek parça vermiyor. Eklenti önce gizlice gelen cevabı okur. O yetmezse ekrandaki yazıyı sayfa sayfa okur. Sonucu senin bilgisayarında bırakır.

## Kurulum

Sürüm paketi: [v1.4.3](https://github.com/boracomet/linkedin-basvuru-takip/releases/tag/v1.4.3) içindeki `basvuru-istatistik-1.4.3.zip`.

1. Zip’i aç. İçinden `basvuru-istatistik-1.4.3` klasörü çıkar.
2. Chrome’da `chrome://extensions` adresini aç.
3. Geliştirici modunu aç.
4. “Paketlenmemiş öğe yükle” ile bu klasörü seç.
5. LinkedIn’de kendi hesabınla oturum aç. Eklenti simgesinden tarama aracını aç. **Başvuruldu** sayfasında değilsen eklenti seni oraya götürür.
6. Aralık seç, taramayı başlat, sekmeyi açık tut. Bitince sonuçlar tek ekranda açılır.

Kayıtlı sonuçlar aynı bilgisayarda durur. Yeni tarama, açık sonuç sayfasını da günceller.
