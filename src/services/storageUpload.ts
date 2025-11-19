// Cloudflare R2 upload via signed URLs
import { r2UploadViaSignedUrl, r2BatchSignUpload, r2MultipartUpload } from "./cfApi";

export type MediaType = "image" | "audio";

export interface UploadMediaParams {
  filmId: string;
  episodeNum: number; // 1 -> e1
  type: MediaType;
  files: File[];
  startIndex?: number; // default 0; used to compute cardId for naming
  padDigits?: number; // default 3; zero-padding for cardId
  inferFromFilenames?: boolean; // if true, try to extract cardId from file name
  cardIds?: string[]; // optional explicit cardIds mapping (same length as files) overrides inference/sequence
}

export async function uploadMediaBatch(params: UploadMediaParams, onProgress?: (done: number, total: number) => void) {
  const { filmId, episodeNum, type, files } = params;
  // epFolder no longer used in new nested path, but kept comment for reference
  // const epFolder = String(episodeNum).padStart(3, "0");
  // We will determine total after filtering out disallowed files (e.g., oversized WAV)
  let total = 0;
  const start = params.startIndex ?? 0;
  const pad = Math.max(1, params.padDigits ?? 3);
  // const prefix = filmId.replace(/-/g, "_"); // no longer used in new filename scheme
  const infer = !!params.inferFromFilenames;
  const isImage = type === "image";
  // Accept both mp3 and wav for audio

  // Build upload plan with computed or provided cardIds
  const plan: { file: File; cardId: string }[] = [];
  const used = new Set<string>();
  let seq = start;
  const extractId = (name: string): string | null => {
    const base = name.replace(/\.[^.]+$/, "");
    const matches = base.match(/\d+/g);
    if (!matches || matches.length === 0) return null;
    const raw = matches[matches.length - 1];
    if (!raw) return null;
    return raw.length >= pad ? raw : raw.padStart(pad, "0");
  };

  const explicit = Array.isArray(params.cardIds) && params.cardIds.length === files.length ? params.cardIds : null;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // Enforce content type compatibility with import pattern
    if (isImage && !/jpe?g$/i.test(f.type) && f.type !== "image/jpeg") {
      throw new Error(`File ${f.name} is not JPEG (image/jpeg)`);
    }
    if (!isImage && !/mpeg$/i.test(f.type) && f.type !== "audio/mpeg" && !/wav$/i.test(f.type) && f.type !== "audio/wav" && f.type !== "audio/x-wav") {
      throw new Error(`File ${f.name} is not MP3 or WAV (audio/mpeg, audio/wav)`);
    }

    // Previously: skipped WAV >8MB to avoid timeouts.
    // Now: allow WAV of any size for card audio uploads. Upload uses signed PUT with extended timeout.

  let cardId: string | null = explicit ? String(explicit[i]) : (infer ? extractId(f.name) : null);
    if (!cardId) {
      cardId = String(seq).padStart(pad, "0");
      seq += 1;
    }
    // ensure uniqueness to avoid overwriting in R2
    while (used.has(cardId)) {
      // bump sequentially until unique
      const n = parseInt(cardId, 10);
      if (!Number.isNaN(n)) {
        cardId = String(n + 1).padStart(Math.max(pad, cardId.length), "0");
      } else {
        cardId = `${cardId}a`;
      }
    }
    used.add(cardId);
    plan.push({ file: f, cardId });
  }

  // If we inferred IDs, keep upload order sorted by numeric value when possible
  if (infer && !explicit) {
    plan.sort((a, b) => {
      const na = parseInt(a.cardId, 10);
      const nb = parseInt(b.cardId, 10);
      if (Number.isNaN(na) || Number.isNaN(nb)) return a.cardId.localeCompare(b.cardId);
      return na - nb;
    });
  }

  // Set total after filtering/skipping
  total = plan.length;
  const paddedEp = String(episodeNum).padStart(3,'0');
  // Parallel upload with concurrency limit
  const concurrency = 20;
  const signBatchSize = 100; // Fetch 100 signed URLs per batch to minimize round-trips
  let done = 0;

  // Pre-compute all paths and fetch signed URLs in batches
  const uploadPlan: Array<{ file: File; cardId: string; newPath: string; legacyPath: string; contentType: string }> = [];
  for (const item of plan) {
    const ext = isImage ? "jpg" : (item.file.type === "audio/wav" || item.file.type === "audio/x-wav" ? "wav" : "mp3");
    const fileName = `${filmId}_${paddedEp}_${item.cardId}.${ext}`;
    const newPath = `items/${filmId}/episodes/${filmId}_${paddedEp}/${type}/${fileName}`;
    const legacyPath = `items/${filmId}/episodes/${filmId}_${episodeNum}/${type}/${fileName}`;
    const contentType = isImage ? "image/jpeg" : (item.file.type === "audio/wav" || item.file.type === "audio/x-wav" ? "audio/wav" : "audio/mpeg");
    uploadPlan.push({ file: item.file, cardId: item.cardId, newPath, legacyPath, contentType });
  }

  // Batch-fetch signed URLs (reduces N requests to N/signBatchSize)
  const signedUrls = new Map<string, string>();
  const uploadedInFallback = new Set<string>(); // Track files uploaded during fallback
  for (let i = 0; i < uploadPlan.length; i += signBatchSize) {
    const chunk = uploadPlan.slice(i, i + signBatchSize);
    const signItems = chunk.map(p => ({ path: p.newPath, contentType: p.contentType }));
    try {
      const urls = await r2BatchSignUpload(signItems);
      urls.forEach(u => signedUrls.set(u.path, u.url));
    } catch (err) {
      // Fallback to individual signing if batch fails (shouldn't happen, but safety)
      console.warn('Batch sign failed, falling back to individual upload:', err);
      for (const p of chunk) {
        try {
          await r2UploadViaSignedUrl({ bucketPath: p.newPath, file: p.file, contentType: p.contentType });
          uploadedInFallback.add(p.newPath); // Mark as uploaded
          done++;
          onProgress?.(done, total);
        } catch (err2) {
          console.error(`Fallback upload failed for ${p.newPath}:`, err2);
          // Still increment done to avoid blocking progress
          done++;
          onProgress?.(done, total);
        }
      }
      continue; // Skip to next batch
    }
  }

  // Upload all files using pre-fetched signed URLs with concurrency control
  async function uploadOne(item: typeof uploadPlan[0]) {
    // Skip if already uploaded during fallback
    if (uploadedInFallback.has(item.newPath)) {
      return;
    }
    
    const signedUrl = signedUrls.get(item.newPath);
    if (!signedUrl) {
      console.error(`No signed URL for ${item.newPath}`);
      done++;
      onProgress?.(done, total);
      return;
    }
    try {
      // Abort long-hanging PUTs to avoid stalling the entire batch
      const controller = new AbortController();
      const timeoutMs = 120000; // 120s safety timeout per file
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const put = await fetch(signedUrl, {
        method: "PUT",
        body: item.file,
        headers: { "Content-Type": item.contentType },
        signal: controller.signal,
      }).finally(() => clearTimeout(t));
      if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
    } catch (e) {
      console.warn(`PUT failed or timed out for ${item.newPath}. Falling back to legacy upload...`, e);
      // Try legacy path as fallback
      try {
        await r2UploadViaSignedUrl({ bucketPath: item.legacyPath, file: item.file, contentType: item.contentType });
      } catch (err2) {
        console.error(`Failed to upload ${item.newPath}:`, err2);
      }
    }
    done++;
    onProgress?.(done, total);
  }

  // Execute uploads with concurrency limit
  let idx = 0;
  async function runBatch() {
    while (idx < uploadPlan.length) {
      const batch = [];
      for (let j = 0; j < concurrency && idx < uploadPlan.length; j++, idx++) {
        batch.push(uploadOne(uploadPlan[idx]));
      }
      await Promise.allSettled(batch);
    }
  }
  await runBatch();
}

