'use strict';

// Tüm veriler bu telefonun içinde (IndexedDB) saklanır. Sunucu yoktur.
// Arayüz eski sunuculu sürümle aynı adresleri kullanır, bu dosya onları telefonda cevaplar.

const VERI_ANAHTAR = 'veri';
let veri = null;

function bosVeri() {
  return {
    surum: 1,
    sayac: { cari: 0, cariHareket: 0, urun: 0, stokHareket: 0, bildirim: 0 },
    cariler: [], cariHareketler: [], urunler: [], stokHareketler: [], bildirimler: [],
    ayarlar: { dukkan_adi: '' },
  };
}

function idbAc() {
  return new Promise((coz, reddet) => {
    const istek = indexedDB.open('dukkan', 1);
    istek.onupgradeneeded = () => istek.result.createObjectStore('kv');
    istek.onsuccess = () => coz(istek.result);
    istek.onerror = () => reddet(istek.error);
  });
}

async function idb(mod, islem) {
  const db = await idbAc();
  return new Promise((coz, reddet) => {
    const tx = db.transaction('kv', mod);
    const istek = islem(tx.objectStore('kv'));
    tx.oncomplete = () => coz(istek && istek.result);
    tx.onerror = () => reddet(tx.error);
  });
}

async function veriYukle() {
  if (veri) return veri;
  try {
    veri = await idb('readonly', s => s.get(VERI_ANAHTAR));
  } catch {
    veri = JSON.parse(localStorage.getItem(VERI_ANAHTAR) || 'null');
  }
  veri = Object.assign(bosVeri(), veri || {});
  // Tarayıcıdan verilerin silinmemesini iste (Android'de yüklü uygulamada genelde otomatik onaylanır)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return veri;
}

async function veriKaydet() {
  try {
    await idb('readwrite', s => s.put(veri, VERI_ANAHTAR));
  } catch {
    localStorage.setItem(VERI_ANAHTAR, JSON.stringify(veri));
  }
}

// ---------- Yardımcılar ----------

const yerelBugun = () => new Date().toLocaleDateString('sv-SE');
const simdi = () => new Date().toLocaleString('sv-SE').slice(0, 19);
const sayiAl = (v, varsayilan = 0) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : varsayilan;
};
const yazi = v => (v == null ? '' : String(v).trim());
const yuvarla = n => Math.round(n * 1000) / 1000;
function aramaMetni(s) {
  return String(s ?? '').toLocaleLowerCase('tr')
    .replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}
const yeniId = tur => ++veri.sayac[tur];
const adSirala = (a, b) => a.ad.localeCompare(b.ad, 'tr');
const kritikMi = u => u.kritik > 0 && u.stok <= u.kritik;
const kopya = o => JSON.parse(JSON.stringify(o));

function hataVer(mesaj) {
  throw new Error(mesaj);
}

function bakiye(cariId) {
  let b = 0;
  for (const h of veri.cariHareketler) if (h.cari_id === cariId) b += h.tip === 'borc' ? h.tutar : -h.tutar;
  return Math.round(b * 100) / 100;
}

function cariBul(id) {
  return veri.cariler.find(c => c.id === Number(id)) || hataVer('Cari bulunamadı');
}
function urunBul(id) {
  return veri.urunler.find(u => u.id === Number(id)) || hataVer('Ürün bulunamadı');
}

function cariVerisi(b) {
  const ad = yazi(b.ad);
  if (!ad) hataVer('Cari adı boş olamaz');
  return {
    ad, tur: b.tur === 'tedarikci' ? 'tedarikci' : 'musteri',
    telefon: yazi(b.telefon), email: yazi(b.email), adres: yazi(b.adres), vergi_no: yazi(b.vergi_no), notlar: yazi(b.notlar),
  };
}

function urunVerisi(b) {
  const ad = yazi(b.ad);
  if (!ad) hataVer('Ürün adı boş olamaz');
  return {
    kod: yazi(b.kod), ad, marka: yazi(b.marka), raf: yazi(b.raf), birim: yazi(b.birim) || 'Adet',
    kritik: sayiAl(b.kritik), alis_fiyat: sayiAl(b.alis_fiyat), satis_fiyat: sayiAl(b.satis_fiyat),
  };
}

function bildirimLogla(kanal, durum, mesaj) {
  veri.bildirimler.unshift({ id: yeniId('bildirim'), tarih: simdi(), kanal, durum, mesaj });
  veri.bildirimler.length = Math.min(veri.bildirimler.length, 100);
}

// Kritik seviyeye yeni inen ürünleri döndürür ve işaretler.
// Stok kritiğin üstüne çıkınca işaret kalkar, bir sonraki düşüşte yine uyarılır.
function kritikKontrol() {
  const yeni = [];
  for (const u of veri.urunler) {
    if (!kritikMi(u)) u.uyari_gonderildi = 0;
    else if (!u.uyari_gonderildi) {
      u.uyari_gonderildi = 1;
      yeni.push(u);
    }
  }
  return yeni;
}

