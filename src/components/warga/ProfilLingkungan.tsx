import { useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  Check,
  ChevronRight,
  Copy,
  List,
  MapPin,
  MessageCircle,
  Network,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  SUSUNAN_PENGURUS,
  type AdminJabatan,
  type PengurusItem,
  type Warga,
} from '../../types';
import { buildWhatsAppLink, copyToClipboard, formatBlokRumah } from '../../lib/format';
import { useAppBrand } from '../../lib/brandContext';
import { buildAvatarKey, useAvatarMap } from '../../lib/avatarService';
import { UserAvatar } from '../UserAvatar';

interface PengurusProfileDetail extends PengurusItem {
  inisial: string;
  peranSingkat: string;
  deskripsiTugas: string;
  tanggungJawab: string[];
  layananWarga: string[];
  keteranganLokasi: string;
}

const JABATAN_ORDER: AdminJabatan[] = [
  'Pembina',
  'Ketua',
  'Bendahara',
  'Humas',
  'Seksi Olahraga',
];

const PENGURUS_DETAILS_MAP: Record<string, Omit<PengurusProfileDetail, keyof PengurusItem>> = {
  bpiwan: {
    inisial: 'IW',
    peranSingkat: 'Penasihat & Pengawas Kebijakan Lingkungan',
    deskripsiTugas:
      'Memberikan arahan strategis bagi pengurus, mendampingi penyelesaian musyawarah warga, serta mengawasi keberlanjutan program lingkungan Perumahan Saung Kebun.',
    tanggungJawab: [
      'Pembinaan dan pengawasan program kerja kepengurusan lingkungan',
      'Mediasi musyawarah warga dan pertimbangan kebijakan bersama',
      'Menerima titip setoran tunai IPL dan meneruskannya ke Bendahara',
    ],
    layananWarga: [
      'Konsultasi kebijakan & masukan pengembangan lingkungan',
      'Titip setoran tunai IPL warga',
    ],
    keteranganLokasi: 'Kediaman Blok B8/5',
  },
  erlangga: {
    inisial: 'ER',
    peranSingkat: 'Koordinator Utama Pengurus & Sekretariat',
    deskripsiTugas:
      'Memimpin koordinasi harian kepengurusan Perumahan Saung Kebun, memimpin rapat rutin warga, serta mengelola administrasi dan operasional lingkungan.',
    tanggungJawab: [
      'Koordinator seluruh bidang kepengurusan dan kegiatan kerja bakti',
      'Penyelenggara pertemuan rutin dan administrasi sekretariat warga',
      'Menerima titip setoran tunai IPL dan pencatatan data warga baru',
    ],
    layananWarga: [
      'Koordinasi administrasi lingkungan & surat pengantar warga',
      'Penjadwalan kegiatan gotong royong & rapat warga',
      'Titip setoran tunai IPL di Sekretariat Blok B3/7',
    ],
    keteranganLokasi: 'Sekretariat · Blok B3/7',
  },
  andriansyah: {
    inisial: 'AN',
    peranSingkat: 'Pengelola Kas IPL, Verifikasi & QRIS Resmi',
    deskripsiTugas:
      'Bertanggung jawab atas pencatatan kas lingkungan, verifikasi bukti transfer/QRIS warga, pengelolaan nomor rekening resmi, serta transparansi laporan keuangan bulanan.',
    tanggungJawab: [
      'Verifikasi seluruh bukti pembayaran IPL (QRIS, Transfer Bank, E-Wallet, Tunai)',
      'Pengelolaan QRIS resmi, rekening kas lingkungan, dan penerbitan kwitansi sah',
      'Penyusunan rekap kas operasional kebersihan, keamanan, dan dana sosial',
    ],
    layananWarga: [
      'Konfirmasi verifikasi pembayaran & status e-Card bulanan',
      'Informasi rekening kas resmi, QRIS, serta setoran tunai langsung',
      'Koreksi data unit rumah & permintaan reset PIN akses warga',
    ],
    keteranganLokasi: 'Kediaman Blok B7/16',
  },
  doni: {
    inisial: 'DN',
    peranSingkat: 'Komunikasi Warga & Informasi Lingkungan',
    deskripsiTugas:
      'Menjadi penghubung informasi antara pengurus dan warga antar blok, menyebarkan pengumuman kegiatan, serta menghimpun aspirasi dan laporan fasilitas umum.',
    tanggungJawab: [
      'Penyampaian pengumuman jadwal perawatan, keamanan, dan agenda warga',
      'Menampung masukan serta laporan kendala fasilitas di area Blok B3–B8',
      'Menerima titip setoran tunai IPL warga untuk diteruskan ke Bendahara',
    ],
    layananWarga: [
      'Laporan kendala penerangan jalan, saluran air, atau fasilitas umum',
      'Informasi agenda kegiatan warga & koordinasi antar blok',
      'Titip setoran tunai IPL warga',
    ],
    keteranganLokasi: 'Kediaman Blok B5/21',
  },
  wahyu: {
    inisial: 'WH',
    peranSingkat: 'Hubungan Masyarakat & Koordinasi Sosial',
    deskripsiTugas:
      'Mendukung penyebaran informasi lingkungan, koordinasi kegiatan sosial kemasyarakatan, serta memastikan komunikasi warga di tiap blok berjalan lancar.',
    tanggungJawab: [
      'Koordinasi kegiatan sosial warga dan penyebaran informasi lingkungan',
      'Pendampingan komunikasi bagi warga baru di Perumahan Saung Kebun',
      'Menerima titip setoran tunai IPL warga untuk diteruskan ke Bendahara',
    ],
    layananWarga: [
      'Koordinasi kegiatan sosial & komunikasi warga baru',
      'Penyampaian aspirasi warga kepada jajaran pengurus',
      'Titip setoran tunai IPL warga',
    ],
    keteranganLokasi: 'Kediaman Blok B5/24',
  },
  deny: {
    inisial: 'DY',
    peranSingkat: 'Koordinator Olahraga & Kegiatan Kebugaran',
    deskripsiTugas:
      'Menggerakkan kegiatan olahraga rutin warga untuk mempererat silaturahmi antar blok serta menjaga pemanfaatan fasilitas olahraga lingkungan.',
    tanggungJawab: [
      'Penjadwalan kegiatan olahraga rutin dan turnamen persahabatan antar blok',
      'Koordinasi perawatan perlengkapan dan area olahraga lingkungan',
      'Menerima titip setoran tunai IPL warga untuk diteruskan ke Bendahara',
    ],
    layananWarga: [
      'Pendaftaran jadwal olahraga rutin & kegiatan kebugaran warga',
      'Usulan turnamen atau kegiatan kebersamaan antar blok',
      'Titip setoran tunai IPL warga',
    ],
    keteranganLokasi: 'Kediaman Blok B8/6',
  },
};

