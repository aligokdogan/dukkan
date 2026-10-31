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

function whatsappAdresi(metin) {
  const no = (localStorage.getItem('uyariTelefon') || '').replace(/\D/g, '').replace(/^0/, '90').replace(/^5/, '905');
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
  if (p.open) p.close();
  const f = $('#pencereForm');
  f.innerHTML = `<h2 class="negatif">⚠️ ${esc(baslik)}</h2>
    <ul class="liste">${urunler.map(u => `<li><b>${esc(u.ad)}</b><span class="negatif"><b>${sayi(u.stok)}</b> ${esc(u.birim)} kaldı</span></li>`).join('')}</ul>
    <p class="kucuk-yazi">Kritik seviyeye indi. Sipariş vermeyi unutmayın.</p>
    <div class="dugmeler"><button type="button" class="ikincil" data-kapat>Tamam</button>
    <a class="dugme yesil" href="${whatsappAdresi(metin)}" target="_blank" rel="noopener">WhatsApp'tan gönder</a></div>`;
  f.onsubmit = e => e.preventDefault();
  f.querySelector('[data-kapat]').onclick = () => p.close();
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
};

async function yonlendir() {
  const [, ad = '', id] = location.hash.replace(/^#/, '').split('/');
  const aktif = { '': 'ozet', cari: 'cariler', urun: 'stok' }[ad] || ad;
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
      <div class="baslik-satir"><h2>Kritik stok</h2>${o.kritik.length ? '<a class="dugme yesil kucuk" id="kritikPaylas" target="_blank" rel="noopener">WhatsApp\'tan gönder</a>' : ''}</div>
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
  const kp = $('#kritikPaylas');
  if (kp) kp.href = whatsappAdresi(Yerel.kritikMetni(o.kritik));
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
        ? '<button class="yesil" id="alacakEkle">📦 Mal aldım (veresiye)</button><button id="borcEkle">💵 Ödeme yaptım</button>'
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
    <div class="arac">
      <input type="search" id="urunAra" placeholder="Ürün adı, kod, marka veya raf ara…">
      <label class="yatay" style="margin:0"><input type="checkbox" id="kritikFiltre" ${sadeceKritik ? 'checked' : ''}> Sadece kritik</label>
    </div>
    <div class="kart" id="urunListe"><div class="bos">Yükleniyor…</div></div>
    <p class="kucuk-yazi"><a href="#" data-csv="urunler">Excel'e aktar (CSV)</a></p>`;
  csvBagla();
  $('#yeniUrun').onclick = () => urunFormu();
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

function urunFormu(u) {
  const yeni = !u;
  u = u || { birim: 'Adet' };
  formAc({
    baslik: yeni ? 'Yeni ürün' : 'Ürünü düzenle',
    alanlar: [
      { ad: 'ad', etiket: 'Ürün adı', deger: u.ad, gerekli: true, tam: true },
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
        location.hash = '#/urun/' + r.id;
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
      <p class="kucuk-yazi">${[u.kod && 'Kod: ' + esc(u.kod), u.marka && esc(u.marka), u.raf && 'Raf: ' + esc(u.raf)].filter(Boolean).join(' · ')}</p>
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
      <label>Kritik stok listesinin WhatsApp'tan gideceği numara (isteğe bağlı)
        <input name="uyari_telefon" type="tel" value="${esc(localStorage.getItem('uyariTelefon') || '')}" placeholder="Örn: 0532 123 45 67 (boş bırakılırsa kişi seçilir)"></label>
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
    localStorage.setItem('uyariTelefon', f.uyari_telefon.value.trim());
    await api('/ayarlar', { method: 'PUT', body: { dukkan_adi: f.dukkan_adi.value } });
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