function kritikMetni(urunler) {
  const dukkan = veri.ayarlar.dukkan_adi || 'Dükkan';
  return `${dukkan} - kritik stok\n\n` +
    urunler.map(u => `- ${u.ad}${u.kod ? ' (' + u.kod + ')' : ''}: ${u.stok} ${u.birim} kaldı (kritik: ${u.kritik})`).join('\n');
}

function csvYap(basliklar, satirlar) {
  const kacir = v => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [basliklar.map(b => b[1]), ...satirlar.map(r => basliklar.map(b => r[b[0]]))]
    .map(s => s.map(kacir).join(';')).join('\r\n');
}

// ---------- Adresler ----------

const yollar = [];
function yol(yontem, desen, isle) {
  const anahtarlar = [];
  const re = new RegExp('^' + desen.replace(/:(\w+)/g, (_, k) => (anahtarlar.push(k), '([^/]+)')) + '$');
  yollar.push({ yontem, re, anahtarlar, isle });
}

yol('GET', '/ozet', () => {
  let alacak = 0, borc = 0;
  for (const c of veri.cariler) {
    const b = bakiye(c.id);
    if (b > 0) alacak += b; else borc -= b;
  }
  const cariAd = Object.fromEntries(veri.cariler.map(c => [c.id, c.ad]));
  const urun = Object.fromEntries(veri.urunler.map(u => [u.id, u]));
  return {
    kritik: veri.urunler.filter(kritikMi).sort((a, b) => (a.stok - a.kritik) - (b.stok - b.kritik) || adSirala(a, b)),
    alacak, borc,
    sonCari: veri.cariHareketler.slice(-8).reverse().map(h => ({ ...h, cari_ad: cariAd[h.cari_id] })),
    sonStok: veri.stokHareketler.slice(-8).reverse().map(h => ({ ...h, urun_ad: urun[h.urun_id]?.ad, birim: urun[h.urun_id]?.birim })),
    sayilar: {
      cari: veri.cariler.length, urun: veri.urunler.length,
      stok_degeri: veri.urunler.reduce((t, u) => t + (u.stok > 0 ? u.stok * u.alis_fiyat : 0), 0),
    },
    dukkan: veri.ayarlar.dukkan_adi || 'Dükkan Takip',
    son_yedek: veri.ayarlar.son_yedek || '',
  };
});

yol('GET', '/cariler', (p, q) => {
  const ara = aramaMetni(q.get('q'));
  const tur = q.get('tur') || '';
  return veri.cariler
    .filter(c => (!tur || c.tur === tur) && (aramaMetni(c.ad).includes(ara) || c.telefon.includes(ara)))
    .sort(adSirala)
    .map(c => {
      const son = veri.cariHareketler.filter(h => h.cari_id === c.id).reduce((m, h) => (h.tarih > m ? h.tarih : m), '');
      return { ...c, bakiye: bakiye(c.id), son_islem: son };
    });
});

yol('POST', '/cariler', (p, q, b) => {
  const c = { id: yeniId('cari'), ...cariVerisi(b), olusturma: simdi() };
  veri.cariler.push(c);
  const acilis = sayiAl(b.acilis_bakiye);
  if (acilis) {
    veri.cariHareketler.push({ id: yeniId('cariHareket'), cari_id: c.id, tarih: yerelBugun(), tip: acilis > 0 ? 'borc' : 'alacak', tutar: Math.abs(acilis), aciklama: 'Açılış bakiyesi' });
  }
  return { id: c.id };
});

yol('GET', '/cariler/:id', p => {
  const c = cariBul(p.id);
  const hareketler = veri.cariHareketler.filter(h => h.cari_id === c.id)
    .sort((a, b) => a.tarih.localeCompare(b.tarih) || a.id - b.id).map(h => ({ ...h }));
  let yuruyen = 0;
  for (const h of hareketler) {
    yuruyen += h.tip === 'borc' ? h.tutar : -h.tutar;
    h.bakiye = yuruyen;
  }
  return { cari: { ...c, bakiye: bakiye(c.id) }, hareketler: hareketler.reverse() };
});

yol('PUT', '/cariler/:id', (p, q, b) => {
  Object.assign(cariBul(p.id), cariVerisi(b));
  return { tamam: true };
});

yol('DELETE', '/cariler/:id', p => {
  const id = Number(p.id);
  veri.cariler = veri.cariler.filter(c => c.id !== id);
  veri.cariHareketler = veri.cariHareketler.filter(h => h.cari_id !== id);
  for (const h of veri.stokHareketler) if (h.cari_id === id) h.cari_id = null;
  return { tamam: true };
});

