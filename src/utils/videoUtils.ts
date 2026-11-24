import type { UploadedVideoMeta, VideoKeyframeSample } from '../types/pipeline';
import { parseJsonResponse } from './safeFetch';

/**
 * Extracts video duration, dimensions, and evenly-spaced compressed JPEG keyframes
 * directly in the browser before uploading the raw video binary.
 */
export async function extractVideoMetadataAndFrames(
  file: File,
  frameCount = 8
): Promise<{
  durationSec: number;
  width: number;
  height: number;
  keyframes: VideoKeyframeSample[];
}> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out reading video metadata.')), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not decode this video format in the browser. Try MP4 or WebM.'));
      };
    });

    const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    const targetW = Math.min(480, width);
    const targetH = Math.max(120, Math.round((targetW / Math.max(1, width)) * height));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    const keyframes: VideoKeyframeSample[] = [];
    const totalFrames = Math.max(3, Math.min(frameCount, Math.ceil(durationSec)));

    if (ctx) {
      for (let i = 0; i < totalFrames; i++) {
        const t =
          totalFrames === 1
            ? Math.min(durationSec * 0.5, durationSec)
            : Math.min(durationSec - 0.1, (i / (totalFrames - 1)) * Math.max(0.2, durationSec - 0.15));

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1200);
          video.onseeked = () => {
            clearTimeout(timeout);
            resolve();
          };
          video.currentTime = Math.max(0, t);
        });

        ctx.drawImage(video, 0, 0, targetW, targetH);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
        keyframes.push({
          timeSec: Number(t.toFixed(2)),
          dataUrl,
        });
      }
    }

    return { durationSec, width, height, keyframes };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Uploads a video file cleanly as raw binary to the server + pairs it with extracted metadata/keyframes.
 */
export async function uploadVideoAssetForStage(
  projectId: string,
  file: File,
  stagePrefix: 'foley-vid' | 'sfx-vid' | 'music-vid'
): Promise<UploadedVideoMeta> {
  const { durationSec, width, height, keyframes } = await extractVideoMetadataAndFrames(file, 8);

  const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/upload-media`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'video/mp4',
      'X-Media-Filename': file.name,
      'X-Media-Prefix': stagePrefix,
    },
    body: file,
  });

  const data = await parseJsonResponse<{ url: string; filename: string; error?: string }>(
    resp,
    'Could not upload video file.'
  );
  if (!resp.ok || !data.url) {
    throw new Error(data.error || 'Could not upload video file.');
  }

  return {
    assetUrl: data.url,
    filename: file.name,
    mimeType: file.type || 'video/mp4',
    durationSec: Number(durationSec.toFixed(2)),
    width,
    height,
    keyframes,
    uploadedAt: new Date().toISOString(),
  };
}
