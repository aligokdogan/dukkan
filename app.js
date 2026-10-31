'use strict';

// ---------- Yardımcılar ----------

const $ = s => document.querySelector(s);
const icerik = $('#icerik');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = n => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n || 0);
const sayi = n => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(n || 0);
const tarihYaz = t => (t ? t.slice(0, 10).split('-').reverse().join('.') : '');
const bugun = () => new Date().toLocaleDateString('sv-SE');

function api(yol, secenek = {}) {
  return Yerel.api(yol, secenek);
}

// Dosyayı telefonun paylaş menüsüyle (WhatsApp, Drive, e-posta…) gönderir; olmazsa indirir.
async function dosyaVer(ad, icerik, tip) {
  const dosya = new File([icerik], ad, { type: tip });
  if (navigator.canShare && navigator.canShare({ files: [dosya] })) {
    try {
      await navigator.share({ files: [dosya], title: ad });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(dosya);
  a.download = ad;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

let bildirimZaman;
function bildir(mesaj, hata = false) {
  const b = $('#bildirim');
  b.textContent = mesaj;
  b.className = 'goster' + (hata ? ' hata' : '');
  clearTimeout(bildirimZaman);
  bildirimZaman = setTimeout(() => (b.className = ''), 2600);
}

function bakiyeYaz(b) {
  if (Math.abs(b) < 0.005) return '<span class="kucuk-yazi">0,00 ₺</span>';
  return b > 0
    ? `<span class="pozitif">${para(b)}</span> <span class="kucuk-yazi">bize borçlu</span>`
    : `<span class="negatif">${para(-b)}</span> <span class="kucuk-yazi">biz borçluyuz</span>`;
}

function stokRozet(u) {
  if (u.kritik > 0 && u.stok <= u.kritik) return '<span class="rozet kritik">KRİTİK</span>';
  if (u.kritik > 0 && u.stok <= u.kritik * 1.5) return '<span class="rozet yakin">Azalıyor</span>';
  return '';
}

// Basit form penceresi. alanlar: [{ad, etiket, tip, deger, secenekler, tam, gerekli}]
function formAc({ baslik, alanlar, kaydet, onayMetni = 'Kaydet', ek = '' }) {
  const p = $('#pencere');
  const f = $('#pencereForm');
  f.innerHTML = `<h2>${esc(baslik)}</h2><div class="form-izgara">${alanlar.map(alanHtml).join('')}</div>${ek}
    <div class="dugmeler"><button type="button" class="ikincil" data-iptal>Vazgeç</button><button type="submit">${esc(onayMetni)}</button></div>`;
  f.querySelector('[data-iptal]').onclick = () => p.close();
  f.onsubmit = async e => {
    e.preventDefault();
    const veri = {};
    for (const a of alanlar) {
      const el = f.elements[a.ad];
      if (!el) continue;
      veri[a.ad] = a.tip === 'onay' ? el.checked : el.value;
    }
    try {
      await kaydet(veri, f);
      p.close();
    } catch (err) {
      bildir(err.message, true);
    }
  };
  f.querySelectorAll('[data-barkod-oku]').forEach(b => (b.onclick = async () => {
    const kod = await barkodOku();
    if (kod) f.elements[b.dataset.barkodOku].value = kod;
  }));
  p.showModal();
  const ilk = f.querySelector('input:not([type=checkbox]), select, textarea');
  if (ilk && window.matchMedia('(min-width: 721px)').matches) ilk.focus();
  return f;
}

function alanHtml(a) {
  const sinif = a.tam ? ' class="tam"' : '';
  const ortak = `name="${a.ad}" ${a.gerekli ? 'required' : ''}`;
  if (a.tip === 'secim') {
    return `<label${sinif}>${esc(a.etiket)}<select ${ortak}>${a.secenekler.map(([d, e]) =>
      `<option value="${esc(d)}" ${String(d) === String(a.deger ?? '') ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>`;
  }
  if (a.tip === 'metin-alani') return `<label${sinif}>${esc(a.etiket)}<textarea ${ortak}>${esc(a.deger)}</textarea></label>`;
  if (a.tip === 'onay') return `<label class="yatay tam"><input type="checkbox" ${ortak} ${a.deger ? 'checked' : ''}>${esc(a.etiket)}</label>`;
  if (a.tip === 'barkod') {
    return `<label${sinif}>${esc(a.etiket)}<div class="barkod-satir"><input type="text" inputmode="numeric" ${ortak} value="${esc(a.deger)}" placeholder="Okutun veya yazın">
      <button type="button" class="ikincil" data-barkod-oku="${a.ad}">📷</button></div></label>`;
  }
  const tip = a.tip === 'sayi' ? 'text" inputmode="decimal' : a.tip || 'text';
  return `<label${sinif}>${esc(a.etiket)}<input type="${tip}" ${ortak} value="${esc(a.deger)}" ${a.ipucu ? `placeholder="${esc(a.ipucu)}"` : ''}></label>`;
}

function onayla(mesaj) {
  return window.confirm(mesaj);
}

// ---------- Telefon uygulaması (PWA) ----------

const uygulamaModu = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let kurulumIstegi = null;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  kurulumIstegi = e;
  if (!location.hash || location.hash === '#/') yonlendir();
});
window.addEventListener('appinstalled', () => { kurulumIstegi = null; bildir('Uygulama yüklendi ✓'); });

function kurulumKarti() {
  if (uygulamaModu || localStorage.getItem('kurulumGizle') === '1') return '';
  let govde;
  if (kurulumIstegi) {
    govde = `<p>Bu sistemi telefonunuza uygulama olarak yükleyin, ana ekrandan tek dokunuşla açılsın.</p>
      <button id="uygulamaYukle">📲 Uygulamayı yükle</button>`;
  } else if (iphone) {
    govde = `<p>iPhone'a uygulama olarak eklemek için Safari'de alttaki <b>Paylaş</b> düğmesine (kare ve yukarı ok) dokunun,
      sonra <b>Ana Ekrana Ekle</b>'yi seçin. Bildirimler için bu gerekli.</p>`;
  } else if (window.matchMedia('(max-width: 720px)').matches) {
    govde = `<p>Telefonunuza uygulama olarak eklemek için tarayıcı menüsünden (⋮) <b>Uygulamayı yükle</b> veya <b>Ana ekrana ekle</b>'yi seçin.</p>`;
  } else return '';
  return `<div class="kart" id="kurulumKarti"><div class="baslik-satir"><h2 style="margin:0">📱 Telefona yükle</h2>
    <button class="metin" id="kurulumKapat" style="color:var(--gri)">Kapat ✕</button></div>${govde}</div>`;
}

function kurulumKartiBagla() {
  const y = $('#uygulamaYukle');
  if (y) y.onclick = async () => {
    kurulumIstegi.prompt();
    await kurulumIstegi.userChoice;
    kurulumIstegi = null;
    $('#kurulumKarti')?.remove();
  };
  const k = $('#kurulumKapat');
  if (k) k.onclick = () => { localStorage.setItem('kurulumGizle', '1'); $('#kurulumKarti').remove(); };
}

const bildirimDestekli = 'Notification' in window && 'serviceWorker' in navigator;

async function bildirimIzniAl() {
  if (iphone && !uygulamaModu) throw new Error("iPhone'da önce Paylaş → Ana Ekrana Ekle ile uygulamayı yükleyip oradan açın.");
  if (!bildirimDestekli) throw new Error('Bu tarayıcı bildirimleri desteklemiyor.');
  const izin = await Notification.requestPermission();
  if (izin !== 'granted') throw new Error('Bildirim izni verilmedi. Telefon ayarlarından bu uygulamaya bildirim izni verin.');
  await telefonBildirimi('Bildirimler açık ✓', 'Bir ürün kritik seviyeye inince burada uyarı göreceksiniz.', '#/');
}

async function telefonBildirimi(baslik, metin, adres) {
  if (!bildirimDestekli || Notification.permission !== 'granted') return false;
  const kayit = await navigator.serviceWorker.ready;
  await kayit.showNotification(baslik, {
    body: metin, icon: 'ikon/ikon-192.png', badge: 'ikon/ikon-192.png', tag: 'kritik-stok', renotify: true,
    vibrate: [200, 100, 200], data: { url: adres },
  });
  return true;
}

function waAdresi(telefon, metin) {
  const no = String(telefon || '').replace(/\D/g, '').replace(/^0/, '90').replace(/^5/, '905');
  return `https://wa.me/${no}?text=${encodeURIComponent(metin)}`;
}


async function rozetGuncelle() {
  if (!('setAppBadge' in navigator)) return;
  const n = await Yerel.kritikSayisi();
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// Stok kritik seviyeye inince: telefon bildirimi + ekranda uyarı penceresi
Yerel.kritikUyariAyarla(async (urunler, metin) => {
  rozetGuncelle();
  const baslik = urunler.length === 1 ? `Kritik stok: ${urunler[0].ad}` : `Kritik stok: ${urunler.length} ürün`;
  const adres = urunler.length === 1 ? `#/urun/${urunler[0].id}` : '#/';
  await telefonBildirimi(baslik, metin.split('\n\n')[1] || metin, adres).catch(() => {});
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  const p = $('#pencere');
  // Başka bir pencere açıksa (ör. satış fişi) onu kapatma, kapanınca göster
  if (p.open) await new Promise(coz => p.addEventListener('close', () => setTimeout(coz, 50), { once: true }));
  const f = $('#pencereForm');
  f.innerHTML = `<h2 class="negatif">⚠️ ${esc(baslik)}</h2>
    <ul class="liste">${urunler.map(u => `<li><b>${esc(u.ad)}</b><span class="negatif"><b>${sayi(u.stok)}</b> ${esc(u.birim)} kaldı</span></li>`).join('')}</ul>
    <p class="kucuk-yazi">Kritik seviyeye indi. Sipariş vermeyi unutmayın.</p>
    <div class="dugmeler"><button type="button" class="ikincil" data-kapat>Tamam</button>
    <a class="dugme yesil" href="#/siparis" data-kapat2>🛒 Sipariş ver</a></div>`;
  f.onsubmit = e => e.preventDefault();
  f.querySelector('[data-kapat]').onclick = () => p.close();
  f.querySelector('[data-kapat2]').onclick = () => p.close();
  p.showModal();
});

// ---------- Yönlendirme ----------

const sayfalar = {
  '': ozetSayfasi,
  cariler: carilerSayfasi,
  cari: cariSayfasi,
  stok: stokSayfasi,
  urun: urunSayfasi,
  ayarlar: ayarlarSayfasi,
  siparis: siparisSayfasi,
  sayim: sayimSayfasi,
  satis: satisSayfasi,
  teklif: teklifSayfasi,
};

async function yonlendir() {
  const [, ad = '', id] = location.hash.replace(/^#/, '').split('/');
  const aktif = { '': 'ozet', cari: 'cariler', urun: 'stok', siparis: 'stok', sayim: 'stok', teklif: 'satis' }[ad] || ad;
  document.querySelectorAll('[data-sayfa]').forEach(a => a.classList.toggle('aktif', a.dataset.sayfa === aktif));
  try {
    await (sayfalar[ad] || ozetSayfasi)(id);
    window.scrollTo(0, 0);
  } catch (e) {
    icerik.innerHTML = `<div class="kart bos">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', yonlendir);

// ---------- Özet ----------

async function ozetSayfasi() {
  const o = await api('/ozet');
  $('#dukkanAdi').textContent = o.dukkan;
  document.title = o.dukkan;
  icerik.innerHTML = `${kurulumKarti()}${yedekHatirlatma(o.son_yedek, o.sayilar.cari + o.sayilar.urun > 0)}
    <div class="izgara">
      <div class="kutu"><div class="etiket">Bize borçlu olanlar</div><div class="deger pozitif">${para(o.alacak)}</div></div>
      <div class="kutu"><div class="etiket">Bizim borçlarımız</div><div class="deger negatif">${para(o.borc)}</div></div>
      <div class="kutu"><div class="etiket">Kritik stoktaki ürün</div><div class="deger ${o.kritik.length ? 'negatif' : ''}">${o.kritik.length}</div></div>
      <div class="kutu"><div class="etiket">Stok değeri (alış)</div><div class="deger">${para(o.sayilar.stok_degeri)}</div></div>
    </div>
    <div class="kart ${o.kritik.length ? 'uyari-kart' : ''}">
      <div class="baslik-satir"><h2>Kritik stok</h2>${o.kritik.length ? '<a class="dugme yesil kucuk" href="#/siparis">🛒 Sipariş ver</a>' : ''}</div>
      ${o.kritik.length ? `<ul class="liste">${o.kritik.map(u => `
        <li class="tikla" data-git="#/urun/${u.id}"><div><b>${esc(u.ad)}</b> <span class="kucuk-yazi">${esc(u.kod)}</span><br>
        <span class="kucuk-yazi">Kritik seviye: ${sayi(u.kritik)}</span></div>
        <div class="negatif"><b>${sayi(u.stok)}</b> ${esc(u.birim)}</div></li>`).join('')}</ul>`
        : '<div class="bos">Kritik seviyede ürün yok 👍</div>'}
    </div>
    <div class="iki-sutun">
      <div class="kart"><h2>Son cari hareketleri</h2>
        ${o.sonCari.length ? `<ul class="liste">${o.sonCari.map(h => `
          <li class="tikla" data-git="#/cari/${h.cari_id}"><div><b>${esc(h.cari_ad)}</b><br><span class="kucuk-yazi">${tarihYaz(h.tarih)} · ${esc(h.aciklama)}</span></div>
          <div class="${h.tip === 'borc' ? 'pozitif' : 'negatif'}">${h.tip === 'borc' ? '+' : '−'}${para(h.tutar)}</div></li>`).join('')}</ul>`
          : '<div class="bos">Henüz hareket yok</div>'}
      </div>
      <div class="kart"><h2>Son stok hareketleri</h2>
        ${o.sonStok.length ? `<ul class="liste">${o.sonStok.map(h => `
          <li class="tikla" data-git="#/urun/${h.urun_id}"><div><b>${esc(h.urun_ad)}</b><br><span class="kucuk-yazi">${tarihYaz(h.tarih)} · ${hareketAdi(h)}</span></div>
          <div>${miktarYaz(h)} ${esc(h.birim)}</div></li>`).join('')}</ul>`
          : '<div class="bos">Henüz hareket yok</div>'}
      </div>
    </div>`;
  tiklamaBagla();
  kurulumKartiBagla();
  rozetGuncelle();
  const hy = $('#hizliYedek');
  if (hy) hy.onclick = yedekAl;
}

async function yedekAl() {
  await dosyaVer(`dukkan-yedek-${bugun()}.json`, await Yerel.yedekMetni(), 'application/json');
  bildir('Yedek hazırlandı');
  if (!location.hash || location.hash === '#/') setTimeout(yonlendir, 800);
}

function csvBagla() {
  icerik.querySelectorAll('[data-csv]').forEach(a => (a.onclick = async e => {
    e.preventDefault();
    await dosyaVer(`${a.dataset.csv}-${bugun()}.csv`, await Yerel.csv(a.dataset.csv), 'text/csv');
  }));
}

function yedekHatirlatma(sonYedek, kayitVar) {
  if (!kayitVar) return '';
  const gun = sonYedek ? Math.floor((Date.now() - new Date(sonYedek.replace(' ', 'T'))) / 864e5) : null;
  if (gun !== null && gun < 7) return '';
  return `<div class="kart" style="border-left:4px solid var(--turuncu)"><b>💾 Yedek alın.</b>
    ${gun === null ? 'Henüz hiç yedek alınmadı.' : `Son yedek ${gun} gün önce.`}
    Veriler sadece bu telefonda duruyor; telefon kaybolursa ya da sıfırlanırsa yedeksiz geri gelmez.
    <div class="arac" style="margin:10px 0 0"><button class="ikincil" id="hizliYedek">Şimdi yedek al</button></div></div>`;
}

function tiklamaBagla() {
  icerik.querySelectorAll('[data-git]').forEach(el => (el.onclick = () => (location.hash = el.dataset.git)));
}

// ---------- Cariler ----------

async function carilerSayfasi() {
  icerik.innerHTML = `
    <div class="baslik-satir"><h1>Cariler</h1><button id="yeniCari">+ Yeni cari</button></div>
    <div class="arac">
      <input type="search" id="cariAra" placeholder="İsim veya telefon ara…">
      <select id="cariTur" style="width:auto"><option value="">Hepsi</option><option value="musteri">Müşteriler</option><option value="tedarikci">Tedarikçiler</option></select>
    </div>
    <div class="kart" id="cariListe"><div class="bos">Yükleniyor…</div></div>
    <p class="kucuk-yazi">Yeşil: bize borcu var. Kırmızı: bizim ona borcumuz var. <a href="#" data-csv="cariler">Excel'e aktar (CSV)</a></p>`;
  csvBagla();
  $('#yeniCari').onclick = () => cariFormu();
  let zaman;
  $('#cariAra').oninput = () => { clearTimeout(zaman); zaman = setTimeout(yukle, 200); };
  $('#cariTur').onchange = yukle;
  async function yukle() {
    const liste = await api(`/cariler?q=${encodeURIComponent($('#cariAra').value)}&tur=${$('#cariTur').value}`);
    const kutu = $('#cariListe');
    if (!kutu) return;
    kutu.innerHTML = liste.length ? `<table>
      <thead><tr><th>Ad</th><th class="masaustu">Telefon</th><th class="masaustu">Son işlem</th><th class="sag">Durum</th></tr></thead>
      <tbody>${liste.map(c => `<tr class="tikla" data-git="#/cari/${c.id}">
        <td><b>${esc(c.ad)}</b> ${c.tur === 'tedarikci' ? '<span class="rozet tedarikci">Tedarikçi</span>' : ''}</td>
        <td class="masaustu">${esc(c.telefon)}</td><td class="masaustu">${tarihYaz(c.son_islem)}</td>
        <td class="sag">${bakiyeYaz(c.bakiye)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="bos">Kayıt yok. "+ Yeni cari" ile ekleyin.</div>';
    tiklamaBagla();
  }
  await yukle();
}

function cariFormu(c) {
  const yeni = !c;
  c = c || { tur: 'musteri' };
  formAc({
    baslik: yeni ? 'Yeni cari' : 'Cariyi düzenle',
    alanlar: [
      { ad: 'ad', etiket: 'Ad / Firma', deger: c.ad, gerekli: true, tam: true },
      { ad: 'tur', etiket: 'Tür', tip: 'secim', deger: c.tur, secenekler: [['musteri', 'Müşteri'], ['tedarikci', 'Tedarikçi']] },
      { ad: 'telefon', etiket: 'Telefon', tip: 'tel', deger: c.telefon },
      { ad: 'email', etiket: 'E-posta', tip: 'email', deger: c.email },
      { ad: 'vergi_no', etiket: 'Vergi / TC No', deger: c.vergi_no },
      { ad: 'adres', etiket: 'Adres', tip: 'metin-alani', deger: c.adres, tam: true },
      { ad: 'notlar', etiket: 'Not', tip: 'metin-alani', deger: c.notlar, tam: true },
      ...(yeni ? [
        { ad: 'acilis_bakiye', etiket: 'Eskiden kalan borç (₺)', tip: 'sayi', ipucu: 'Yoksa boş bırakın' },
        { ad: 'acilis_yon', etiket: 'Kimin borcu?', tip: 'secim', deger: c.tur === 'tedarikci' ? 'biz' : 'o', secenekler: [['o', 'O bize borçlu'], ['biz', 'Biz ona borçluyuz']] },
      ] : []),
    ],
    kaydet: async v => {
      if (yeni) {
        const tutar = Math.abs(Number(String(v.acilis_bakiye || 0).replace(',', '.')) || 0);
        v.acilis_bakiye = v.acilis_yon === 'biz' ? -tutar : tutar;
        const r = await api('/cariler', { method: 'POST', body: v });
        bildir('Cari eklendi');
        location.hash = '#/cari/' + r.id;
      } else {
        await api('/cariler/' + c.id, { method: 'PUT', body: v });
        bildir('Kaydedildi');
        yonlendir();
      }
    },
  });
}

async function cariSayfasi(id) {
  const { cari: c, hareketler } = await api('/cariler/' + id);
  const tedarikci = c.tur === 'tedarikci';
  // Muhasebe dili yerine dükkanda konuşulan dil
  const islemAdi = tip => tedarikci
    ? (tip === 'alacak' ? 'Mal aldık' : 'Ödeme yaptık')
    : (tip === 'borc' ? 'Veresiye' : 'Para aldık');
  const eskiKayit = h => /^(Açılış bakiyesi|Eskiden kalan)/.test(h.aciklama || '');
  const durumYazi = b => Math.abs(b) < 0.005
    ? '<span class="kucuk-yazi">Hesap kapalı, kimsenin borcu yok</span>'
    : b > 0
      ? `Bize borcu: <b class="pozitif">${para(b)}</b>`
      : `Bizim ona borcumuz: <b class="negatif">${para(-b)}</b>`;
  icerik.innerHTML = `
    <p><a href="#/cariler">← Cariler</a></p>
    <div class="kart">
      <div class="baslik-satir"><h1 style="margin:0">${esc(c.ad)} ${c.tur === 'tedarikci' ? '<span class="rozet tedarikci">Tedarikçi</span>' : ''}</h1>
        <button class="ikincil kucuk" id="duzenle">Düzenle</button></div>
      <p class="kucuk-yazi">${[c.telefon && `<a href="tel:${esc(c.telefon)}">${esc(c.telefon)}</a>`, esc(c.email), esc(c.adres)].filter(Boolean).join(' · ')}</p>
      ${c.notlar ? `<p>${esc(c.notlar)}</p>` : ''}
      <div style="font-size:22px;margin:8px 0">${durumYazi(c.bakiye)}</div>
      <div class="arac">${tedarikci
        ? `<button class="yesil" id="alacakEkle">📦 Mal aldım (veresiye)</button><button id="borcEkle">💵 Ödeme yaptım</button>
           <a class="dugme ikincil" href="#/siparis/${c.id}">🛒 Sipariş ver</a>`
        : '<button class="yesil" id="borcEkle">📝 Veresiye yaz</button><button id="alacakEkle">💵 Para aldım</button>'}
      </div>
    </div>
    <div class="kart"><h2>Hesap geçmişi</h2>
      ${hareketler.length ? `<table><thead><tr><th>Tarih</th><th>İşlem</th><th class="sag">Tutar</th><th class="sag masaustu">Sonra kalan</th><th></th></tr></thead>
      <tbody>${hareketler.map(h => `<tr><td>${tarihYaz(h.tarih)}</td><td>${eskiKayit(h) ? 'Eskiden kalan borç' : islemAdi(h.tip)}${h.aciklama && !eskiKayit(h) ? `<br><span class="kucuk-yazi">${esc(h.aciklama)}</span>` : ''}</td>
        <td class="sag ${h.tip === 'borc' ? 'pozitif' : 'negatif'}">${para(h.tutar)}</td>
        <td class="sag masaustu">${bakiyeYaz(h.bakiye)}</td>
        <td class="sag"><button class="metin" data-sil="${h.id}" title="Sil">✕</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="bos">Henüz hareket yok</div>'}
    </div>
    <p><button class="metin" id="cariSil">Bu cariyi sil</button></p>`;

  $('#duzenle').onclick = () => cariFormu(c);
  const hareketFormu = tip => formAc({
    baslik: `${c.ad} - ${islemAdi(tip)}`,
    alanlar: [
      { ad: 'tutar', etiket: tedarikci
        ? (tip === 'alacak' ? 'Aldığımız malın tutarı (₺)' : 'Ödediğimiz tutar (₺)')
        : (tip === 'borc' ? 'Veresiye tutarı (₺)' : 'Aldığımız para (₺)'), tip: 'sayi', gerekli: true },
      { ad: 'tarih', etiket: 'Tarih', tip: 'date', deger: bugun() },
      { ad: 'aciklama', etiket: 'Açıklama', tam: true, ipucu: (tip === 'borc') !== tedarikci ? 'Örn: Fren balatası, fatura no…' : 'Örn: Nakit, havale…' },
    ],
    kaydet: async v => {
      await api(`/cariler/${c.id}/hareket`, { method: 'POST', body: { ...v, tip } });
      bildir('Kaydedildi');
      yonlendir();
    },
  });
  $('#borcEkle').onclick = () => hareketFormu('borc');
  $('#alacakEkle').onclick = () => hareketFormu('alacak');
  icerik.querySelectorAll('[data-sil]').forEach(b => (b.onclick = async () => {
    if (!onayla('Bu hareket silinsin mi?')) return;
    await api('/cari-hareket/' + b.dataset.sil, { method: 'DELETE' });
    bildir('Silindi');
    yonlendir();
  }));
  $('#cariSil').onclick = async () => {
    if (!onayla(`${c.ad} ve tüm hareketleri silinsin mi? Bu geri alınamaz.`)) return;
    await api('/cariler/' + c.id, { method: 'DELETE' });
    location.hash = '#/cariler';
  };
}

// ---------- Stok ----------

async function stokSayfasi() {
  const sadeceKritik = sessionStorage.getItem('sadeceKritik') === '1';
  icerik.innerHTML = `
    <div class="baslik-satir"><h1>Stok</h1><button id="yeniUrun">+ Yeni ürün</button></div>
    <div class="arac"><button class="ikincil" id="barkodBul">📷 Barkodla bul</button><a class="dugme ikincil" href="#/sayim">🔢 Sayım yap</a><a class="dugme ikincil" href="#/siparis">🛒 Sipariş</a></div>
    <div class="arac">
      <input type="search" id="urunAra" placeholder="Ürün adı, kod, marka veya raf ara…">
      <label class="yatay" style="margin:0"><input type="checkbox" id="kritikFiltre" ${sadeceKritik ? 'checked' : ''}> Sadece kritik</label>
    </div>
    <div class="kart" id="urunListe"><div class="bos">Yükleniyor…</div></div>
    <p class="kucuk-yazi"><a href="#" data-csv="urunler">Excel'e aktar (CSV)</a></p>`;
  csvBagla();
  $('#yeniUrun').onclick = () => urunFormu();
  $('#barkodBul').onclick = async () => {
    const kod = await barkodOku();
    if (!kod) return;
    const { urun } = await api('/barkod/' + encodeURIComponent(kod));
    if (urun) location.hash = '#/urun/' + urun.id;
    else bilinmeyenBarkod(kod, id => (location.hash = '#/urun/' + id));
  };
  let zaman;
  $('#urunAra').oninput = () => { clearTimeout(zaman); zaman = setTimeout(yukle, 200); };
  $('#kritikFiltre').onchange = e => { sessionStorage.setItem('sadeceKritik', e.target.checked ? '1' : '0'); yukle(); };
  async function yukle() {
    const liste = await api(`/urunler?q=${encodeURIComponent($('#urunAra').value)}&kritik=${$('#kritikFiltre').checked ? 1 : 0}`);
    const kutu = $('#urunListe');
    if (!kutu) return;
    kutu.innerHTML = liste.length ? `<table>
      <thead><tr><th>Ürün</th><th class="masaustu">Marka</th><th class="masaustu">Raf</th><th class="sag masaustu">Satış</th><th class="sag">Stok</th></tr></thead>
      <tbody>${liste.map(u => `<tr class="tikla" data-git="#/urun/${u.id}">
        <td><b>${esc(u.ad)}</b> ${stokRozet(u)}<br><span class="kucuk-yazi">${esc(u.kod)}</span></td>
        <td class="masaustu">${esc(u.marka)}</td><td class="masaustu">${esc(u.raf)}</td>
        <td class="sag masaustu">${para(u.satis_fiyat)}</td>
        <td class="sag ${u.kritik > 0 && u.stok <= u.kritik ? 'negatif' : ''}"><b>${sayi(u.stok)}</b> <span class="kucuk-yazi">${esc(u.birim)}</span></td></tr>`).join('')}</tbody></table>`
      : '<div class="bos">Ürün yok. "+ Yeni ürün" ile ekleyin.</div>';
    tiklamaBagla();
  }
  await yukle();
}

function urunFormu(u, { barkod = '', sonra } = {}) {
  const yeni = !u;
  u = u || { birim: 'Adet', barkod };
  formAc({
    baslik: yeni ? 'Yeni ürün' : 'Ürünü düzenle',
    alanlar: [
      { ad: 'ad', etiket: 'Ürün adı', deger: u.ad, gerekli: true, tam: true },
      { ad: 'barkod', etiket: 'Barkod', tip: 'barkod', deger: u.barkod, tam: true },
      { ad: 'kod', etiket: 'Ürün / OEM kodu', deger: u.kod },
      { ad: 'marka', etiket: 'Marka', deger: u.marka },
      { ad: 'raf', etiket: 'Raf / Yer', deger: u.raf },
      { ad: 'birim', etiket: 'Birim', tip: 'secim', deger: u.birim, secenekler: ['Adet', 'Takım', 'Litre', 'Kg', 'Metre', 'Kutu'].map(b => [b, b]) },
      ...(yeni ? [{ ad: 'stok', etiket: 'Mevcut stok', tip: 'sayi', ipucu: '0' }] : []),
      { ad: 'kritik', etiket: 'Kritik stok seviyesi', tip: 'sayi', deger: u.kritik || '', ipucu: 'Bu sayıya inince uyarı gelir' },
      { ad: 'alis_fiyat', etiket: 'Alış fiyatı (₺)', tip: 'sayi', deger: u.alis_fiyat || '' },
      { ad: 'satis_fiyat', etiket: 'Satış fiyatı (₺)', tip: 'sayi', deger: u.satis_fiyat || '' },
    ],
    kaydet: async v => {
      if (yeni) {
        const r = await api('/urunler', { method: 'POST', body: v });
        bildir('Ürün eklendi');
        if (sonra) sonra(r.id); else location.hash = '#/urun/' + r.id;
      } else {
        await api('/urunler/' + u.id, { method: 'PUT', body: v });
        bildir('Kaydedildi');
        yonlendir();
      }
    },
  });
}

function hareketAdi(h) {
  return { giris: 'Giriş', cikis: 'Çıkış', sayim: 'Sayım' }[h.tip] + (h.aciklama ? ' · ' + esc(h.aciklama) : '');
}
function miktarYaz(h) {
  const m = h.tip === 'cikis' ? -h.miktar : h.miktar;
  return `<b class="${m < 0 ? 'negatif' : 'pozitif'}">${m > 0 ? '+' : m < 0 ? '−' : ''}${sayi(Math.abs(m))}</b>`;
}

async function urunSayfasi(id) {
  const [{ urun: u, hareketler }, cariler] = await Promise.all([api('/urunler/' + id), api('/cariler')]);
  const kritik = u.kritik > 0 && u.stok <= u.kritik;
  icerik.innerHTML = `
    <p><a href="#/stok">← Stok</a></p>
    <div class="kart ${kritik ? 'uyari-kart' : ''}">
      <div class="baslik-satir"><h1 style="margin:0">${esc(u.ad)} ${stokRozet(u)}</h1><button class="ikincil kucuk" id="duzenle">Düzenle</button></div>
      <p class="kucuk-yazi">${[u.kod && 'Kod: ' + esc(u.kod), u.barkod && 'Barkod: ' + esc(u.barkod), u.marka && esc(u.marka), u.raf && 'Raf: ' + esc(u.raf)].filter(Boolean).join(' · ')}</p>
      <div class="izgara">
        <div class="kutu"><div class="etiket">Stok</div><div class="deger ${kritik ? 'negatif' : ''}">${sayi(u.stok)} ${esc(u.birim)}</div></div>
        <div class="kutu"><div class="etiket">Kritik seviye</div><div class="deger">${u.kritik ? sayi(u.kritik) : '—'}</div></div>
        <div class="kutu"><div class="etiket">Alış</div><div class="deger">${para(u.alis_fiyat)}</div></div>
        <div class="kutu"><div class="etiket">Satış</div><div class="deger">${para(u.satis_fiyat)}</div></div>
      </div>
      <div class="arac">
        <button class="yesil" id="giris">+ Stok girişi (alış)</button>
        <button id="cikis">− Stok çıkışı (satış)</button>
        <button class="ikincil" id="sayim">Sayım düzelt</button>
      </div>
    </div>
    <div class="kart"><h2>Hareketler</h2>
      ${hareketler.length ? `<table><thead><tr><th>Tarih</th><th>İşlem</th><th class="masaustu">Cari</th><th class="sag">Miktar</th><th></th></tr></thead>
      <tbody>${hareketler.map(h => `<tr><td>${tarihYaz(h.tarih)}</td><td>${hareketAdi(h)}</td><td class="masaustu">${esc(h.cari_ad)}</td>
        <td class="sag">${miktarYaz(h)}</td><td class="sag"><button class="metin" data-sil="${h.id}" title="Sil">✕</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="bos">Henüz hareket yok</div>'}
    </div>
    <p><button class="metin" id="urunSil">Bu ürünü sil</button></p>`;

  $('#duzenle').onclick = () => urunFormu(u);
  const cariSecenek = tur => [['', '— Cari seçme —'], ...cariler
    .filter(c => !tur || c.tur === tur).concat(cariler.filter(c => tur && c.tur !== tur))
    .map(c => [c.id, c.ad + (c.tur === 'tedarikci' ? ' (tedarikçi)' : '')])];
  const hareketFormu = tip => formAc({
    baslik: { giris: 'Stok girişi', cikis: 'Stok çıkışı', sayim: 'Sayım düzeltmesi' }[tip] + ' - ' + u.ad,
    alanlar: tip === 'sayim' ? [
      { ad: 'miktar', etiket: `Sayılan miktar (şu an sistemde ${sayi(u.stok)})`, tip: 'sayi', gerekli: true, tam: true },
      { ad: 'tarih', etiket: 'Tarih', tip: 'date', deger: bugun() },
      { ad: 'aciklama', etiket: 'Açıklama', ipucu: 'Örn: Yıl sonu sayımı' },
    ] : [
      { ad: 'miktar', etiket: `Miktar (${u.birim})`, tip: 'sayi', gerekli: true },
      { ad: 'birim_fiyat', etiket: 'Birim fiyat (₺)', tip: 'sayi', deger: (tip === 'giris' ? u.alis_fiyat : u.satis_fiyat) || '' },
      { ad: 'cari_id', etiket: tip === 'giris' ? 'Tedarikçi' : 'Müşteri', tip: 'secim', secenekler: cariSecenek(tip === 'giris' ? 'tedarikci' : 'musteri'), tam: true },
      { ad: 'cariye_yaz', etiket: tip === 'giris' ? 'Tutarı tedarikçinin hesabına yaz (borcumuz olarak)' : 'Tutarı müşterinin hesabına yaz (veresiye)', tip: 'onay', deger: true },
      { ad: 'tarih', etiket: 'Tarih', tip: 'date', deger: bugun() },
      { ad: 'aciklama', etiket: 'Açıklama', ipucu: 'Örn: Fatura no' },
    ],
    kaydet: async v => {
      await api(`/urunler/${u.id}/hareket`, { method: 'POST', body: { ...v, tip } });
      bildir('Kaydedildi');
      yonlendir();
    },
  });
  $('#giris').onclick = () => hareketFormu('giris');
  $('#cikis').onclick = () => hareketFormu('cikis');
  $('#sayim').onclick = () => hareketFormu('sayim');
  icerik.querySelectorAll('[data-sil]').forEach(b => (b.onclick = async () => {
    if (!onayla('Bu hareket silinsin mi? Stok miktarı ve varsa cari kaydı geri alınır.')) return;
    await api('/stok-hareket/' + b.dataset.sil, { method: 'DELETE' });
    bildir('Silindi');
    yonlendir();
  }));
  $('#urunSil').onclick = async () => {
    if (!onayla(`${u.ad} ve tüm hareketleri silinsin mi? Bu geri alınamaz.`)) return;
    await api('/urunler/' + u.id, { method: 'DELETE' });
    location.hash = '#/stok';
  };
}

// ---------- Barkod okuyucu ----------

let zxingYukleniyor = null;
function zxingYukle() {
  if (window.ZXing) return Promise.resolve();
  zxingYukleniyor = zxingYukleniyor || new Promise((coz, reddet) => {
    const sc = document.createElement('script');
    sc.src = 'lib/zxing.min.js';
    sc.onload = coz;
    sc.onerror = () => { zxingYukleniyor = null; reddet(new Error('Barkod okuyucu yüklenemedi')); };
    document.head.appendChild(sc);
  });
  return zxingYukleniyor;
}

function bip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    o.frequency.value = 1800;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
    o.onended = () => ctx.close();
  } catch { /* ses çalınamazsa önemli değil */ }
  if (navigator.vibrate) navigator.vibrate(60);
}

// Kamerayı açar. Her okunan barkod için onKod(kod) çağrılır; onKod false dönerse tarayıcı kapanır.
// Döndürülen kapat() ile dışarıdan kapatılabilir.
async function barkodTarayici({ baslik = 'Barkodu okutun', onKod, onKapat }) {
  const d = $('#tarayici');
  const video = $('#tarayiciVideo');
  $('#tarayiciBaslik').textContent = baslik;
  $('#tarayiciKod').placeholder = 'Okumuyorsa barkodu / kodu yazın';
  const son = $('#tarayiciSon');
  son.textContent = 'Kamera açılıyor…';
  son.className = 'tarayici-son';
  let durdur = () => {};
  let kapandi = false;
  let sonKod = '', sonZaman = 0;

  const kapat = () => {
    if (kapandi) return;
    kapandi = true;
    durdur();
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    if (d.open) d.close();
    if (onKapat) onKapat();
  };
  const yakala = async kod => {
    kod = String(kod).trim();
    if (!kod || kapandi) return;
    // Aynı barkod kamerada dururken art arda sayılmasın: tekrar sayılması için
    // barkodun en az 2 saniye görüntüden çıkması gerekir
    const simdi = Date.now();
    const ayni = kod === sonKod && simdi - sonZaman < 2000;
    sonKod = kod;
    sonZaman = simdi;
    if (ayni) return;
    bip();
    if ((await onKod(kod, son)) === false) kapat();
  };

  $('#tarayiciKapat').onclick = kapat;
  d.oncancel = e => { e.preventDefault(); kapat(); };
  $('#tarayiciElle').onsubmit = e => {
    e.preventDefault();
    const g = $('#tarayiciKod');
    const kod = g.value;
    g.value = '';
    sonKod = '';
    yakala(kod);
  };
  d.showModal();

  const kamera = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Bu cihazda kamera kullanılamıyor');
    if ('BarcodeDetector' in window) {
      // Android Chrome'un kendi okuyucusu: hızlı ve ek dosya gerektirmez
      const akis = await navigator.mediaDevices.getUserMedia(kamera);
      if (kapandi) { akis.getTracks().forEach(t => t.stop()); return kapat; }
      video.srcObject = akis;
      await video.play().catch(() => {});
      son.textContent = '';
      const dedektor = new BarcodeDetector();
      let calis = true;
      durdur = () => (calis = false);
      const dongu = async () => {
        if (!calis) return;
        try {
          const bulunan = await dedektor.detect(video);
          if (bulunan.length) await yakala(bulunan[0].rawValue);
        } catch { /* kare hazır değil */ }
        if (calis) setTimeout(dongu, 120);
      };
      dongu();
    } else {
      // iPhone ve diğerleri: ZXing kütüphanesi (uygulamayla birlikte gelir, internetsiz çalışır)
      await zxingYukle();
      if (kapandi) return kapat;
      const ipucu = new Map();
      const B = ZXing.BarcodeFormat;
      // Hem çizgili barkodlar hem QR kod. TRY_HARDER kullanılmıyor: canlı görüntüde okumayı engelliyor
      ipucu.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [B.EAN_13, B.EAN_8, B.UPC_A, B.UPC_E, B.CODE_128, B.CODE_39, B.ITF, B.QR_CODE, B.DATA_MATRIX]);
      const okuyucu = new ZXing.BrowserMultiFormatReader(ipucu, 150);
      durdur = () => okuyucu.reset();
      await okuyucu.decodeFromConstraints(kamera, video, sonuc => { if (sonuc) yakala(sonuc.getText()); });
      if (kapandi) okuyucu.reset();
      else son.textContent = '';
    }
  } catch (e) {
    son.className = 'tarayici-son kotu';
    son.textContent = e.name === 'NotAllowedError'
      ? 'Kamera izni verilmedi. Telefon Ayarları → Safari (veya uygulama) → Kamera iznini açın. Barkodu aşağıya da yazabilirsiniz.'
      : (e.message || 'Kamera açılamadı') + '. Barkodu aşağıya yazabilirsiniz.';
  }
  return kapat;
}

// Tek barkod okuyup döner (iptal edilirse null)
function barkodOku(baslik) {
  return new Promise(coz => {
    let sonuc = null;
    barkodTarayici({ baslik, onKod: kod => { sonuc = kod; return false; }, onKapat: () => coz(sonuc) });
  });
}

// Kayıtlı olmayan barkod: yeni ürün aç ya da mevcut ürüne bağla
async function bilinmeyenBarkod(kod, sonra) {
  const urunler = await api('/urunler');
  const p = $('#pencere');
  const f = $('#pencereForm');
  f.innerHTML = `<h2>Bu barkod kayıtlı değil</h2>
    <p><b>${esc(kod)}</b></p>
    <div class="arac" style="flex-direction:column;align-items:stretch">
      <button type="button" id="bbYeni">+ Yeni ürün olarak ekle</button>
      <label style="margin:8px 0 0">veya mevcut bir ürüne bağla
        <select id="bbSec"><option value="">— Ürün seçin —</option>${urunler.filter(u => !u.barkod).map(u =>
          `<option value="${u.id}">${esc(u.ad)}${u.kod ? ' (' + esc(u.kod) + ')' : ''}</option>`).join('')}</select></label>
      <button type="button" class="ikincil" id="bbBagla">Seçili ürüne bağla</button>
    </div>
    <div class="dugmeler"><button type="button" class="ikincil" data-iptal>Vazgeç</button></div>`;
  f.onsubmit = e => e.preventDefault();
  f.querySelector('[data-iptal]').onclick = () => p.close();
  $('#bbYeni').onclick = () => { p.close(); urunFormu(null, { barkod: kod, sonra }); };
  $('#bbBagla').onclick = async () => {
    const id = $('#bbSec').value;
    if (!id) return bildir('Önce bir ürün seçin', true);
    try {
      await api(`/urunler/${id}/barkod`, { method: 'PUT', body: { barkod: kod } });
      p.close();
      bildir('Barkod ürüne bağlandı');
      sonra(Number(id));
    } catch (err) { bildir(err.message, true); }
  };
  p.showModal();
}

// ---------- Barkodlu sayım ----------
// Sayım yarıda kalsa da kaybolmasın diye telefonda saklanır.

const sayimOku = () => JSON.parse(localStorage.getItem('sayim') || 'null');
const sayimYaz = v => (v ? localStorage.setItem('sayim', JSON.stringify(v)) : localStorage.removeItem('sayim'));

async function sayimSayfasi() {
  const urunler = await api('/urunler');
  const urunHarita = new Map(urunler.map(u => [u.id, u]));
  let oturum = sayimOku();

  if (!oturum) {
    icerik.innerHTML = `
      <p><a href="#/stok">← Stok</a></p>
      <h1>Stok sayımı</h1>
      <div class="kart">
        <p>Raftaki ürünlerin barkodunu tek tek okutun. Her okutuşta o ürün 1 artar; adetleri sonra elle de düzeltebilirsiniz.
        Bitirince sayılan ürünlerin stoğu sayılan miktara güncellenir. Sayılmayan ürünlere dokunulmaz.</p>
        <p class="kucuk-yazi">Sayımı yarıda bırakabilirsiniz, kaldığınız yerden devam edersiniz.</p>
        <button id="sayimBasla" style="width:100%">🔢 Sayıma başla</button>
      </div>`;
    $('#sayimBasla').onclick = () => {
      sayimYaz({ baslangic: new Date().toLocaleString('tr-TR'), sayilar: {} });
      yonlendir();
    };
    return;
  }

  const sayilanlar = () => Object.entries(oturum.sayilar).map(([id, n]) => ({ u: urunHarita.get(Number(id)), n })).filter(x => x.u);
  const kaydet = () => sayimYaz(oturum);
  const ekle = (id, n = 1) => {
    oturum.sayilar[id] = Math.round(((oturum.sayilar[id] || 0) + n) * 1000) / 1000;
    kaydet();
  };

  function ciz() {
    const liste = sayilanlar();
    const farkli = liste.filter(x => x.n !== x.u.stok).length;
    icerik.innerHTML = `
      <p><a href="#/stok">← Stok</a></p>
      <div class="baslik-satir"><h1>Stok sayımı</h1><span class="kucuk-yazi">Başlangıç: ${esc(oturum.baslangic)}</span></div>
      <div class="kart">
        <button class="yesil" id="okutmaya" style="width:100%;font-size:18px;padding:14px">📷 Barkod okut</button>
        <div class="arac" style="margin:10px 0 0">
          <input type="search" id="sayimAra" placeholder="Barkodsuz ürün ekle: ad veya kod yazın" list="sayimUrunler">
          <datalist id="sayimUrunler">${urunler.map(u => `<option value="${esc(u.ad)}">`).join('')}</datalist>
          <button class="ikincil" id="sayimEkle">Ekle</button>
        </div>
      </div>
      <div class="kart"><h2>Sayılanlar <span class="kucuk-yazi">(${liste.length} ürün, ${farkli} farklı)</span></h2>
        ${liste.length ? `<ul class="liste">${liste.map(({ u, n }) => {
          const fark = Math.round((n - u.stok) * 1000) / 1000;
          return `<li><div style="flex:1"><b>${esc(u.ad)}</b><br><span class="kucuk-yazi">Sistemde: ${sayi(u.stok)} ${esc(u.birim)}
            ${fark ? `· <span class="${fark > 0 ? 'pozitif' : 'negatif'}">fark ${fark > 0 ? '+' : '−'}${sayi(Math.abs(fark))}</span>` : '· <span class="pozitif">tutuyor ✓</span>'}</span></div>
            <input class="sayim-adet" inputmode="decimal" data-adet="${u.id}" value="${n}">
            <button class="metin" data-cikar="${u.id}" title="Listeden çıkar">✕</button></li>`;
        }).join('')}</ul>` : '<div class="bos">Henüz ürün okutulmadı</div>'}
      </div>
      <div class="arac">
        <button id="sayimBitir" ${liste.length ? '' : 'disabled style="opacity:.5"'}>✓ Sayımı bitir, stokları güncelle</button>
        <button class="metin" id="sayimIptal">Sayımı iptal et</button>
      </div>`;

    $('#okutmaya').onclick = surekliOkut;
    $('#sayimEkle').onclick = () => {
      const ara = aramaMetni($('#sayimAra').value);
      if (!ara) return;
      const u = urunler.find(x => aramaMetni(x.ad) === ara) || urunler.find(x => aramaMetni(x.ad + ' ' + x.kod).includes(ara));
      if (!u) return bildir('Ürün bulunamadı', true);
      ekle(u.id);
      ciz();
    };
    icerik.querySelectorAll('[data-adet]').forEach(g => (g.onchange = () => {
      const n = Number(g.value.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return bildir('Geçersiz adet', true);
      oturum.sayilar[g.dataset.adet] = n;
      kaydet();
      ciz();
    }));
    icerik.querySelectorAll('[data-cikar]').forEach(b => (b.onclick = () => {
      delete oturum.sayilar[b.dataset.cikar];
      kaydet();
      ciz();
    }));
    $('#sayimIptal').onclick = () => {
      if (!onayla('Sayım iptal edilsin mi? Okutulanlar silinir, stoklar değişmez.')) return;
      sayimYaz(null);
      location.hash = '#/stok';
    };
    $('#sayimBitir').onclick = async () => {
      const degisen = sayilanlar().filter(x => x.n !== x.u.stok);
      if (!onayla(`${sayilanlar().length} ürün sayıldı, ${degisen.length} üründe stok değişecek. Onaylıyor musunuz?`)) return;
      for (const { u, n } of degisen) {
        await api(`/urunler/${u.id}/hareket`, { method: 'POST', body: { tip: 'sayim', miktar: n, aciklama: 'Barkodlu sayım' } });
      }
      sayimYaz(null);
      bildir(`Sayım kaydedildi, ${degisen.length} ürünün stoğu güncellendi`);
      location.hash = '#/stok';
    };
  }

  async function surekliOkut() {
    let bekleyen = null;
    await barkodTarayici({
      baslik: 'Sayım: ürünleri okutun',
      onKod: async (kod, son) => {
        const u = urunler.find(x => x.barkod === kod);
        if (!u) {
          bekleyen = kod;
          return false;
        }
        ekle(u.id);
        son.className = 'tarayici-son iyi';
        son.textContent = `✓ ${u.ad}: ${sayi(oturum.sayilar[u.id])} ${u.birim}`;
      },
      onKapat: async () => {
        ciz();
        if (bekleyen) {
          bildir('Bu barkod kayıtlı değil', true);
          bilinmeyenBarkod(bekleyen, async id => {
            const { urun } = await api('/urunler/' + id);
            const mevcut = urunler.find(x => x.id === id);
            if (mevcut) Object.assign(mevcut, urun); else urunler.push(urun);
            urunHarita.set(id, mevcut || urun);
            ekle(id);
            ciz();
          });
        }
      },
    });
  }

  ciz();
}

// ---------- Tedarikçiye sipariş ----------

async function siparisSayfasi(cariId) {
  const [{ urunler, tedarikciler, dukkan }, ayar] = await Promise.all([api('/siparis'), api('/ayarlar')]);
  pdfHazirla().catch(() => {});
  if (!tedarikciler.length) {
    icerik.innerHTML = `<h1>Sipariş</h1><div class="kart bos">Önce Cariler'den bir tedarikçi ekleyin (türü "Tedarikçi" olsun, telefonu yazılı olsun).</div>`;
    return;
  }
  const secili = Number(cariId) || tedarikciler[0].id;
  const oneri = u => Math.max(1, Math.ceil(u.kritik * 2 - u.stok));
  icerik.innerHTML = `
    <p><a href="#/stok">← Stok</a></p>
    <h1>Tedarikçiye sipariş</h1>
    <div class="kart">
      <label>Tedarikçi<select id="sTedarikci">${tedarikciler.map(t =>
        `<option value="${t.id}" ${t.id === secili ? 'selected' : ''}>${esc(t.ad)}${t.telefon ? '' : ' (telefon yok)'}</option>`).join('')}</select></label>
      <div class="arac" style="margin:0"><input type="search" id="sAra" placeholder="Ürün ara…"><button class="ikincil" id="sBarkod">📷 Barkod</button></div>
    </div>
    <div class="kart"><h2>Ürünler <span class="kucuk-yazi" id="sSayac"></span></h2>
      <p class="kucuk-yazi">Kritik seviyedekiler işaretli gelir. Adetleri değiştirebilirsiniz.</p>
      <ul class="liste" id="sListe"></ul>
    </div>
 <div class="kart siparis-alt">
      <label>Not (isteğe bağlı)<input id="sNot" placeholder="Örn: Yarın öğlene kadar lazım"></label>
      <div class="arac" style="margin:0">
        <a class="dugme yesil" id="sGonder" target="_blank" rel="noopener" style="flex:1">💬 Mesaj olarak gönder</a>
        <button class="yesil" id="sPdf" style="flex:1">📄 PDF olarak gönder</button>
      </div>
      <p class="kucuk-yazi" id="sUyari"></p>
    </div>`;

  const isaret = new Map();  // urun id -> adet
  const tedarikci = () => tedarikciler.find(t => t.id === Number($('#sTedarikci').value));

  function varsayilanlar() {
    isaret.clear();
    const tid = Number($('#sTedarikci').value);
    for (const u of urunler) {
      if (u.kritikte && (!u.son_tedarikci || u.son_tedarikci === tid)) isaret.set(u.id, oneri(u));
    }
  }

  function ciz() {
    const tid = Number($('#sTedarikci').value);
    const ara = aramaMetni($('#sAra').value);
    const sira = u => (isaret.has(u.id) ? 0 : u.kritikte ? 1 : u.son_tedarikci === tid ? 2 : 3);
    const liste = urunler
      .filter(u => !ara || aramaMetni(u.ad + ' ' + u.kod + ' ' + u.marka).includes(ara))
      .sort((a, b) => sira(a) - sira(b) || a.ad.localeCompare(b.ad, 'tr'));
    $('#sListe').innerHTML = liste.map(u => `<li>
      <label class="yatay" style="margin:0;flex:1"><input type="checkbox" data-u="${u.id}" ${isaret.has(u.id) ? 'checked' : ''}>
        <span><b>${esc(u.ad)}</b> ${u.kritikte ? '<span class="rozet kritik">KRİTİK</span>' : ''}<br>
        <span class="kucuk-yazi">Stok: ${sayi(u.stok)} ${esc(u.birim)}${u.kod ? ' · ' + esc(u.kod) : ''}</span></span></label>
      <input type="text" inputmode="decimal" data-adet="${u.id}" value="${isaret.has(u.id) ? isaret.get(u.id) : ''}" placeholder="Adet" style="width:70px;text-align:center">
    </li>`).join('') || '<li class="bos">Ürün yok</li>';
    $('#sListe').querySelectorAll('[data-u]').forEach(k => (k.onchange = () => {
      const id = Number(k.dataset.u);
      const u = urunler.find(x => x.id === id);
      if (k.checked) isaret.set(id, oneri(u)); else isaret.delete(id);
      $(`[data-adet="${id}"]`).value = k.checked ? isaret.get(id) : '';
      guncelle();
    }));
    $('#sListe').querySelectorAll('[data-adet]').forEach(g => (g.oninput = () => {
      const id = Number(g.dataset.adet);
      const n = Number(g.value.replace(',', '.'));
      if (n > 0) isaret.set(id, n); else isaret.delete(id);
      $(`[data-u="${id}"]`).checked = n > 0;
      guncelle();
    }));
    guncelle();
  }

  function guncelle() {
    const t = tedarikci();
    const secilenler = urunler.filter(u => isaret.has(u.id));
    $('#sSayac').textContent = secilenler.length ? `(${secilenler.length} kalem seçili)` : '';
    const metin = `Merhaba${t ? ' ' + t.ad : ''},\n${dukkan ? dukkan + ' için ' : ''}sipariş listemiz:\n\n` +
      secilenler.map(u => `• ${u.ad}${u.kod ? ' (' + u.kod + ')' : ''}: ${sayi(isaret.get(u.id))} ${u.birim}`).join('\n') +
      ($('#sNot').value.trim() ? `\n\nNot: ${$('#sNot').value.trim()}` : '') + '\n\nTeşekkürler.';
    const g = $('#sGonder');
    g.href = waAdresi(t && t.telefon, metin);
    for (const d of [g, $('#sPdf')]) {
      d.style.opacity = secilenler.length ? 1 : 0.5;
      d.style.pointerEvents = secilenler.length ? '' : 'none';
    }
    $('#sUyari').textContent = t && !t.telefon ? 'Bu tedarikçinin telefonu kayıtlı değil, WhatsApp kişi seçtirecek. Cari kartından telefon ekleyebilirsiniz.' : '';
  }

  $('#sPdf').onclick = () => {
    if (!window.jspdf) return bildir('PDF hazırlanıyor, bir saniye sonra tekrar basın', true);
    const t = tedarikci();
    const no = Number(localStorage.getItem('siparisNo') || 0) + 1;
    localStorage.setItem('siparisNo', no);
    const kalemler = urunler.filter(u => isaret.has(u.id)).map(u => ({ ad: u.ad, kod: u.kod, birim: u.birim, miktar: isaret.get(u.id) }));
    pdfPaylas({ tur: 'siparis', no, tarih: bugun(), musteri: t ? t.ad : '', telefon: t ? t.telefon : '', kalemler, aciklama: $('#sNot').value.trim() }, ayar)
      .catch(err => bildir(err.message, true));
  };
  $('#sTedarikci').onchange = () => { varsayilanlar(); ciz(); };
  let zaman;
  $('#sAra').oninput = () => { clearTimeout(zaman); zaman = setTimeout(ciz, 150); };
  $('#sNot').oninput = guncelle;
  // Barkod okutarak listeye ekle: her okutuşta ürün işaretlenir, tekrar okutulursa adet 1 artar
  $('#sBarkod').onclick = () => barkodTarayici({
    baslik: 'Siparişe eklenecek ürünleri okutun',
    onKod: (kod, son) => {
      const u = urunler.find(x => x.barkod === kod);
      if (!u) {
        son.className = 'tarayici-son kotu';
        son.textContent = `Kayıtlı değil: ${kod}`;
        return;
      }
      isaret.set(u.id, isaret.has(u.id) ? isaret.get(u.id) + 1 : oneri(u));
      son.className = 'tarayici-son iyi';
      son.textContent = `✓ ${u.ad}: ${sayi(isaret.get(u.id))} ${u.birim}`;
    },
    onKapat: ciz,
  });
  varsayilanlar();
  ciz();
}

// ---------- PDF (satış fişi ve fiyat teklifi) ----------

let pdfYukleniyor = null;
function scriptYukle(src) {
  return new Promise((coz, reddet) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = coz;
    sc.onerror = () => reddet(new Error('Dosya yüklenemedi: ' + src));
    document.head.appendChild(sc);
  });
}
// PDF kütüphanesini önceden yükler: paylaşım düğmesine basınca beklemeden açılsın (iPhone bunu şart koşuyor)
function pdfHazirla() {
  if (window.jspdf && window.PDF_FONT) return Promise.resolve();
  pdfYukleniyor = pdfYukleniyor || Promise.all([scriptYukle('lib/jspdf.min.js'), scriptYukle('lib/pdf-font.js')])
    .catch(e => { pdfYukleniyor = null; throw e; });
  return pdfYukleniyor;
}

// PDF'te sorun çıkarmasın diye özel boşlukları düz boşluğa çevir
const pdfMetin = v => String(v ?? '').replace(/[   ]/g, ' ');
const pdfPara = n => pdfMetin(para(n));

// belge: { tur: 'teklif' | 'satis' | 'siparis', no, tarih, musteri, telefon, kalemler, toplam, odeme, gecerlilik, aciklama }
function pdfOlustur(belge, ayar) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('dv.ttf', PDF_FONT.normal);
  doc.addFileToVFS('dv-b.ttf', PDF_FONT.bold);
  doc.addFont('dv.ttf', 'dv', 'normal');
  doc.addFont('dv-b.ttf', 'dv', 'bold');
  const yaz = (metin, x, y, { boyut = 10, kalin = false, hiza = 'left', renk = [31, 41, 55] } = {}) => {
    doc.setFont('dv', kalin ? 'bold' : 'normal');
    doc.setFontSize(boyut);
    doc.setTextColor(...renk);
    doc.text(pdfMetin(metin), x, y, { align: hiza });
  };
  const SOL = 15, SAG = 195;
  const teklif = belge.tur === 'teklif';
  const siparis = belge.tur === 'siparis';  // tedarikçiye sipariş: fiyatsız

  // Başlık
  doc.setFillColor(31, 78, 121);
  doc.rect(0, 0, 210, 32, 'F');
  yaz(ayar.dukkan_adi || 'Dükkan', SOL, 14, { boyut: 16, kalin: true, renk: [255, 255, 255] });
  yaz([ayar.dukkan_telefon, ayar.dukkan_adres].filter(Boolean).join('  ·  '), SOL, 22, { boyut: 9, renk: [207, 224, 240] });
  yaz({ teklif: 'FİYAT TEKLİFİ', satis: 'SATIŞ FİŞİ', siparis: 'SİPARİŞ FORMU' }[belge.tur], SAG, 14, { boyut: 14, kalin: true, hiza: 'right', renk: [255, 255, 255] });
  yaz(`No: ${belge.no}   Tarih: ${tarihYaz(belge.tarih)}`, SAG, 22, { boyut: 9, hiza: 'right', renk: [207, 224, 240] });

  let y = 44;
  yaz(teklif ? 'Sayın' : siparis ? 'Tedarikçi' : 'Müşteri', SOL, y, { boyut: 9, renk: [107, 114, 128] });
  yaz(belge.musteri || 'Perakende', SOL, y + 6, { boyut: 12, kalin: true });
  if (belge.telefon) yaz(belge.telefon, SOL, y + 12, { boyut: 9, renk: [107, 114, 128] });
  if (siparis) {
    yaz('Sipariş', SAG, y, { boyut: 9, hiza: 'right', renk: [107, 114, 128] });
    yaz(`${belge.kalemler.length} kalem`, SAG, y + 6, { boyut: 10, hiza: 'right' });
  } else if (teklif) {
    const son = new Date(belge.tarih);
    son.setDate(son.getDate() + (belge.gecerlilik || 7));
    yaz('Geçerlilik', SAG, y, { boyut: 9, hiza: 'right', renk: [107, 114, 128] });
    yaz(`${tarihYaz(son.toLocaleDateString('sv-SE'))} tarihine kadar`, SAG, y + 6, { boyut: 10, hiza: 'right' });
  } else {
    yaz('Ödeme', SAG, y, { boyut: 9, hiza: 'right', renk: [107, 114, 128] });
    yaz(belge.odeme === 'veresiye' ? 'Veresiye (hesaba yazıldı)' : 'Peşin', SAG, y + 6, { boyut: 10, hiza: 'right' });
  }

  // Tablo
  y += 22;
  const sutun = siparis
    ? { no: SOL + 2, ad: SOL + 10, miktar: SAG - 2 }
    : { no: SOL + 2, ad: SOL + 10, miktar: 128, fiyat: 160, tutar: SAG - 2 };
  const baslik = () => {
    doc.setFillColor(232, 240, 248);
    doc.rect(SOL, y - 5, SAG - SOL, 8, 'F');
    yaz('#', sutun.no, y, { boyut: 9, kalin: true });
    yaz('Ürün', sutun.ad, y, { boyut: 9, kalin: true });
    yaz('Miktar', sutun.miktar, y, { boyut: 9, kalin: true, hiza: 'right' });
    if (!siparis) {
      yaz('Birim fiyat', sutun.fiyat, y, { boyut: 9, kalin: true, hiza: 'right' });
      yaz('Tutar', sutun.tutar, y, { boyut: 9, kalin: true, hiza: 'right' });
    }
    y += 9;
  };
  baslik();
  doc.setFont('dv', 'normal');
  doc.setFontSize(10);
  belge.kalemler.forEach((k, i) => {
    const satirlar = doc.splitTextToSize(pdfMetin(k.ad), sutun.miktar - sutun.ad - 22);
    const yukseklik = satirlar.length * 4.6 + (k.kod ? 4.2 : 0) + 3;
    if (y + yukseklik > 268) {
      doc.addPage();
      y = 20;
      baslik();
    }
    yaz(String(i + 1), sutun.no, y, { boyut: 9, renk: [107, 114, 128] });
    satirlar.forEach((s, j) => yaz(s, sutun.ad, y + j * 4.6, { boyut: 10 }));
    if (k.kod) yaz(k.kod, sutun.ad, y + satirlar.length * 4.6, { boyut: 8, renk: [107, 114, 128] });
    yaz(`${sayi(k.miktar)} ${k.birim}`, sutun.miktar, y, { boyut: 10, hiza: 'right' });
    if (!siparis) {
      yaz(pdfPara(k.fiyat), sutun.fiyat, y, { boyut: 10, hiza: 'right' });
      yaz(pdfPara(k.tutar), sutun.tutar, y, { boyut: 10, hiza: 'right' });
    }
    y += yukseklik;
    doc.setDrawColor(229, 231, 235);
    doc.line(SOL, y - 3, SAG, y - 3);
  });

  // Toplam
  if (y > 250) { doc.addPage(); y = 20; }
  y += 4;
  if (!siparis) {
    doc.setFillColor(31, 78, 121);
    doc.rect(120, y - 6, SAG - 120, 11, 'F');
    yaz('GENEL TOPLAM', 124, y + 1.5, { boyut: 10, kalin: true, renk: [255, 255, 255] });
    yaz(pdfPara(belge.toplam), SAG - 3, y + 1.5, { boyut: 12, kalin: true, hiza: 'right', renk: [255, 255, 255] });
    y += 14;
    if (ayar.pdf_notu) { yaz(ayar.pdf_notu, SAG, y, { boyut: 8, hiza: 'right', renk: [107, 114, 128] }); y += 8; }
  }
  if (belge.aciklama) {
    yaz('Not:', SOL, y, { boyut: 9, kalin: true });
    doc.splitTextToSize(pdfMetin(belge.aciklama), SAG - SOL - 12).forEach((s, j) => yaz(s, SOL + 10, y + j * 4.6, { boyut: 9 }));
  }
  yaz({
    teklif: 'Teklifimizi değerlendirmenizi rica ederiz. Teşekkür ederiz.',
    satis: 'Bizi tercih ettiğiniz için teşekkür ederiz.',
    siparis: 'Siparişimizin hazırlanmasını rica ederiz. Teşekkürler.',
  }[belge.tur], 105, 287,
    { boyut: 8, hiza: 'center', renk: [107, 114, 128] });
  return doc.output('blob');
}

// Paylaş menüsünü (WhatsApp vb.) açar. Tıklamanın içinde, beklemeden çağrılmalı.
function pdfPaylas(belge, ayar) {
  if (!window.jspdf || !window.PDF_FONT) return Promise.reject(new Error('PDF hazırlanıyor, bir saniye sonra tekrar basın'));
  const ad = `${{ teklif: 'Teklif', satis: 'Satis-fisi', siparis: 'Siparis' }[belge.tur]}-${belge.no}-${(belge.musteri || '').replace(/[^\wğüşıöçĞÜŞİÖÇ]+/g, '-').slice(0, 30)}.pdf`;
  return dosyaVer(ad, pdfOlustur(belge, ayar), 'application/pdf');
}

// PDF'in yazı hali: kişinin WhatsApp sohbetine direkt gönderilebilsin diye
function belgeMetni(b, ayar) {
  const baslik = { teklif: 'Fiyat teklifi', satis: 'Satış fişi', siparis: 'Sipariş' }[b.tur];
  return `${ayar.dukkan_adi || ''} - ${baslik} #${b.no} (${tarihYaz(b.tarih)})\n\n` +
    b.kalemler.map(k => `• ${k.ad}: ${sayi(k.miktar)} ${k.birim} x ${para(k.fiyat)} = ${para(k.tutar)}`).join('\n') +
    `\n\nToplam: ${para(b.toplam)}` +
    (b.tur === 'teklif' ? `\nGeçerlilik: ${b.gecerlilik} gün` : b.odeme === 'veresiye' ? '\nÖdeme: hesabınıza yazıldı' : '') +
    (b.aciklama ? `\nNot: ${b.aciklama}` : '') + (ayar.pdf_notu ? `\n${ayar.pdf_notu}` : '') + '\n\nTeşekkür ederiz.';
}

function belgeKarti(belge, ayar, ustMetin) {
  const p = $('#pencere');
  // Önce kritik stok uyarısı açıksa o kapanınca göster
  if (p.open) {
    p.addEventListener('close', () => setTimeout(() => belgeKarti(belge, ayar, ustMetin), 50), { once: true });
    return;
  }
  const f = $('#pencereForm');
  const teklif = belge.tur === 'teklif';
  const siparis = belge.tur === 'siparis';  // tedarikçiye sipariş: fiyatsız
  f.innerHTML = `<h2>${ustMetin}</h2>
    <p><b>${esc(belge.musteri)}</b> · ${belge.kalemler.length} kalem · <b>${para(belge.toplam)}</b></p>
    <button type="button" class="yesil" id="pdfGonder" style="width:100%;padding:14px">📄 PDF olarak WhatsApp'tan gönder</button>
    <p class="kucuk-yazi">Açılan menüden WhatsApp'ı, sonra kişiyi seçin. Daha önce yazıştığınız kişiler menünün en üstünde çıkar.</p>
    ${belge.telefon ? `<a class="dugme ikincil" style="width:100%" target="_blank" rel="noopener" href="${esc(waAdresi(belge.telefon, belgeMetni(belge, ayar)))}">💬 ${esc(belge.musteri)} ile WhatsApp'ta yazı olarak gönder</a>
    <p class="kucuk-yazi">Bu, kişinin sohbetini direkt açar ama PDF eklenemez, liste yazı olarak gider.</p>` : ''}
    <div class="dugmeler">${teklif && !belge.satis_no ? '<button type="button" class="ikincil" id="satisaCevir">Satışa çevir</button>' : ''}
      <button type="button" class="ikincil" data-kapat>Kapat</button></div>`;
  f.onsubmit = e => e.preventDefault();
  f.querySelector('[data-kapat]').onclick = () => p.close();
  $('#pdfGonder').onclick = () => pdfPaylas(belge, ayar).catch(err => bildir(err.message, true));
  const sc = $('#satisaCevir');
  if (sc) sc.onclick = () => { p.close(); teklifiSatisaCevir(belge); };
  p.showModal();
}

async function belgeAc(tur, id) {
  const [belge, ayar] = await Promise.all([api(`/${tur === 'teklif' ? 'teklifler' : 'satislar'}/${id}`), api('/ayarlar'), pdfHazirla()]);
  belgeKarti({ ...belge, tur }, ayar, tur === 'teklif' ? `Teklif #${belge.no}` : `Satış fişi #${belge.no}`);
}

// ---------- Sepet: satış ve teklif ----------

const sepetOku = mod => JSON.parse(localStorage.getItem('sepet_' + mod) || 'null') || { cari_id: '', musteri: '', kalemler: [], odeme: 'pesin', gecerlilik: 7, aciklama: '' };
const sepetYaz = (mod, s) => localStorage.setItem('sepet_' + mod, JSON.stringify(s));

function teklifiSatisaCevir(t) {
  sepetYaz('satis', {
    cari_id: t.cari_id || '', kalemler: t.kalemler.map(k => ({ urun_id: k.urun_id, miktar: k.miktar, fiyat: k.fiyat })),
    odeme: 'pesin', aciklama: t.aciklama, teklif_id: t.id,
  });
  if (location.hash === '#/satis') yonlendir(); else location.hash = '#/satis';
}

function satisSayfasi() { return sepetSayfasi('satis'); }
function teklifSayfasi() { return sepetSayfasi('teklif'); }

async function sepetSayfasi(mod) {
  const satisModu = mod === 'satis';
  const [urunler, cariler, gecmis, ayar] = await Promise.all([
    api('/urunler'), api('/cariler'), api(satisModu ? '/satislar' : '/teklifler'), api('/ayarlar'),
  ]);
  pdfHazirla().catch(() => {});
  const urunHarita = new Map(urunler.map(u => [u.id, u]));
  const sepet = sepetOku(mod);
  sepet.kalemler = sepet.kalemler.filter(k => urunHarita.has(k.urun_id));
  const kaydet = () => sepetYaz(mod, sepet);
  const musteriler = [...cariler.filter(c => c.tur === 'musteri'), ...cariler.filter(c => c.tur !== 'musteri')];

  icerik.innerHTML = `
    <div class="sekme">
      <a href="#/satis" class="${satisModu ? 'aktif' : ''}">🧾 Satış</a>
      <a href="#/teklif" class="${satisModu ? '' : 'aktif'}">📄 Teklif</a>
    </div>
    ${sepet.teklif_id ? `<div class="kart" style="border-left:4px solid var(--ana)">Teklif #${sepet.teklif_id} satışa çevriliyor.</div>` : ''}
    <div class="kart">
      <label>Müşteri<select id="sMusteri"><option value="">${satisModu ? '— Perakende (müşterisiz) —' : '— Listede yok, adını yazacağım —'}</option>
        ${musteriler.map(c => `<option value="${c.id}" ${String(c.id) === String(sepet.cari_id) ? 'selected' : ''}>${esc(c.ad)}${c.tur === 'tedarikci' ? ' (tedarikçi)' : ''}</option>`).join('')}</select></label>
      ${satisModu ? '' : `<label id="sMusteriAdiKutu">Müşteri adı<input id="sMusteriAdi" value="${esc(sepet.musteri)}" placeholder="Örn: Ahmet Bey (Doblo)"></label>`}
      <div class="arac" style="margin:0"><input type="search" id="sUrunAra" placeholder="Ürün ekle: ad, kod veya marka"><button class="ikincil" id="sBarkodOku">📷 Barkod</button></div>
      <ul class="liste" id="sOneriler"></ul>
    </div>
    <div class="kart"><h2>${satisModu ? 'Sepet' : 'Teklif kalemleri'}</h2><ul class="liste" id="sSepet"></ul></div>
    <div class="kart siparis-alt">
      <div class="baslik-satir"><span>Toplam</span><b id="sToplam" style="font-size:24px"></b></div>
      ${satisModu ? `<div class="sekme" style="margin:10px 0">
          <a href="#" data-odeme="pesin">💵 Peşin</a><a href="#" data-odeme="veresiye">📝 Veresiye</a></div>`
        : `<div class="form-izgara"><label>Geçerlilik (gün)<input id="sGecerlilik" inputmode="numeric" value="${esc(sepet.gecerlilik || 7)}"></label>
           <label>Not<input id="sAciklama" value="${esc(sepet.aciklama || '')}" placeholder="Örn: Montaj dahil"></label></div>`}
      <div class="arac" style="margin:0"><button class="yesil" id="sTamamla" style="flex:1;padding:14px">${satisModu ? '✓ Satışı tamamla' : '✓ Teklifi kaydet'}</button>
        <button class="metin" id="sTemizle">Temizle</button></div>
    </div>
    <div class="kart"><h2>${satisModu ? 'Son satışlar' : 'Kayıtlı teklifler'}</h2>
      ${gecmis.length ? `<ul class="liste">${gecmis.map(b => `<li class="tikla" data-belge="${b.id}">
        <div><b>#${b.no} ${esc(b.musteri)}</b><br><span class="kucuk-yazi">${tarihYaz(b.tarih)} · ${b.kalemler.length} kalem
        ${satisModu ? ' · ' + (b.odeme === 'veresiye' ? 'veresiye' : 'peşin') : b.satis_no ? ' · <span class="pozitif">satışa çevrildi</span>' : ''}</span></div>
        <div><b>${para(b.toplam)}</b> 📄</div></li>`).join('')}</ul>` : '<div class="bos">Henüz kayıt yok</div>'}
    </div>`;

  const musteriAdiKutu = $('#sMusteriAdiKutu');
  const musteriDegisti = () => {
    sepet.cari_id = $('#sMusteri').value;
    if (musteriAdiKutu) musteriAdiKutu.style.display = sepet.cari_id ? 'none' : '';
    kaydet();
  };
  $('#sMusteri').onchange = musteriDegisti;
  musteriDegisti();
  if ($('#sMusteriAdi')) $('#sMusteriAdi').oninput = e => { sepet.musteri = e.target.value; kaydet(); };
  if ($('#sGecerlilik')) $('#sGecerlilik').oninput = e => { sepet.gecerlilik = e.target.value; kaydet(); };
  if ($('#sAciklama')) $('#sAciklama').oninput = e => { sepet.aciklama = e.target.value; kaydet(); };

  function ekle(u, n = 1) {
    const k = sepet.kalemler.find(x => x.urun_id === u.id);
    if (k) k.miktar = Math.round((Number(k.miktar) + n) * 1000) / 1000;
    else sepet.kalemler.push({ urun_id: u.id, miktar: n, fiyat: u.satis_fiyat || 0 });
    kaydet();
  }

  function ciz() {
    const toplam = sepet.kalemler.reduce((t, k) => t + (Number(k.miktar) || 0) * (Number(k.fiyat) || 0), 0);
    $('#sSepet').innerHTML = sepet.kalemler.length ? sepet.kalemler.map(k => {
      const u = urunHarita.get(k.urun_id);
      const yetmez = satisModu && Number(k.miktar) > u.stok;
      return `<li style="flex-wrap:wrap">
        <div style="flex:1 1 100%"><b>${esc(u.ad)}</b> <span class="kucuk-yazi">${esc(u.kod)}</span>
          <span class="kucuk-yazi ${yetmez ? 'negatif' : ''}">· stok ${sayi(u.stok)} ${esc(u.birim)}${yetmez ? ' (yetmiyor!)' : ''}</span></div>
        <div class="sepet-satir">
          <label>Adet<input inputmode="decimal" data-miktar="${u.id}" value="${k.miktar}"></label>
          <label>Birim fiyat (₺)<input inputmode="decimal" data-fiyat="${u.id}" value="${k.fiyat}"></label>
          <div class="sag"><span class="kucuk-yazi">Tutar</span><br><b data-tutar="${u.id}">${para(k.miktar * k.fiyat)}</b></div>
          <button class="metin" data-sil="${u.id}">✕</button>
        </div></li>`;
    }).join('') : '<div class="bos">Ürün eklemek için yukarıdan arayın ya da barkod okutun</div>';
    $('#sToplam').textContent = para(toplam);
    icerik.querySelectorAll('[data-odeme]').forEach(a => {
      a.classList.toggle('aktif', a.dataset.odeme === sepet.odeme);
      a.onclick = e => { e.preventDefault(); sepet.odeme = a.dataset.odeme; kaydet(); ciz(); };
    });
    const guncelleSatir = id => {
      const k = sepet.kalemler.find(x => x.urun_id === id);
      $(`[data-tutar="${id}"]`).textContent = para(k.miktar * k.fiyat);
      $('#sToplam').textContent = para(sepet.kalemler.reduce((t, x) => t + x.miktar * x.fiyat, 0));
      kaydet();
    };
    icerik.querySelectorAll('[data-miktar]').forEach(g => (g.oninput = () => {
      const k = sepet.kalemler.find(x => x.urun_id === Number(g.dataset.miktar));
      k.miktar = Number(g.value.replace(',', '.')) || 0;
      guncelleSatir(k.urun_id);
    }));
    icerik.querySelectorAll('[data-fiyat]').forEach(g => (g.oninput = () => {
      const k = sepet.kalemler.find(x => x.urun_id === Number(g.dataset.fiyat));
      k.fiyat = Number(g.value.replace(',', '.')) || 0;
      guncelleSatir(k.urun_id);
    }));
    icerik.querySelectorAll('#sSepet [data-sil]').forEach(b => (b.onclick = () => {
      sepet.kalemler = sepet.kalemler.filter(x => x.urun_id !== Number(b.dataset.sil));
      kaydet();
      ciz();
    }));
  }

  // Arama önerileri
  $('#sUrunAra').oninput = () => {
    const ara = aramaMetni($('#sUrunAra').value);
    const bulunan = ara ? urunler.filter(u => aramaMetni([u.ad, u.kod, u.marka, u.barkod].join(' ')).includes(ara)).slice(0, 6) : [];
    $('#sOneriler').innerHTML = bulunan.map(u => `<li class="tikla" data-ekle="${u.id}"><div><b>${esc(u.ad)}</b><br>
      <span class="kucuk-yazi">${esc(u.kod)} · stok ${sayi(u.stok)} ${esc(u.birim)}</span></div><div>${para(u.satis_fiyat)} <b>＋</b></div></li>`).join('');
    $('#sOneriler').querySelectorAll('[data-ekle]').forEach(li => (li.onclick = () => {
      ekle(urunHarita.get(Number(li.dataset.ekle)));
      $('#sUrunAra').value = '';
      $('#sOneriler').innerHTML = '';
      ciz();
    }));
  };
  $('#sBarkodOku').onclick = () => barkodTarayici({
    baslik: satisModu ? 'Satılan ürünleri okutun' : 'Teklife eklenecek ürünleri okutun',
    onKod: (kod, son) => {
      const u = urunler.find(x => x.barkod === kod);
      if (!u) {
        son.className = 'tarayici-son kotu';
        son.textContent = `Kayıtlı değil: ${kod}`;
        return;
      }
      ekle(u);
      const k = sepet.kalemler.find(x => x.urun_id === u.id);
      son.className = 'tarayici-son iyi';
      son.textContent = `✓ ${u.ad}: ${sayi(k.miktar)} ${u.birim} · ${para(u.satis_fiyat)}`;
    },
    onKapat: ciz,
  });

  $('#sTemizle').onclick = () => {
    if (sepet.kalemler.length && !onayla('Sepet temizlensin mi?')) return;
    localStorage.removeItem('sepet_' + mod);
    yonlendir();
  };

  $('#sTamamla').onclick = async () => {
    const kalemler = sepet.kalemler.filter(k => k.miktar > 0);
    if (!kalemler.length) return bildir('Sepet boş', true);
    try {
      if (satisModu) {
        if (sepet.odeme === 'veresiye' && !sepet.cari_id) return bildir('Veresiye için müşteri seçin', true);
        const eksik = kalemler.filter(k => k.miktar > urunHarita.get(k.urun_id).stok);
        if (eksik.length && !onayla(`${eksik.map(k => urunHarita.get(k.urun_id).ad).join(', ')} için stok yetmiyor. Yine de satış yapılsın mı? (Stok eksiye düşer)`)) return;
        const { id } = await api('/satis', { method: 'POST', body: { cari_id: sepet.cari_id, odeme: sepet.odeme, kalemler, aciklama: sepet.aciklama, teklif_id: sepet.teklif_id } });
        localStorage.removeItem('sepet_satis');
        await yonlendir();
        const belge = await api('/satislar/' + id);
        await pdfHazirla().catch(() => {});
        belgeKarti({ ...belge, tur: 'satis' }, ayar, `✓ Satış kaydedildi (fiş #${belge.no})`);
      } else {
        const { id } = await api('/teklifler', { method: 'POST', body: { cari_id: sepet.cari_id, musteri: sepet.musteri, kalemler, gecerlilik: sepet.gecerlilik, aciklama: sepet.aciklama } });
        localStorage.removeItem('sepet_teklif');
        await yonlendir();
        const belge = await api('/teklifler/' + id);
        await pdfHazirla().catch(() => {});
        belgeKarti({ ...belge, tur: 'teklif' }, ayar, `✓ Teklif kaydedildi (#${belge.no})`);
      }
    } catch (err) { bildir(err.message, true); }
  };
  icerik.querySelectorAll('[data-belge]').forEach(li => (li.onclick = () => belgeAc(mod, li.dataset.belge).catch(err => bildir(err.message, true))));
  ciz();
}

// ---------- Ayarlar ----------

async function ayarlarSayfasi() {
  const [a, kayitlar] = await Promise.all([api('/ayarlar'), api('/bildirimler')]);
  const izin = bildirimDestekli ? Notification.permission : 'yok';
  icerik.innerHTML = `
    <h1>Ayarlar</h1>
    ${kurulumKarti()}
    <div class="kart">
      <h2>🔔 Kritik stok bildirimi</h2>
      <p class="kucuk-yazi">Bir satış ya da sayım sonrası ürün kritik seviyeye inince telefon bildirim verir ve titrer. Ücretsizdir.</p>
      ${izin === 'granted'
        ? '<p><span class="rozet">Bildirimler açık ✓</span></p><button class="ikincil" id="bildirimDene">Deneme bildirimi gönder</button>'
        : izin === 'denied'
          ? '<p class="negatif">Bildirim izni kapalı. Telefonun Ayarlar → Uygulamalar (veya Bildirimler) bölümünden bu uygulamaya izin verin.</p>'
          : iphone && !uygulamaModu
            ? "<p>iPhone'da bildirim için önce Safari'de <b>Paylaş → Ana Ekrana Ekle</b> ile uygulamayı yükleyin, ana ekrandaki simgeden açıp buraya gelin.</p>"
            : '<button class="yesil" id="bildirimAc">🔔 Bildirimleri aç</button>'}
    </div>

    <form class="kart" id="ayarForm">
      <h2>Genel</h2>
      <label>Dükkan adı<input name="dukkan_adi" value="${esc(a.dukkan_adi)}" placeholder="Örn: Yılmaz Oto Yedek Parça"></label>
      <p class="kucuk-yazi">Aşağıdakiler satış fişi ve teklif PDF'lerinin üstünde/altında görünür.</p>
      <div class="form-izgara">
        <label>Dükkan telefonu<input name="dukkan_telefon" type="tel" value="${esc(a.dukkan_telefon)}" placeholder="0532 123 45 67"></label>
        <label>Dükkan adresi<input name="dukkan_adres" value="${esc(a.dukkan_adres)}" placeholder="Sanayi Sitesi 5. Blok No:3"></label>
        <label class="tam">PDF alt notu<input name="pdf_notu" value="${esc(a.pdf_notu ?? 'Fiyatlarımıza KDV dahildir.')}"></label>
      </div>
      <button type="submit">Kaydet</button>
    </form>

    <div class="kart"><h2>💾 Yedek</h2>
      <p class="kucuk-yazi">Veriler sadece bu telefonda saklanır. Haftada bir yedek alıp WhatsApp'ta kendinize, Google Drive'a ya da e-postaya gönderin.
      Yeni telefona geçince aynı dosyayı "Yedekten geri yükle" ile açmanız yeterli.</p>
      <p class="kucuk-yazi">Son yedek: ${a.son_yedek ? esc(a.son_yedek) : 'hiç alınmadı'}</p>
      <div class="arac">
        <button id="yedekAl">Yedek al / gönder</button>
        <label class="dugme ikincil" style="margin:0">Yedekten geri yükle<input type="file" id="yedekDosya" accept=".json,application/json" hidden></label>
      </div>
    </div>

    <div class="kart"><h2>🧪 Deneme verileri</h2>
      <p class="kucuk-yazi">Uygulamayı denemek için örnek cariler, ürünler ve satışlar yükler. Mevcut verilerin yerine geçer.
      Gerçek kullanıma başlarken "Tüm verileri sil" ile temizleyin.</p>
      <div class="arac"><button class="ikincil" id="ornekYukle">Örnek verileri yükle</button>
      <button class="kirmizi" id="hepsiniSil">Tüm verileri sil</button></div>
    </div>

    <div class="kart"><h2>Son uyarılar</h2>
      ${kayitlar.length ? `<ul class="liste">${kayitlar.map(k => `<li><div>${esc(k.mesaj)}<br><span class="kucuk-yazi">${esc(k.tarih)}</span></div></li>`).join('')}</ul>`
        : '<div class="bos">Henüz uyarı yok</div>'}
    </div>`;

  kurulumKartiBagla();
  const ba = $('#bildirimAc');
  if (ba) ba.onclick = async () => {
    try { await bildirimIzniAl(); bildir('Bildirimler açıldı'); yonlendir(); } catch (err) { bildir(err.message, true); }
  };
  const bd = $('#bildirimDene');
  if (bd) bd.onclick = () => telefonBildirimi('Deneme bildirimi', 'Kritik stok uyarıları bu şekilde görünecek.', '#/ayarlar');
  $('#ayarForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await api('/ayarlar', { method: 'PUT', body: { dukkan_adi: f.dukkan_adi.value, dukkan_telefon: f.dukkan_telefon.value, dukkan_adres: f.dukkan_adres.value, pdf_notu: f.pdf_notu.value } });
    $('#dukkanAdi').textContent = f.dukkan_adi.value || 'Dükkan Takip';
    bildir('Kaydedildi');
  };
  $('#yedekAl').onclick = () => yedekAl().then(() => setTimeout(yonlendir, 800));
  $('#ornekYukle').onclick = async () => {
    if (!onayla('Örnek veriler yüklensin mi? Bu telefondaki mevcut kayıtlar silinip yerine örnekler gelecek.')) return;
    const r = await Yerel.ornekYukle();
    bildir(`Örnek veriler yüklendi: ${r.cari} cari, ${r.urun} ürün`);
    location.hash = '#/';
  };
  $('#hepsiniSil').onclick = async () => {
    if (!onayla('TÜM cariler, ürünler ve hareketler silinsin mi? Bu geri alınamaz.')) return;
    await Yerel.hepsiniSil();
    bildir('Tüm veriler silindi');
    location.hash = '#/';
  };
  $('#yedekDosya').onchange = async e => {
    const dosya = e.target.files[0];
    if (!dosya) return;
    if (!onayla('Yedek yüklenirse bu telefondaki mevcut veriler yedektekilerle DEĞİŞTİRİLİR. Devam edilsin mi?')) return;
    try {
      const r = await Yerel.yedektenYukle(await dosya.text());
      bildir(`Yedek yüklendi: ${r.cari} cari, ${r.urun} ürün`);
      location.hash = '#/';
      yonlendir();
    } catch (err) { bildir(err.message, true); }
  };
}

yonlendir();
