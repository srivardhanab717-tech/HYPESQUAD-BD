import { getSupabaseClient } from '../lib/supabase';
import { config } from '../config/env';

/**
 * Media storage service for Supabase Storage (S3-compatible).
 * Buckets: 'reels', 'milestone-cards', 'avatars'
 *
 * In v1, the client handles uploads via presigned URLs.
 * This service is prepared for future server-side upload support.
 */

/**
 * Upload a file to Supabase Storage.
 * @param bucket - Storage bucket name (e.g. 'reels', 'milestone-cards', 'avatars')
 * @param path - File path within the bucket
 * @param file - File contents as a Buffer
 * @param contentType - MIME type of the file
 * @returns Public URL of the uploaded file
 */
export async function uploadMedia(
  bucket: string,
  path: string,
  file: Buffer,
  contentType: string
): Promise<string> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload media: ${error.message}`);
  }

  return getPublicUrl(bucket, path);
}

/**
 * Get the CDN-backed public URL for a file in Supabase Storage.
 * @param bucket - Storage bucket name
 * @param path - File path within the bucket
 * @returns Public URL string
 */
export function getPublicUrl(bucket: string, path: string): string {
  const supabase = getSupabaseClient();

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);

  return data.publicUrl;
}
