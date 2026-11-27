interface RoleApprovalStampProps {
  role: 'ketua' | 'bendahara';
  className?: string;
}

export function RoleApprovalStamp({ role, className = '' }: RoleApprovalStampProps) {
  const isKetua = role === 'ketua';
  const topLabel = 'PENGURUS LINGKUNGAN';
  const mainLabel = isKetua ? 'KETUA' : 'BENDAHARA';
  const bottomLabel = isKetua ? 'SAUNG KEBUN · DISAHKAN' : 'SAUNG KEBUN · TERVERIFIKASI';
  const colorClass = isKetua ? 'text-[#243825]' : 'text-[#384E35]';
  const tiltClass = isKetua ? '-rotate-[4deg]' : 'rotate-[3deg]';

  return (
    <svg
      viewBox="0 0 186 70"
      aria-label={isKetua ? 'Cap Pengesahan Ketua Lingkungan' : 'Cap Verifikasi Bendahara Lingkungan'}
      className={`w-[120px] sm:w-[144px] print:w-[144px] h-auto ${colorClass} ${tiltClass} opacity-90 mix-blend-multiply select-none pointer-events-none ${className}`}
    >
      {/* Bingkai luar cap resmi */}
      <rect
        x="3"
        y="3"
        width="180"
        height="64"
        rx="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      {/* Bingkai dalam tipis bergaya stempel kantor */}
      <rect
        x="7"
        y="7"
        width="172"
        height="56"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.95"
        strokeDasharray="3 1.5"
      />

      {/* Garis pemisah horizontal tipis */}
      <line x1="14" y1="22" x2="172" y2="22" stroke="currentColor" strokeWidth="0.85" />
      <line x1="14" y1="48" x2="172" y2="48" stroke="currentColor" strokeWidth="0.85" />

      {/* Aksen bintang/titik kiri & kanan */}
      <circle cx="17" cy="35" r="2.2" fill="currentColor" />
      <circle cx="169" cy="35" r="2.2" fill="currentColor" />

      {/* Teks organisasi atas */}
      <text
        x="93"
        y="17.2"
        textAnchor="middle"
        fill="currentColor"
        fontSize="7.4"
        fontWeight="700"
        letterSpacing="1.3"
      >
        {topLabel}
      </text>

      {/* Jabatan utama stempel */}
      <text
        x="93"
        y="40"
        textAnchor="middle"
        fill="currentColor"
        fontSize={isKetua ? '16.5' : '15'}
        fontWeight="900"
        letterSpacing="1.8"
      >
        {mainLabel}
      </text>

      {/* Keterangan bawah */}
      <text
        x="93"
        y="58.2"
        textAnchor="middle"
        fill="currentColor"
        fontSize="6.9"
        fontWeight="700"
        letterSpacing="0.9"
      >
        {bottomLabel}
      </text>
    </svg>
  );
}