const ENRICHED_PENGURUS: PengurusProfileDetail[] = SUSUNAN_PENGURUS.map((item) => {
  const detail = PENGURUS_DETAILS_MAP[item.username] || {
    inisial: item.nama.slice(0, 2).toUpperCase(),
    peranSingkat: `Pengurus Bidang ${item.jabatan}`,
    deskripsiTugas: `Melayani koordinasi warga Perumahan Saung Kebun pada bidang ${item.jabatan}.`,
    tanggungJawab: ['Koordinasi kegiatan lingkungan dan pelayanan warga'],
    layananWarga: ['Koordinasi lingkungan & titip setoran tunai IPL'],
    keteranganLokasi: `Blok ${formatBlokRumah(item.blokRumah) || item.blokRumah}`,
  };
  return { ...item, ...detail };
});

const RINGKASAN_WILAYAH = [
  { label: 'Total Unit Terdaftar', nilai: '109 Unit', sub: 'Blok B3, B5, B6, B7 & B8' },
  { label: 'Susunan Pengurus', nilai: '6 Orang', sub: '5 Bidang Kepengurusan' },
  { label: 'Sekretariat', nilai: 'Blok B3/7', sub: 'Perumahan Saung Kebun' },
  { label: 'Jatuh Tempo IPL', nilai: 'Tanggal 7', sub: 'Setiap bulan berjalan' },
];

interface ProfilLingkunganProps {
  profil: Warga;
  onSelectTitipPengurus: (petugasLabel: string) => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function ProfilLingkungan({
  profil,
  onSelectTitipPengurus,
  onToast,
}: ProfilLingkunganProps) {
  const { brand } = useAppBrand();
  const avatarMap = useAvatarMap();
  const [viewMode, setViewMode] = useState<'daftar' | 'struktur'>('daftar');
  const [jabatanFilter, setJabatanFilter] = useState<'Semua' | AdminJabatan>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsername, setSelectedUsername] = useState<string>(
    ENRICHED_PENGURUS[1]?.username || ENRICHED_PENGURUS[0].username
  );
  const [copiedUsername, setCopiedUsername] = useState<string | null>(null);