// Upload cover image (JPEG) to items/{filmId}/cover_image/cover.jpg
export async function uploadCoverImage(params: { filmId: string; episodeNum: number; file: File }) {
  const { filmId, /* episodeNum */ file } = params;
  if (!/jpe?g$/i.test(file.type) && file.type !== 'image/jpeg') {
    throw new Error('Cover must be a JPEG image');
  }
  const bucketPath = `items/${filmId}/cover_image/cover.jpg`;
  await r2UploadViaSignedUrl({ bucketPath, file, contentType: 'image/jpeg' });
}

// Upload episode cover image (JPEG) to items/{filmId}/episodes/{filmId}_{episodeNum}/cover/cover.jpg
export async function uploadEpisodeCoverImage(params: { filmId: string; episodeNum: number; file: File }) {
  const { filmId, episodeNum, file } = params;
  if (!/jpe?g$/i.test(file.type) && file.type !== 'image/jpeg') {
    throw new Error('Episode cover must be a JPEG image');
  }
  const epFolderPadded = `${filmId}_${String(episodeNum).padStart(3,'0')}`;
  const epFolderLegacy = `${filmId}_${episodeNum}`;
  const bucketPathNew = `items/${filmId}/episodes/${epFolderPadded}/cover/cover.jpg`;
  const bucketPathLegacy = `items/${filmId}/episodes/${epFolderLegacy}/cover/cover.jpg`;
  try {
    await r2UploadViaSignedUrl({ bucketPath: bucketPathNew, file, contentType: 'image/jpeg' });
    return bucketPathNew;
  } catch {
    await r2UploadViaSignedUrl({ bucketPath: bucketPathLegacy, file, contentType: 'image/jpeg' });
    return bucketPathLegacy;
  }
}

