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

function createSafeFile(blob: Blob, fileName: string, mimeType: string): File {
  try {
    return new File([blob], fileName, {
      type: mimeType,
      lastModified: Date.now(),
    });
  } catch {
    // Fallback untuk WebView lama iOS/Android jika konstruktor File terbatas
    const fallbackBlob = blob as unknown as File;
    return fallbackBlob;
  }
}

/**
 * Mengompresi foto bukti transaksi di sisi browser (maks 1280px, JPEG kualitas 0.78)
 * secara aman untuk iOS Safari, Android Chrome, dan Desktop.
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
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
      return;
    }

    const img = new Image();
    const cleanup = () => {
      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      } catch {
        // Abaikan
      }
    };

    img.onload = () => {
      cleanup();
      try {
        let targetWidth = img.naturalWidth || img.width;
        let targetHeight = img.naturalHeight || img.height;

        if (!targetWidth || !targetHeight) {
          resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
          return;
        }

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

        if (!ctx || typeof canvas.toBlob !== 'function') {
          resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= originalSize) {
              resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
              return;
            }

            const baseName = file.name.replace(/\.[^.]+$/, '') || 'bukti';
            const compressedFile = createSafeFile(blob, `${baseName}.jpg`, 'image/jpeg');

            resolve({
              file: compressedFile,
              originalSize,
              compressedSize: compressedFile.size || blob.size,
              wasCompressed: true,
            });
          },
          'image/jpeg',
          quality
        );
      } catch {
        resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
      }
    };

    img.onerror = () => {
      cleanup();
      resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
    };

    img.src = objectUrl;
  });
}

/**
 * Mengoptimalkan gambar logo aplikasi (maks 512px) sambil mempertahankan transparansi PNG/WebP/SVG
 * agar tajam & ringan di iOS, Android, dan browser desktop.
 */
export async function compressLogoImage(
  file: File,
  maxDimension = 512
): Promise<CompressedImageResult> {
  const originalSize = file.size;

  if (file.type === 'image/svg+xml' || originalSize < 60 * 1024) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }

  return new Promise((resolve) => {
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
      return;
    }

    const img = new Image();
    const cleanup = () => {
      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      } catch {
        // Abaikan
      }
    };

    img.onload = () => {
      cleanup();
      try {
        let targetWidth = img.naturalWidth || img.width;
        let targetHeight = img.naturalHeight || img.height;

        if (!targetWidth || !targetHeight) {
          resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
          return;
        }

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

        if (!ctx || typeof canvas.toBlob !== 'function') {
          resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
          return;
        }

        const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
        if (!keepAlpha) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        } else {
          ctx.clearRect(0, 0, targetWidth, targetHeight);
        }
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const outMime = keepAlpha ? 'image/png' : 'image/jpeg';
        const outExt = keepAlpha ? 'png' : 'jpg';

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
              return;
            }
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'logo-aplikasi';
            const optimized = createSafeFile(blob, `${baseName}.${outExt}`, outMime);
            resolve({
              file: optimized,
              originalSize,
              compressedSize: optimized.size || blob.size,
              wasCompressed: true,
            });
          },
          outMime,
          keepAlpha ? undefined : 0.88
        );
      } catch {
        resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
      }
    };

    img.onerror = () => {
      cleanup();
      resolve({ file, originalSize, compressedSize: originalSize, wasCompressed: false });
    };

    img.src = objectUrl;
  });
}