yol('POST', '/cariler/:id/hareket', (p, q, b) => {
  const c = cariBul(p.id);
  const tutar = sayiAl(b.tutar);
  if (!(tutar > 0)) hataVer('Tutar sıfırdan büyük olmalı');
  veri.cariHareketler.push({ id: yeniId('cariHareket'), cari_id: c.id, tarih: yazi(b.tarih) || yerelBugun(), tip: b.tip === 'alacak' ? 'alacak' : 'borc', tutar, aciklama: yazi(b.aciklama) });
  return { tamam: true };
});

yol('DELETE', '/cari-hareket/:id', p => {
  veri.cariHareketler = veri.cariHareketler.filter(h => h.id !== Number(p.id));
  return { tamam: true };
});

yol('GET', '/urunler', (p, q) => {
  const ara = aramaMetni(q.get('q'));
  const sadeceKritik = q.get('kritik') === '1';
  return veri.urunler
    .filter(u => (!sadeceKritik || kritikMi(u)) && [u.ad, u.kod, u.marka, u.raf].some(a => aramaMetni(a).includes(ara)))
    .sort(adSirala);
});

yol('POST', '/urunler', (p, q, b) => {
  const u = { id: yeniId('urun'), ...urunVerisi(b), stok: sayiAl(b.stok), uyari_gonderildi: 0, olusturma: simdi() };
  veri.urunler.push(u);
  if (u.stok) {
    veri.stokHareketler.push({ id: yeniId('stokHareket'), urun_id: u.id, tarih: yerelBugun(), tip: 'sayim', miktar: u.stok, birim_fiyat: u.alis_fiyat, cari_id: null, aciklama: 'Açılış stoku' });
  }
  return { id: u.id };
});

yol('GET', '/urunler/:id', p => {
  const u = urunBul(p.id);
  const cariAd = Object.fromEntries(veri.cariler.map(c => [c.id, c.ad]));
  const hareketler = veri.stokHareketler.filter(h => h.urun_id === u.id)
    .sort((a, b) => b.tarih.localeCompare(a.tarih) || b.id - a.id).slice(0, 200)
    .map(h => ({ ...h, cari_ad: cariAd[h.cari_id] || '' }));
  return { urun: { ...u }, hareketler };
});

yol('PUT', '/urunler/:id', (p, q, b) => {
  Object.assign(urunBul(p.id), urunVerisi(b));
  return { tamam: true };
});

yol('DELETE', '/urunler/:id', p => {
  const id = Number(p.id);
  const silinecek = new Set(veri.stokHareketler.filter(h => h.urun_id === id).map(h => h.id));
  veri.urunler = veri.urunler.filter(u => u.id !== id);
  veri.stokHareketler = veri.stokHareketler.filter(h => h.urun_id !== id);
  for (const h of veri.cariHareketler) if (silinecek.has(h.stok_hareket_id)) h.stok_hareket_id = null;
  return { tamam: true };
});

// tip: giris (alış), cikis (satış), sayim (sayılan yeni miktar)
yol('POST', '/urunler/:id/hareket', (p, q, b) => {
  const u = urunBul(p.id);
  const tip = ['giris', 'cikis', 'sayim'].includes(b.tip) ? b.tip : hataVer('Geçersiz hareket tipi');
  const girilen = sayiAl(b.miktar, NaN);
  if (!Number.isFinite(girilen) || girilen < 0 || (tip !== 'sayim' && !(girilen > 0))) hataVer('Miktarı kontrol edin');
  const tarih = yazi(b.tarih) || yerelBugun();
  const fiyat = sayiAl(b.birim_fiyat);
  const cariId = b.cari_id ? Number(b.cari_id) : null;
  const aciklama = yazi(b.aciklama);
  // Sayımda fark saklanır ki hareket silinince geri alınabilsin
  const miktar = tip === 'sayim' ? yuvarla(girilen - u.stok) : girilen;
  const h = { id: yeniId('stokHareket'), urun_id: u.id, tarih, tip, miktar, birim_fiyat: fiyat, cari_id: cariId, aciklama };
  veri.stokHareketler.push(h);
  u.stok = yuvarla(u.stok + (tip === 'cikis' ? -miktar : miktar));
  if (cariId && b.cariye_yaz && fiyat > 0 && tip !== 'sayim') {
    const acik = `${u.ad} x ${miktar} ${u.birim}` + (aciklama ? ` - ${aciklama}` : '');
    veri.cariHareketler.push({
      id: yeniId('cariHareket'), cari_id: cariId, tarih, tip: tip === 'cikis' ? 'borc' : 'alacak',
      tutar: Math.round(miktar * fiyat * 100) / 100, aciklama: (tip === 'cikis' ? 'Satış: ' : 'Alış: ') + acik, stok_hareket_id: h.id,
    });
  }
  return { tamam: true };
});

