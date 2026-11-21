import React, { useId } from 'react';

export interface SecurityWalkerIconProps {
  /** Jalankan animasi berjalan (sec-walker--walking) saat aktif/bergerak; pose tegap (sec-walker--idle) saat standby */
  isWalking?: boolean;
  /** Membalikkan karakter secara horizontal via transform: scaleX(-1) saat petugas bergerak ke arah kiri/berlawanan */
  isFlipped?: boolean;
  /** Opsional: alternatif deklaratif arah hadap ('right' | 'left') */
  facing?: 'right' | 'left';
  /** Ukuran ikon dalam piksel (rekomendasi 36–44px) */
  size?: number;
  /** Mode warna aksen saat patroli live aktif vs standby */
  isLive?: boolean;
  className?: string;
}

/**
 * Ikon karakter Petugas Keamanan (Satpam) berseragam tampak 3/4 samping dengan animasi berjalan CSS 60fps.
 * - Tanpa library eksternal (100% inline SVG + CSS keyframes di index.css).
 * - Dilengkapi outline putih tipis + drop-shadow halus agar kontras tinggi di atas peta 3D/satelit.
 * - Bagian tubuh dipisah ke grup <g> (left-arm, left-leg, right-leg, body, head, right-arm) untuk walking cycle natural.
 */