// Upload full media for a film (top-level, not per-episode)
export async function uploadFilmFullMedia(params: { filmId: string; type: 'audio' | 'video'; file: File }) {
  const { filmId, type, file } = params;
  if (type === 'audio') {
    if (!/mpeg$/i.test(file.type) && file.type !== 'audio/mpeg') {
      throw new Error('Full audio must be MP3 (audio/mpeg)');
    }
    const bucketPath = `items/${filmId}/full/audio.mp3`;
    await r2UploadViaSignedUrl({ bucketPath, file, contentType: 'audio/mpeg' });
    return bucketPath;
  } else {
    if (!/mp4$/i.test(file.type) && file.type !== 'video/mp4') {
      throw new Error('Full video must be MP4 (video/mp4)');
    }
    const bucketPath = `items/${filmId}/full/video.mp4`;
    await r2UploadViaSignedUrl({ bucketPath, file, contentType: 'video/mp4' });
    return bucketPath;
  }
}

// Upload full media for a specific episode
export async function uploadEpisodeFullMedia(params: { filmId: string; episodeNum: number; type: 'audio' | 'video'; file: File; onProgress?: (doneBytes: number, totalBytes: number) => void }) {
  const { filmId, episodeNum, type, file, onProgress } = params;
  const epFolderPadded = `${filmId}_${String(episodeNum).padStart(3,'0')}`;
  const epFolderLegacy = `${filmId}_${episodeNum}`;
  if (type === 'audio') {
    // Accept mp3 and wav
    if (!/mpeg$/i.test(file.type) && file.type !== 'audio/mpeg' && !/wav$/i.test(file.type) && file.type !== 'audio/wav' && file.type !== 'audio/x-wav') {
      throw new Error('Episode full audio must be MP3 or WAV (audio/mpeg, audio/wav)');
    }
    const isWav = file.type === 'audio/wav' || file.type === 'audio/x-wav';
    const ext = isWav ? 'wav' : 'mp3';
    const contentType = isWav ? 'audio/wav' : 'audio/mpeg';
    const bucketPathNew = `items/${filmId}/episodes/${epFolderPadded}/full/audio.${ext}`;
    const bucketPathLegacy = `items/${filmId}/episodes/${epFolderLegacy}/full/audio.${ext}`;
    // Use multipart for reliability on larger files (>= 8MB), else direct PUT
    const useMultipart = file.size >= 8 * 1024 * 1024;
    if (useMultipart) {
      try {
        await r2MultipartUpload({ key: bucketPathNew, file, contentType, partSizeBytes: 8 * 1024 * 1024, concurrency: 3, onProgress: (d,t)=>onProgress?.(d,t) });
        return bucketPathNew;
      } catch (e) {
        console.warn('Multipart audio upload failed for padded path, retrying legacy path...', e);
        await r2MultipartUpload({ key: bucketPathLegacy, file, contentType, partSizeBytes: 8 * 1024 * 1024, concurrency: 3, onProgress: (d,t)=>onProgress?.(d,t) });
        return bucketPathLegacy;
      }
    } else {
      try {
        await r2UploadViaSignedUrl({ bucketPath: bucketPathNew, file, contentType });
        return bucketPathNew;
      } catch {
        await r2UploadViaSignedUrl({ bucketPath: bucketPathLegacy, file, contentType });
        return bucketPathLegacy;
      }
    }
  } else {
    if (!/mp4$/i.test(file.type) && file.type !== 'video/mp4') {
      throw new Error('Episode full video must be MP4 (video/mp4)');
    }
    const bucketPathNew = `items/${filmId}/episodes/${epFolderPadded}/full/video.mp4`;
    const bucketPathLegacy = `items/${filmId}/episodes/${epFolderLegacy}/full/video.mp4`;
    // Prefer multipart for reliability; if it fails, try legacy path
    try {
      await r2MultipartUpload({ key: bucketPathNew, file, contentType: 'video/mp4', partSizeBytes: 8 * 1024 * 1024, concurrency: 3, onProgress: (done, total) => {
        onProgress?.(done, total);
      }});
      return bucketPathNew;
    } catch (e) {
      console.warn('Multipart upload failed for padded path, retrying legacy path with multipart...', e);
      await r2MultipartUpload({ key: bucketPathLegacy, file, contentType: 'video/mp4', partSizeBytes: 8 * 1024 * 1024, concurrency: 3, onProgress: (done, total) => {
        onProgress?.(done, total);
      }});
      return bucketPathLegacy;
    }
  }
}