  const filteredPengurus = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ENRICHED_PENGURUS.filter((p) => {
      if (jabatanFilter !== 'Semua' && p.jabatan !== jabatanFilter) return false;
      if (!q) return true;
      return (
        p.nama.toLowerCase().includes(q) ||
        p.jabatan.toLowerCase().includes(q) ||
        p.blokRumah.toLowerCase().includes(q) ||
        p.peranSingkat.toLowerCase().includes(q) ||
        p.deskripsiTugas.toLowerCase().includes(q) ||
        p.layananWarga.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [jabatanFilter, searchQuery]);

  const selectedPengurus = useMemo(() => {
    const match = ENRICHED_PENGURUS.find((p) => p.username === selectedUsername);
    if (match) return match;
    return filteredPengurus[0] || ENRICHED_PENGURUS[0];
  }, [selectedUsername, filteredPengurus]);

  const handleSelectPengurus = (username: string) => {
    setSelectedUsername(username);
  };

  const handleCopyLokasi = async (p: PengurusProfileDetail) => {
    const displayBlok = formatBlokRumah(p.blokRumah) || p.blokRumah;
    const text = `${p.nama} (${p.jabatan} Saung Kebun) — Blok ${displayBlok}`;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedUsername(p.username);
      onToast('success', `Info lokasi ${p.nama} (Blok ${displayBlok}) disalin.`);
      setTimeout(() => {
        setCopiedUsername((prev) => (prev === p.username ? null : prev));
      }, 2200);
    } else {
      onToast('error', 'Gagal menyalin ke clipboard.');
    }
  };

  const handleTitipTunai = (p: PengurusProfileDetail) => {
    const petugasLabel = `${p.nama} (${p.jabatan})`;
    onSelectTitipPengurus(petugasLabel);
  };

  const buildWaPengurusHref = (p: PengurusProfileDetail) => {
    const targetWa = brand.pengurus_wa_map?.[p.username] || brand.wa_pengurus;
    const displayBlok = formatBlokRumah(profil.blok_rumah) || profil.blok_rumah;
    const msg = `Halo ${p.nama} (${p.jabatan} Perumahan Saung Kebun), saya ${profil.nama_warga} dari Blok ${displayBlok}. Saya ingin berkoordinasi terkait keperluan lingkungan / iuran IPL.`;
    return buildWhatsAppLink(targetWa, msg);
  };

  const pembina = ENRICHED_PENGURUS.find((p) => p.jabatan === 'Pembina');
  const ketua = ENRICHED_PENGURUS.find((p) => p.jabatan === 'Ketua');
  const bendahara = ENRICHED_PENGURUS.find((p) => p.jabatan === 'Bendahara');
  const humasList = ENRICHED_PENGURUS.filter((p) => p.jabatan === 'Humas');
  const olahraga = ENRICHED_PENGURUS.find((p) => p.jabatan === 'Seksi Olahraga');

  return (
    <div className="space-y-6">
      {/* Header Identitas Lingkungan & Ringkasan */}
      <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-indigo-100/70">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold text-[#4C1D95]">
              Profil Lingkungan &amp; Kepengurusan Resmi
            </p>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0F172A] tracking-tight text-balance">
              Perumahan Saung Kebun
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
              Desa Bengle, Kec. Majalaya, Kab. Karawang · Informasi resmi jajaran pengurus
              lingkungan, lokasi unit pengurus, dan layanan koordinasi bagi seluruh warga.
            </p>
          </div>

          {/* Toggle Tampilan: Daftar vs Bagan Struktur */}
          <div
            role="tablist"
            aria-label="Mode Tampilan Susunan Pengurus"
            className="inline-flex items-center gap-1 p-1 bg-indigo-50/80 border border-indigo-100/80 rounded-2xl self-start lg:self-center shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'daftar'}
              onClick={() => setViewMode('daftar')}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                viewMode === 'daftar'
                  ? 'bg-[#4C1D95] text-white shadow-xs'
                  : 'text-slate-600 hover:text-[#4C1D95]'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Daftar Pengurus</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'struktur'}
              onClick={() => setViewMode('struktur')}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                viewMode === 'struktur'
                  ? 'bg-[#4C1D95] text-white shadow-xs'
                  : 'text-slate-600 hover:text-[#4C1D95]'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Bagan Struktur</span>
            </button>
          </div>
        </div>

