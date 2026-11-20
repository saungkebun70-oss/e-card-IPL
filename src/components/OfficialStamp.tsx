import { useAppBrand } from '../lib/brandContext';

interface OfficialStampProps {
  srcOverride?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  unstyledTransform?: boolean;
}

const SIZE_MAP = {
  sm: 'w-20 h-20',
  md: 'w-24 h-24',
  lg: 'w-28 h-28',
} as const;

export function OfficialStamp({
  srcOverride,
  size = 'md',
  className = '',
  unstyledTransform = false,
}: OfficialStampProps) {
  const { brand } = useAppBrand();
  const resolvedSrc = srcOverride !== undefined ? srcOverride : brand.stempel_url;
  const defaultVisualClass = unstyledTransform ? '' : 'opacity-85 -rotate-6';

  if (resolvedSrc) {
    return (
      <img
        src={resolvedSrc}
        alt="Stempel Resmi Pengurus Lingkungan Perumahan Saung Kebun"
        referrerPolicy="no-referrer"
        className={`${SIZE_MAP[size]} object-contain ${defaultVisualClass} select-none pointer-events-none ${className}`}
      />
    );
  }

  // Fallback stempel vektor resmi transparan (SVG) bila gambar PNG belum diunggah
  return (
    <svg
      viewBox="0 0 140 140"
      aria-label="Stempel Resmi Pengurus Lingkungan Perumahan Saung Kebun"
      className={`${SIZE_MAP[size]} ${defaultVisualClass} select-none pointer-events-none text-[#059669] ${className}`}
    >
      <defs>
        <path id="stampTopArc" d="M 22,70 A 48,48 0 1,1 118,70" />
        <path id="stampBottomArc" d="M 118,70 A 48,48 0 1,1 22,70" />
      </defs>
      <circle
        cx="70"
        cy="70"
        r="64"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
      />
      <circle
        cx="70"
        cy="70"
        r="58"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeDasharray="3 2"
      />
      <circle
        cx="70"
        cy="70"
        r="40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <line x1="20" y1="54" x2="120" y2="54" stroke="currentColor" strokeWidth="1.4" />
      <line x1="20" y1="86" x2="120" y2="86" stroke="currentColor" strokeWidth="1.4" />

      <text
        fill="currentColor"
        fontSize="8.8"
        fontWeight="700"
        letterSpacing="1.3"
      >
        <textPath href="#stampTopArc" startOffset="50%" textAnchor="middle">
          PENGURUS LINGKUNGAN
        </textPath>
      </text>

      <text
        x="70"
        y="67"
        textAnchor="middle"
        fill="currentColor"
        fontSize="11.5"
        fontWeight="800"
        letterSpacing="0.8"
      >
        SAUNG KEBUN
      </text>
      <text
        x="70"
        y="79.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="7.8"
        fontWeight="700"
        letterSpacing="1.1"
      >
        VERIFIKASI SAH
      </text>

      <text
        fill="currentColor"
        fontSize="8.2"
        fontWeight="700"
        letterSpacing="1.4"
      >
        <textPath href="#stampBottomArc" startOffset="50%" textAnchor="middle">
          MAJALAYA · KARAWANG
        </textPath>
      </text>
    </svg>
  );
}
