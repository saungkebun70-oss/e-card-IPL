export interface CompressedImageResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Mengompresi foto bukti transaksi di sisi browser (maks 1280px, JPEG kualitas 0.78)
 * untuk menghemat ruang penyimpanan Supabase Storage & bandwidth saat trafik ramai.
 */
export async function compressProofImage(
  file: File,
  maxDimension = 1280,
  quality = 0.78
): Promise<CompressedImageResult> {
  const originalSize = file.size;

  // Lewati jika bukan gambar raster standar atau sudah sangat kecil (< 120 KB)
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || originalSize < 120 * 1024) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let targetWidth = img.naturalWidth;
      let targetHeight = img.naturalHeight;

      if (targetWidth > maxDimension || targetHeight > maxDimension) {
        if (targetWidth >= targetHeight) {
          targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
          targetWidth = maxDimension;
        } else {
          targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
          targetHeight = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
        return;
      }

      // Latar putih untuk PNG transparan agar tetap terbaca jelas saat dikonversi ke JPEG
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= originalSize) {
            resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
            return;
          }

          const baseName = file.name.replace(/\.[^.]+$/, '');
          const compressedFile = new File([blob], `${baseName}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          resolve({
            file: compressedFile,
            originalSize,
            compressedSize: compressedFile.size,
            wasCompressed: true,
          });
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
    };

    img.src = objectUrl;
  });
}
