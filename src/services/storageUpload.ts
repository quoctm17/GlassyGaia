// Cloudflare R2 upload via signed URLs
import { r2UploadViaSignedUrl, r2BatchSignUpload } from "./cfApi";

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
  signal?: AbortSignal; // optional cancel signal
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
    if (isImage && !/jpe?g$/i.test(f.type) && f.type !== "image/jpeg" && !/webp$/i.test(f.type) && f.type !== "image/webp" && f.type !== "image/avif") {
      throw new Error(`File ${f.name} is not JPEG, WebP, or AVIF (image/jpeg, image/webp, image/avif)`);
    }
    if (!isImage && !/mpeg$/i.test(f.type) && f.type !== "audio/mpeg" && !/wav$/i.test(f.type) && f.type !== "audio/wav" && f.type !== "audio/x-wav" && !/opus$/i.test(f.type) && f.type !== "audio/opus" && f.type !== "audio/ogg") {
      throw new Error(`File ${f.name} is not MP3, WAV, or Opus (audio/mpeg, audio/wav, audio/opus)`);
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
    const ext = isImage 
      ? (item.file.type === "image/avif" ? "avif" : (item.file.type === "image/webp" ? "webp" : "jpg"))
      : (item.file.type === "audio/wav" || item.file.type === "audio/x-wav" ? "wav" 
        : (item.file.type === "audio/opus" || item.file.type === "audio/ogg" ? "opus" : "mp3"));
    const fileName = `${filmId}_${paddedEp}_${item.cardId}.${ext}`;
    const newPath = `items/${filmId}/episodes/${filmId}_${paddedEp}/${type}/${fileName}`;
    const legacyPath = `items/${filmId}/episodes/${filmId}_${episodeNum}/${type}/${fileName}`;
    const contentType = isImage 
      ? (item.file.type === "image/avif" ? "image/avif" : (item.file.type === "image/webp" ? "image/webp" : "image/jpeg"))
      : (item.file.type === "audio/wav" || item.file.type === "audio/x-wav" ? "audio/wav" 
        : (item.file.type === "audio/opus" || item.file.type === "audio/ogg" ? "audio/opus" : "audio/mpeg"));
    uploadPlan.push({ file: item.file, cardId: item.cardId, newPath, legacyPath, contentType });
  }

  // Batch-fetch signed URLs (reduces N requests to N/signBatchSize)
  const signedUrls = new Map<string, string>();
  const uploadedInFallback = new Set<string>(); // Track files uploaded during fallback
  for (let i = 0; i < uploadPlan.length; i += signBatchSize) {
    if (params.signal?.aborted) return; // respect cancellation before signing batches
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
    if (params.signal?.aborted) return;
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
      const cancelListener = () => controller.abort();
      if (params.signal) {
        if (params.signal.aborted) controller.abort();
        params.signal.addEventListener('abort', cancelListener);
      }
      const timeoutMs = 120000; // 120s safety timeout per file
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const put = await fetch(signedUrl, {
        method: "PUT",
        body: item.file,
        headers: { "Content-Type": item.contentType },
        signal: controller.signal,
      }).finally(() => { clearTimeout(t); if (params.signal) params.signal.removeEventListener('abort', cancelListener); });
      if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
    } catch (e) {
      if (params.signal?.aborted) return; // quietly stop on cancel
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
    while (idx < uploadPlan.length && !(params.signal?.aborted)) {
      const batch = [];
      for (let j = 0; j < concurrency && idx < uploadPlan.length; j++, idx++) {
        batch.push(uploadOne(uploadPlan[idx]));
      }
      await Promise.allSettled(batch);
    }
  }
  await runBatch();
}

// Upload cover image (JPEG/WebP/AVIF) to items/{filmId}/cover_image/cover.{ext} or cover_landscape.{ext}
export async function uploadCoverImage(params: { filmId: string; episodeNum: number; file: File; landscape?: boolean }) {
  const { filmId, /* episodeNum */ file, landscape } = params;
  if (!/jpe?g$/i.test(file.type) && file.type !== 'image/jpeg' && !/webp$/i.test(file.type) && file.type !== 'image/webp' && file.type !== 'image/avif') {
    throw new Error('Cover must be a JPEG, WebP, or AVIF image');
  }
  const isAvif = file.type === 'image/avif';
  const isWebP = file.type === 'image/webp';
  const ext = isAvif ? 'avif' : (isWebP ? 'webp' : 'jpg');
  const contentType = isAvif ? 'image/avif' : (isWebP ? 'image/webp' : 'image/jpeg');
  const filename = landscape ? `cover_landscape.${ext}` : `cover.${ext}`;
  const bucketPath = `items/${filmId}/cover_image/${filename}`;
  await r2UploadViaSignedUrl({ bucketPath, file, contentType });
}

// Upload episode cover image (JPEG/WebP/AVIF) to items/{filmId}/episodes/{filmId}_{episodeNum}/cover/cover.{ext} or cover_landscape.{ext}
export async function uploadEpisodeCoverImage(params: { filmId: string; episodeNum: number; file: File; landscape?: boolean }) {
  const { filmId, episodeNum, file, landscape } = params;
  if (!/jpe?g$/i.test(file.type) && file.type !== 'image/jpeg' && !/webp$/i.test(file.type) && file.type !== 'image/webp' && file.type !== 'image/avif') {
    throw new Error('Episode cover must be a JPEG, WebP, or AVIF image');
  }
  const isAvif = file.type === 'image/avif';
  const isWebP = file.type === 'image/webp';
  const ext = isAvif ? 'avif' : (isWebP ? 'webp' : 'jpg');
  const contentType = isAvif ? 'image/avif' : (isWebP ? 'image/webp' : 'image/jpeg');
  const filename = landscape ? `cover_landscape.${ext}` : `cover.${ext}`;
  const epFolderPadded = `${filmId}_${String(episodeNum).padStart(3,'0')}`;
  const epFolderLegacy = `${filmId}_${episodeNum}`;
  const bucketPathNew = `items/${filmId}/episodes/${epFolderPadded}/cover/${filename}`;
  const bucketPathLegacy = `items/${filmId}/episodes/${epFolderLegacy}/cover/${filename}`;
  try {
    await r2UploadViaSignedUrl({ bucketPath: bucketPathNew, file, contentType });
    return bucketPathNew;
  } catch {
    await r2UploadViaSignedUrl({ bucketPath: bucketPathLegacy, file, contentType });
    return bucketPathLegacy;
  }
}