yol('DELETE', '/stok-hareket/:id', p => {
  const h = veri.stokHareketler.find(x => x.id === Number(p.id)) || hataVer('Hareket bulunamadı');
  const u = veri.urunler.find(x => x.id === h.urun_id);
  if (u) u.stok = yuvarla(u.stok + (h.tip === 'cikis' ? h.miktar : -h.miktar));
  veri.cariHareketler = veri.cariHareketler.filter(x => x.stok_hareket_id !== h.id);
  veri.stokHareketler = veri.stokHareketler.filter(x => x !== h);
  return { tamam: true };
});

yol('GET', '/ayarlar', () => ({ ...veri.ayarlar }));

yol('PUT', '/ayarlar', (p, q, b) => {
  for (const k of ['dukkan_adi', 'uyari_telefon']) if (k in b) veri.ayarlar[k] = yazi(b[k]);
  return { tamam: true };
});

yol('GET', '/bildirimler', () => veri.bildirimler.slice(0, 50));

// ---------- Dışarıya açılan işlevler ----------

const DEGISTIRENLER = new Set(['POST', 'PUT', 'DELETE']);
const STOK_ETKILI = /^\/(urunler|stok-hareket)/;

// Değişiklikten sonra yeni kritik ürün çıkarsa kritikUyari(urunler, metin) çağrılır.
let kritikUyari = () => {};

async function yerelApi(adres, { method = 'GET', body } = {}) {
  await veriYukle();
  const u = new URL(adres, 'http://yerel');
  for (const y of yollar) {
    if (y.yontem !== method) continue;
    const m = u.pathname.match(y.re);
    if (!m) continue;
    const p = Object.fromEntries(y.anahtarlar.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (!DEGISTIRENLER.has(method)) return kopya(y.isle(p, u.searchParams, body || {}));
    const yedek = JSON.stringify(veri);
    try {
      const sonuc = y.isle(p, u.searchParams, body || {});
      let yeniKritik = [];
      if (STOK_ETKILI.test(u.pathname)) {
        yeniKritik = kritikKontrol();
        if (yeniKritik.length) bildirimLogla('telefon', 'gösterildi', yeniKritik.length === 1 ? `Kritik stok: ${yeniKritik[0].ad}` : `Kritik stok: ${yeniKritik.length} ürün`);
      }
      await veriKaydet();
      if (yeniKritik.length) setTimeout(() => kritikUyari(kopya(yeniKritik), kritikMetni(yeniKritik)), 0);
      return kopya(sonuc);
    } catch (e) {
      veri = JSON.parse(yedek);
      throw e;
    }
  }
  throw new Error('Bilinmeyen işlem: ' + adres);
}

const Yerel = {
  api: yerelApi,
  kritikUyariAyarla: fn => (kritikUyari = fn),
  kritikMetni: urunler => kritikMetni(urunler),

  async yedekMetni() {
    await veriYukle();
    veri.ayarlar.son_yedek = simdi();
    await veriKaydet();
    return JSON.stringify({ uygulama: 'dukkan-takip', ...veri });
  },

  async yedektenYukle(metin) {
    let gelen;
    try { gelen = JSON.parse(metin); } catch { hataVer('Dosya okunamadı. Doğru yedek dosyasını seçtiğinizden emin olun.'); }
    if (!gelen || gelen.uygulama !== 'dukkan-takip' || !Array.isArray(gelen.urunler)) hataVer('Bu dosya Dükkan Takip yedeği değil.');
    delete gelen.uygulama;
    veri = Object.assign(bosVeri(), gelen);
    await veriKaydet();
    return { cari: veri.cariler.length, urun: veri.urunler.length };
  },

  async csv(tur) {
    await veriYukle();
    if (tur === 'cariler') {
      const s = [...veri.cariler].sort(adSirala).map(c => ({ ...c, tur: c.tur === 'tedarikci' ? 'Tedarikçi' : 'Müşteri', bakiye: bakiye(c.id) }));
      return csvYap([['ad', 'Ad'], ['tur', 'Tür'], ['telefon', 'Telefon'], ['email', 'E-posta'], ['adres', 'Adres'], ['vergi_no', 'Vergi No'], ['bakiye', 'Bakiye (+ bize borçlu)']], s);
    }
    return csvYap([['kod', 'Kod'], ['ad', 'Ad'], ['marka', 'Marka'], ['raf', 'Raf'], ['birim', 'Birim'], ['stok', 'Stok'], ['kritik', 'Kritik'], ['alis_fiyat', 'Alış'], ['satis_fiyat', 'Satış']],
      [...veri.urunler].sort(adSirala));
  },

  async kritikSayisi() {
    await veriYukle();
    return veri.urunler.filter(kritikMi).length;
  },
};
