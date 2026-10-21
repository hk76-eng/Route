import { getAppwriteStorage, isAppwriteConfigured } from './appwrite';
import { safeStorage } from './safeStorage';

export const MOTORIDE_MEDIA_BUCKET = 'motoride_media';

export interface StorageStatus {
  bucketExists: boolean;
  isReady: boolean;
  message: string;
}

export async function ensureMediaBucketExists(): Promise<StorageStatus> {
  const storage = getAppwriteStorage();
  if (!storage || !isAppwriteConfigured()) {
    return {
      bucketExists: true,
      isReady: true,
      message: 'Running in Local/Memory Storage Mode (Appwrite storage not configured)',
    };
  }

  try {
    try {
      await storage.getBucket(MOTORIDE_MEDIA_BUCKET);
    } catch {
      await storage.createBucket(MOTORIDE_MEDIA_BUCKET, MOTORIDE_MEDIA_BUCKET, ['role:all'], true, undefined, 50 * 1024 * 1024, ['jpg', 'png', 'webp', 'jpeg', 'svg', 'mp4']);
    }
    return {
      bucketExists: true,
      isReady: true,
      message: 'Appwrite Storage Bucket ready',
    };
  } catch (err: any) {
    return {
      bucketExists: false,
      isReady: false,
      message: err?.message || 'Storage bucket check failed',
    };
  }
}

export async function uploadMediaToAppwrite(file: File, folder: string = 'uploads'): Promise<string | null> {
  const storage = getAppwriteStorage();
  if (!storage || !isAppwriteConfigured()) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  try {
    const fileId = 'file_' + Math.random().toString(36).substring(2, 10);
    const result = await storage.createFile(MOTORIDE_MEDIA_BUCKET, fileId, file);
    const viewUrl = storage.getFileView(MOTORIDE_MEDIA_BUCKET, result.$id);
    return viewUrl.toString();
  } catch (err: any) {
    console.warn('Appwrite file upload warning, falling back to local data URL:', err);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }
}

export async function compressImageToDataUrl(file: File, maxWidth: number = 800, quality: number = 0.8): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(e.target?.result as string || '');
        }
      };
      img.onerror = () => resolve(e.target?.result as string || '');
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}