export const SecurityWalkerIcon: React.FC<SecurityWalkerIconProps> = ({
  isWalking = false,
  isFlipped,
  facing = 'right',
  size = 42,
  isLive = true,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const outlineFilterId = `sec-walker-outline-${uid}`;
  const flipped = typeof isFlipped === 'boolean' ? isFlipped : facing === 'left';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`block overflow-visible select-none ${
        isWalking ? 'sec-walker--walking' : 'sec-walker--idle'
      } ${className}`}
      style={{
        transform: flipped ? 'scaleX(-1)' : 'scaleX(1)',
        transition: 'transform 220ms ease-out',
      }}
    >
      <defs>
        {/* Outline putih tipis + drop-shadow halus agar karakter menonjol jelas di atas peta satelit/3D */}
        <filter
          id={outlineFilterId}
          x="-28%"
          y="-22%"
          width="156%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feMorphology
            in="SourceAlpha"
            operator="dilate"
            radius="1.35"
            result="expandedAlpha"
          />
          <feFlood floodColor="#FFFFFF" floodOpacity="0.96" result="whiteFlood" />
          <feComposite
            in="whiteFlood"
            in2="expandedAlpha"
            operator="in"
            result="whiteOutline"
          />
          <feDropShadow
            in="whiteOutline"
            dx="0"
            dy="1.5"
            stdDeviation="1.4"
            floodColor="#0F172A"
            floodOpacity="0.52"
            result="outlinedWithShadow"
          />
          <feMerge>
            <feMergeNode in="outlinedWithShadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Bayangan elips tipis di bawah kaki yang membesar-mengecil halus mengikuti langkah */}
      <g
        data-part="ground-shadow"
        className="sec-walker-shadow"
        style={{ transformOrigin: '24px 44.2px' }}
      >
        <ellipse cx="24" cy="44.2" rx="8.5" ry="2.4" fill="#0F172A" fillOpacity="0.42" />
      </g>

      {/* Karakter Satpam Berartikulasi */}
      <g filter={`url(#${outlineFilterId})`}>
        {/* Grup Bobbing (Naik-turun halus mengikuti ritme langkah) */}
        <g data-part="bob-root" className="sec-walker-bob">
          {/* 1. LENGAN BELAKANG (left-arm) */}
          <g
            data-part="left-arm"
            className="sec-walker-arm-left"
            style={{ transformOrigin: '22px 21.5px' }}
          >
            {/* Lengan seragam khaki gelap (belakang) */}
            <path
              d="M21.2 21.4 L18.2 29.2"
              stroke="#BFA780"
              strokeWidth="3.6"
              strokeLinecap="round"
            />
            {/* Manset navy */}
            <path
              d="M18.9 27.5 L18.2 29.2"
              stroke="#1E3A5F"
              strokeWidth="3.6"
              strokeLinecap="round"
            />
            {/* Tangan */}
            <circle cx="17.7" cy="30.2" r="1.75" fill="#E6B28A" />
          </g>

          {/* 2. KAKI BELAKANG (left-leg) */}
          <g
            data-part="left-leg"
            className="sec-walker-leg-left"
            style={{ transformOrigin: '22.8px 31.2px' }}
          >
            {/* Celana panjang navy gelap */}
            <path
              d="M22.8 31.2 L20.8 41.2"
              stroke="#1E293B"
              strokeWidth="4.3"
              strokeLinecap="round"
            />
            {/* Sepatu PDH hitam */}
            <path
              d="M18.8 41.4 H23.6 C24.3 41.4 24.8 41.9 24.8 42.6 V43.4 H18.5 C18.1 43.4 17.9 43.1 17.9 42.7 V42.2 C17.9 41.7 18.3 41.4 18.8 41.4 Z"
              fill="#090D16"
            />
          </g>

          {/* 3. KAKI DEPAN (right-leg) */}
          <g
            data-part="right-leg"
            className="sec-walker-leg-right"
            style={{ transformOrigin: '25px 31.2px' }}
          >
            {/* Celana panjang biru dongker */}
            <path
              d="M25 31.2 L26.6 41.2"
              stroke="#0F294A"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            {/* Garis lipatan halus celana */}
            <path
              d="M25.4 32.6 L26.5 39.8"
              stroke="#274C77"
              strokeWidth="1"
              strokeLinecap="round"
              opacity="0.7"
            />
            {/* Sepatu PDH hitam */}
            <path
              d="M24.6 41.4 H29.6 C30.4 41.4 31 42 31 42.7 V43.5 H24.2 C23.8 43.5 23.6 43.2 23.6 42.8 V42.2 C23.6 41.7 24.1 41.4 24.6 41.4 Z"
              fill="#0F172A"
            />
            {/* Aksen kilap sepatu */}
            <path
              d="M27.3 42.1 H29.5"
              stroke="#475569"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
          </g>

          {/* 4. BADAN / SERAGAM SATPAM (body) */}
          <g data-part="body" className="sec-walker-body">
            {/* Baju seragam Satpam khaki (cokelat muda) */}
            <path
              d="M19.8 20.2 C20.4 18.5 22 17.9 24.2 17.9 C26.6 17.9 28 18.7 28.4 20.5 L28.9 30.8 H19.4 L19.8 20.2 Z"
              fill="#D9C39E"
            />
            {/* Shading sisi belakang baju untuk kesan 3/4 */}
            <path
              d="M19.8 20.2 C20.3 18.7 21.5 18 22.8 18 L22.2 30.8 H19.4 L19.8 20.2 Z"
              fill="#C7AE84"
            />
            {/* Kerah & dasi navy */}
            <path d="M23.1 18.1 L25.6 20.7 L26.8 18.3 Z" fill="#0F294A" />
            <path d="M25.1 20.3 L25.8 25.8 L24.8 26.6 L24.3 20.3 Z" fill="#1E3A5F" />
            {/* Epaulet (pangkat bahu) navy */}
            <rect x="20.4" y="18.2" width="3.6" height="1.6" rx="0.7" fill="#0F294A" />
            {/* Saku dada & emblem kecil keamanan */}
            <rect
              x="25.6"
              y="22.4"
              width="2.6"
              height="2.2"
              rx="0.5"
              fill="#C7AE84"
              stroke="#9C845D"
              strokeWidth="0.5"
            />
            <circle cx="27" cy="21.4" r="0.95" fill="#F59E0B" />
            {/* Kopel / ikat pinggang hitam + gesper emas */}
            <rect x="19.1" y="29.3" width="10.1" height="2.4" rx="0.8" fill="#0F172A" />
            <rect x="25.2" y="29.6" width="2.3" height="1.8" rx="0.4" fill="#F59E0B" />
          </g>

          {/* 5. KEPALA & TOPI PET SATPAM (head) */}
          <g data-part="head" className="sec-walker-head">
            {/* Leher */}
            <rect x="22.8" y="15.8" width="2.8" height="2.5" rx="1" fill="#E5B189" />
            {/* Wajah tampak 3/4 */}
            <circle cx="24.5" cy="13.1" r="4.1" fill="#F2C49D" />
            {/* Rambut samping gelap */}
            <path
              d="M20.5 12.6 C20.4 10.6 21.8 9.4 23.8 9.4 L23 13.6 C22 13.8 21.2 13.5 20.5 12.6 Z"
              fill="#1E293B"
            />
            {/* Telinga */}
            <circle cx="21.5" cy="13.4" r="0.95" fill="#E5B189" />
            {/* Mata & ekspresi sigap */}
            <circle cx="26.5" cy="12.7" r="0.65" fill="#0F172A" />
            <path
              d="M25.8 11.4 L27.3 11.5"
              stroke="#1E293B"
              strokeWidth="0.7"
              strokeLinecap="round"
            />
            <path
              d="M26.2 14.9 C26.7 15.1 27.2 15 27.5 14.7"
              stroke="#A16244"
              strokeWidth="0.7"
              strokeLinecap="round"
            />
            {/* Topi Pet Keamanan (Navy Gelap) */}
            <path
              d="M19.4 9.7 C19.9 6.9 22.6 5.9 25.5 6.3 C27.8 6.6 29.2 7.8 29.1 9.6 L20 10.3 Z"
              fill="#0F294A"
            />
            {/* Pita emas topi pet */}
            <path
              d="M20.1 9.8 L28.9 9.2"
              stroke="#F59E0B"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            {/* Emblem kecil di depan topi */}
            <circle cx="26.4" cy="7.9" r="1.05" fill="#FBBF24" />
            {/* Pet / visor hitam mengilap mengarah ke depan */}
            <path
              d="M24.2 9.8 L31.2 10.4 C31.4 11.2 30.2 11.8 28.4 11.6 L23.5 10.8 Z"
              fill="#090D16"
            />
          </g>

          {/* 6. LENGAN DEPAN + HT (right-arm) */}
          <g
            data-part="right-arm"
            className="sec-walker-arm-right"
            style={{ transformOrigin: '24.2px 21px' }}
          >
            {/* Lengan seragam khaki */}
            <path
              d="M24.2 21.2 L26.9 28.1"
              stroke="#E2CFAF"
              strokeWidth="3.8"
              strokeLinecap="round"
            />
            {/* Manset navy */}
            <path
              d="M26.1 26.2 L26.9 28.1"
              stroke="#0F294A"
              strokeWidth="3.8"
              strokeLinecap="round"
            />
            {/* Tangan menggenggam HT */}
            <circle cx="27.5" cy="29.1" r="1.75" fill="#F2C49D" />
            {/* Handy Talky (HT) hitam + antena + LED status */}
            <g transform="translate(27.2, 25.4) rotate(12)">
              <rect x="0" y="1.4" width="2.9" height="4.8" rx="0.7" fill="#0F172A" />
              <line
                x1="2.2"
                y1="1.5"
                x2="2.6"
                y2="-2.2"
                stroke="#0F172A"
                strokeWidth="0.9"
                strokeLinecap="round"
              />
              <circle
                cx="1.2"
                cy="2.7"
                r="0.55"
                fill={isLive ? '#10B981' : '#38BDF8'}
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
};