        {/* 4 Ringkasan Wilayah (Flat Hairline Grid, Tabular Numerals) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-indigo-100/60 bg-indigo-50/40">
          {RINGKASAN_WILAYAH.map((item) => (
            <div key={item.label} className="px-5 py-4">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="text-base sm:text-lg font-bold text-[#0F172A] font-mono tabular-nums mt-0.5">
                {item.nilai}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{item.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Toolbar Filter Jabatan & Pencarian (Aktif pada mode Daftar) */}
      {viewMode === 'daftar' && (
        <section
          aria-label="Filter dan Pencarian Pengurus"
          className="flex flex-col md:flex-row md:items-center justify-between gap-3"
        >
          {/* Segmented Filter Jabatan */}
          <div className="flex items-center gap-1 p-1 bg-indigo-50/80 border border-indigo-100/80 rounded-2xl overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setJabatanFilter('Semua')}
              className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                jabatanFilter === 'Semua'
                  ? 'bg-[#4C1D95] text-white shadow-xs'
                  : 'text-slate-600 hover:text-[#4C1D95]'
              }`}
            >
              Semua ({ENRICHED_PENGURUS.length})
            </button>
            {JABATAN_ORDER.map((jabatan) => {
              const count = ENRICHED_PENGURUS.filter((p) => p.jabatan === jabatan).length;
              const active = jabatanFilter === jabatan;
              return (
                <button
                  key={jabatan}
                  type="button"
                  onClick={() => setJabatanFilter(jabatan)}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'bg-[#4C1D95] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#4C1D95]'
                  }`}
                >
                  {jabatan} ({count})
                </button>
              );
            })}
          </div>

          {/* Input Pencarian */}
          <div className="relative w-full md:w-72 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, bidang, blok..."
              aria-label="Cari pengurus Saung Kebun"
              className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 pl-10 pr-10 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Hapus pencarian"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-[#4C1D95] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </section>
      )}

      {/* Area Utama: Master (Kiri 7 Kolom) + Detail Interaktif (Kanan 5 Kolom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Kolom Kiri: Daftar Interaktif atau Bagan Struktur */}
        <div className="lg:col-span-7">
          {viewMode === 'daftar' ? (
            filteredPengurus.length === 0 ? (
              <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-8 text-center">
                <Users className="w-8 h-8 text-indigo-300 mx-auto" />
                <p className="text-sm font-semibold text-[#0F172A] mt-3">
                  Pengurus tidak ditemukan
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Tidak ada pengurus yang cocok dengan kata kunci &ldquo;{searchQuery}&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setJabatanFilter('Semua');
                  }}
                  className="mt-4 min-h-[40px] px-5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Tampilkan Semua Pengurus
                </button>
              </div>
            ) : (
              <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden divide-y divide-indigo-100/60">
                {filteredPengurus.map((p) => {
                  const isSelected = selectedPengurus.username === p.username;
                  return (
                    <button
                      key={p.username}
                      type="button"
                      onClick={() => handleSelectPengurus(p.username)}
                      aria-pressed={isSelected}
                      className={`w-full text-left px-5 py-4 flex items-center gap-4 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4C1D95] ${
                        isSelected ? 'bg-indigo-50/75' : 'bg-transparent hover:bg-indigo-50/40'
                      }`}
                    >
                      {/* Foto Profil / Inisial Pengurus */}
                      <UserAvatar
                        name={p.nama}
                        src={avatarMap[buildAvatarKey('admin', p.username)] || null}
                        size="md"
                        ringClassName={isSelected ? 'ring-2 ring-[#4C1D95]' : 'ring-1 ring-indigo-100'}
                      />

                      {/* Identitas Utama (Zero-Pill Metadata) */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm sm:text-base font-bold text-[#0F172A] truncate">
                            {p.nama}
                          </span>
                          <span aria-hidden="true" className="text-indigo-200 text-xs">
                            ·
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              p.permission === 'full' ? 'text-[#4C1D95]' : 'text-slate-600'
                            }`}
                          >
                            {p.jabatan}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                          {p.peranSingkat}
                        </p>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-1.5">
                          <span className="font-mono font-semibold text-slate-700 tabular-nums">
                            Blok {formatBlokRumah(p.blokRumah) || p.blokRumah}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {p.permission === 'full'
                              ? 'Verifikasi Kas & QRIS'
                              : 'Penerima Titip IPL'}
                          </span>
                        </div>
                      </div>

                      {/* Indikator Pilih */}
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 transition-transform ${
                          isSelected
                            ? 'text-[#4C1D95] translate-x-0.5'
                            : 'text-slate-400'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            /* Bagan Struktur Organisasi Interaktif */
            <section
              aria-label="Bagan Struktur Pengurus Saung Kebun"
              className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6"
            >
              <div className="mb-5">
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Struktur Kepengurusan Saung Kebun
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pilih salah satu posisi pengurus pada bagan untuk melihat rincian tugas dan aksi
                  layanan warga.
                </p>
              </div>

              <div className="flex flex-col items-center">
                {/* Tingkat 1: Pembina */}
                {pembina && (
                  <OrgNodeButton
                    pengurus={pembina}
                    avatarUrl={avatarMap[buildAvatarKey('admin', pembina.username)] || null}
                    selected={selectedPengurus.username === pembina.username}
                    onSelect={handleSelectPengurus}
                    className="w-full max-w-xs"
                  />
                )}

                {/* Garis Penghubung Vertikal */}
                <div aria-hidden="true" className="w-px h-6 bg-slate-200" />

                {/* Tingkat 2: Ketua */}
                {ketua && (
                  <OrgNodeButton
                    pengurus={ketua}
                    avatarUrl={avatarMap[buildAvatarKey('admin', ketua.username)] || null}
                    selected={selectedPengurus.username === ketua.username}
                    onSelect={handleSelectPengurus}
                    className="w-full max-w-xs"
                  />
                )}

                {/* Garis Penghubung Cabang ke 3 Bidang */}
                <div aria-hidden="true" className="w-px h-6 bg-slate-200" />
                <div
                  aria-hidden="true"
                  className="hidden sm:block w-2/3 h-px bg-slate-200"
                />

                {/* Tingkat 3: Bendahara, Humas (2), Seksi Olahraga */}
                <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-0 sm:mt-4">
                  {/* Bendahara */}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-slate-500 sm:text-center pt-2 sm:pt-0">
                      Keuangan &amp; Kas IPL
                    </p>
                    {bendahara && (
                      <OrgNodeButton
                        pengurus={bendahara}
                        avatarUrl={avatarMap[buildAvatarKey('admin', bendahara.username)] || null}
                        selected={selectedPengurus.username === bendahara.username}
                        onSelect={handleSelectPengurus}
                      />
                    )}
                  </div>

                  {/* Humas (Doni & Wahyu) */}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-slate-500 sm:text-center pt-2 sm:pt-0">
                      Hubungan Masyarakat
                    </p>
                    <div className="space-y-2.5">
                      {humasList.map((h) => (
                        <OrgNodeButton
                          key={h.username}
                          pengurus={h}
                          avatarUrl={avatarMap[buildAvatarKey('admin', h.username)] || null}
                          selected={selectedPengurus.username === h.username}
                          onSelect={handleSelectPengurus}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Seksi Olahraga */}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-slate-500 sm:text-center pt-2 sm:pt-0">
                      Kegiatan Olahraga
                    </p>
                    {olahraga && (
                      <OrgNodeButton
                        pengurus={olahraga}
                        avatarUrl={avatarMap[buildAvatarKey('admin', olahraga.username)] || null}
                        selected={selectedPengurus.username === olahraga.username}
                        onSelect={handleSelectPengurus}
                      />
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Kolom Kanan: Panel Detail Pengurus Terpilih */}
        <aside className="lg:col-span-5 lg:sticky lg:top-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.section
              key={selectedPengurus.username}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              aria-label={`Detail Pengurus ${selectedPengurus.nama}`}
              className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden"
            >
              {/* Header Detail */}
              <div className="p-5 sm:p-6 border-b border-indigo-100/70">
                <div className="flex items-start gap-4">
                  <UserAvatar
                    name={selectedPengurus.nama}
                    src={avatarMap[buildAvatarKey('admin', selectedPengurus.username)] || null}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[#4C1D95]">
                      {selectedPengurus.jabatan} · Perumahan Saung Kebun
                    </p>
                    <h3 className="text-lg font-bold text-[#0F172A] mt-0.5 truncate">
                      {selectedPengurus.nama}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-[#4C1D95] shrink-0" />
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">
                        {selectedPengurus.keteranganLokasi}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-slate-600 leading-relaxed mt-4">
                  {selectedPengurus.deskripsiTugas}
                </p>
              </div>

              {/* Peran Portal & Daftar Tugas */}
              <div className="p-5 sm:p-6 space-y-5">
                <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-indigo-50/60 border border-indigo-100">
                  <ShieldCheck className="w-4 h-4 text-[#4C1D95] shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-semibold text-[#0F172A]">
                      {selectedPengurus.permission === 'full'
                        ? 'Wewenang Keuangan Penuh'
                        : 'Wewenang Pendampingan & Penerima Titip IPL'}
                    </span>
                    <span className="block mt-0.5">
                      {selectedPengurus.permission === 'full'
                        ? 'Mengelola verifikasi pembayaran IPL, QRIS resmi, nomor rekening kas, dan pembaruan data warga.'
                        : 'Menerima titip setoran tunai IPL warga, mencatat warga baru, serta menyampaikan pengumuman lingkungan.'}
                    </span>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-500 mb-2">
                    Tugas &amp; Tanggung Jawab Utama
                  </h4>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {selectedPengurus.tanggungJawab.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 leading-relaxed">
                        <span
                          aria-hidden="true"
                          className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 shrink-0"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-4 border-t border-indigo-100/70">
                  <h4 className="text-xs font-semibold text-slate-500 mb-2">
                    Layanan untuk Warga
                  </h4>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {selectedPengurus.layananWarga.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 leading-relaxed">
                        <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Tombol Aksi Fungsional */}
                <div className="pt-4 border-t border-indigo-100/70 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => handleTitipTunai(selectedPengurus)}
                    className="w-full min-h-[46px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                  >
                    <Banknote className="w-4 h-4 shrink-0 text-[#A7F3D0]" />
                    <span className="truncate">
                      Titip Setor Tunai ke {selectedPengurus.nama}
                    </span>
                  </button>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <a
                      href={buildWaPengurusHref(selectedPengurus)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-[#0F172A] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>WhatsApp Pengurus</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => void handleCopyLokasi(selectedPengurus)}
                      className="min-h-[44px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-[#0F172A] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {copiedUsername === selectedPengurus.username ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Blok Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 text-[#4C1D95] shrink-0" />
                          <span>Salin Blok {formatBlokRumah(selectedPengurus.blokRumah) || selectedPengurus.blokRumah}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.section>
          </AnimatePresence>

          {/* Catatan Sekretariat */}
          <div className="mt-4 px-1 flex items-start gap-2.5 text-xs text-slate-500 leading-relaxed">
            <Building2 className="w-4 h-4 text-[#4C1D95] shrink-0 mt-0.5" />
            <p>{brand.kop_resmi}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

interface OrgNodeButtonProps {
  pengurus: PengurusProfileDetail;
  avatarUrl?: string | null;
  selected: boolean;
  onSelect: (username: string) => void;
  className?: string;
}

function OrgNodeButton({
  pengurus,
  avatarUrl,
  selected,
  onSelect,
  className = '',
}: OrgNodeButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pengurus.username)}
      aria-pressed={selected}
      className={`text-left rounded-2xl border p-3.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4C1D95] ${
        selected
          ? 'border-[#4C1D95] bg-indigo-50/80 ring-1 ring-[#4C1D95]/20'
          : 'border-indigo-100/80 bg-white/90 hover:border-indigo-300 hover:bg-indigo-50/40'
      } ${className}`}
    >
      <div className="flex items-center gap-3">
        <UserAvatar
          name={pengurus.nama}
          src={avatarUrl || null}
          size="sm"
          ringClassName={selected ? 'ring-2 ring-[#4C1D95]' : 'ring-1 ring-indigo-100'}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-[#4C1D95] truncate">
            {pengurus.jabatan}
          </p>
          <p className="text-sm font-bold text-[#0F172A] truncate">{pengurus.nama}</p>
          <p className="text-xs font-mono text-slate-500 tabular-nums">
            Blok {formatBlokRumah(pengurus.blokRumah) || pengurus.blokRumah}
          </p>
        </div>
      </div>
    </button>
  );
}
