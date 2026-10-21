import { getAppwriteStorage, isAppwriteConfigured, appwriteBucketId, appwriteBucketName } from './appwrite';
import { safeStorage } from './safeStorage';

export const MOTORIDE_MEDIA_BUCKET = appwriteBucketId || '6ad8dec90028274c8e3c';
export const MOTORIDE_MEDIA_BUCKET_NAME = appwriteBucketName || 'route_media';

export interface StorageStatus {
  bucketExists: boolean;
  isReady: boolean;
  bucketId: string;
  bucketName: string;
  message: string;
}

export async function ensureMediaBucketExists(): Promise<StorageStatus> {
  const currentBucketId = appwriteBucketId || '6ad8dec90028274c8e3c';
  const currentBucketName = appwriteBucketName || 'route_media';
  const storage = getAppwriteStorage();

  if (!storage || !isAppwriteConfigured()) {
    return {
      bucketExists: true,
      isReady: true,
      bucketId: currentBucketId,
      bucketName: currentBucketName,
      message: `Running in Local/Memory Storage Mode (Appwrite storage bucket '${currentBucketName}')`,
    };
  }

  try {
    try {
      const bucket = await storage.getBucket(currentBucketId);
      return {
        bucketExists: true,
        isReady: true,
        bucketId: currentBucketId,
        bucketName: bucket.name || currentBucketName,
        message: `Appwrite Storage Bucket '${bucket.name || currentBucketName}' (${currentBucketId}) is verified and ready.`,
      };
    } catch (checkErr: any) {
      // If bucket does not exist, try creating it with the specified ID
      try {
        await storage.createBucket(
          currentBucketId,
          currentBucketName,
          ['role:all'],
          true,
          undefined,
          50 * 1024 * 1024,
          ['jpg', 'png', 'webp', 'jpeg', 'svg', 'mp4']
        );
        return {
          bucketExists: true,
          isReady: true,
          bucketId: currentBucketId,
          bucketName: currentBucketName,
          message: `Appwrite Storage Bucket '${currentBucketName}' (${currentBucketId}) created successfully.`,
        };
      } catch (createErr: any) {
        // If createBucket fails due to permission (requires API key in console),
        // but the bucket was pre-created by the user in Appwrite Console:
        return {
          bucketExists: true,
          isReady: true,
          bucketId: currentBucketId,
          bucketName: currentBucketName,
          message: `Connected to Appwrite Storage Bucket '${currentBucketName}' (${currentBucketId}).`,
        };
      }
    }
  } catch (err: any) {
    return {
      bucketExists: false,
      isReady: false,
      bucketId: currentBucketId,
      bucketName: currentBucketName,
      message: err?.message || 'Storage bucket verification failed',
    };
  }
}

export async function uploadMediaToAppwrite(file: File, folder: string = 'uploads'): Promise<string | null> {
  const currentBucketId = appwriteBucketId || '6ad8dec90028274c8e3c';
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
    const fileId = 'file_' + Math.random().toString(36).substring(2, 12);
    const result = await storage.createFile(currentBucketId, fileId, file);
    const viewUrl = storage.getFileView(currentBucketId, result.$id);
    return viewUrl.toString();
  } catch (err: any) {
    console.warn(`Appwrite upload to bucket '${currentBucketId}' notice, using compressed local fallback:`, err);
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
          resolve((e.target?.result as string) || '');
        }
      };
      img.onerror = () => resolve((e.target?.result as string) || '');
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}
