// Cloudflare R2 upload via signed URLs
import { r2UploadViaSignedUrl } from "./cfApi";

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
  const total = files.length;
  const start = params.startIndex ?? 0;
  const pad = Math.max(1, params.padDigits ?? 3);
  const prefix = filmId.replace(/-/g, "_");
  const infer = !!params.inferFromFilenames;
  const isImage = type === "image";
  const expectedCT = isImage ? "image/jpeg" : "audio/mpeg";

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
    if (!isImage && !/mpeg$/i.test(f.type) && f.type !== "audio/mpeg") {
      throw new Error(`File ${f.name} is not MP3 (audio/mpeg)`);
    }

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

  const paddedEp = String(episodeNum).padStart(3,'0');
  for (let i = 0; i < plan.length; i++) {
    const { file: f, cardId } = plan[i];
    const ext = isImage ? "jpg" : "mp3";
    // Updated pattern (2025-11 generic): items/{filmId}/episodes/e{episodeNum}/{type}/{filmId_normalized}_{cardId}.ext
    const fileName = `${prefix}_${cardId}.${ext}`;
    // New padded folder (non-breaking): filmId_001 style. Keep legacy folder upload for compatibility.
    const newBucketPath = `items/${filmId}/episodes/${filmId}_${paddedEp}/${type}/${fileName}`;
    const legacyBucketPath = `items/${filmId}/episodes/${filmId}_${episodeNum}/${type}/${fileName}`;
    // Prefer new padded path; attempt upload; on failure (unlikely) fallback legacy.
    try {
      await r2UploadViaSignedUrl({ bucketPath: newBucketPath, file: f, contentType: expectedCT });
    } catch {
      await r2UploadViaSignedUrl({ bucketPath: legacyBucketPath, file: f, contentType: expectedCT });
    }
    onProgress?.(i + 1, total);
  }
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
export async function uploadEpisodeFullMedia(params: { filmId: string; episodeNum: number; type: 'audio' | 'video'; file: File }) {
  const { filmId, episodeNum, type, file } = params;
  const epFolderPadded = `${filmId}_${String(episodeNum).padStart(3,'0')}`;
  const epFolderLegacy = `${filmId}_${episodeNum}`;
  if (type === 'audio') {
    if (!/mpeg$/i.test(file.type) && file.type !== 'audio/mpeg') {
      throw new Error('Episode full audio must be MP3 (audio/mpeg)');
    }
    const bucketPathNew = `items/${filmId}/episodes/${epFolderPadded}/full/audio.mp3`;
    const bucketPathLegacy = `items/${filmId}/episodes/${epFolderLegacy}/full/audio.mp3`;
    try {
      await r2UploadViaSignedUrl({ bucketPath: bucketPathNew, file, contentType: 'audio/mpeg' });
      return bucketPathNew;
    } catch {
      await r2UploadViaSignedUrl({ bucketPath: bucketPathLegacy, file, contentType: 'audio/mpeg' });
      return bucketPathLegacy;
    }
  } else {
    if (!/mp4$/i.test(file.type) && file.type !== 'video/mp4') {
      throw new Error('Episode full video must be MP4 (video/mp4)');
    }
    const bucketPathNew = `items/${filmId}/episodes/${epFolderPadded}/full/video.mp4`;
    const bucketPathLegacy = `items/${filmId}/episodes/${epFolderLegacy}/full/video.mp4`;
    try {
      await r2UploadViaSignedUrl({ bucketPath: bucketPathNew, file, contentType: 'video/mp4' });
      return bucketPathNew;
    } catch {
      await r2UploadViaSignedUrl({ bucketPath: bucketPathLegacy, file, contentType: 'video/mp4' });
      return bucketPathLegacy;
    }
  }
}
