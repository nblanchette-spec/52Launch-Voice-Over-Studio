import fs from 'fs/promises';
import path from 'path';
import type {
  PipelineProject,
  ProjectSummary,
} from '../src/types/pipeline.ts';
import { DEFAULT_VO_SETTINGS } from '../src/utils/voPresets.ts';

function getDataRoot(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

const MIME_TO_ASSET_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
};

const EXT_TO_ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
};

export function isSupportedAssetFilename(filename: string): boolean {
  if (
    !filename ||
    filename.startsWith('.') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return false;
  }
  const ext = path.extname(filename).toLowerCase();
  return Boolean(EXT_TO_ASSET_MIME[ext]);
}

function sanitizeAssetPrefix(raw: string | undefined, fallback = 'asset'): string {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return cleaned || fallback;
}

function normalizeSupportedExt(rawExt: string | undefined): string {
  const cleaned = String(rawExt || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (!cleaned || !EXT_TO_ASSET_MIME[`.${cleaned}`]) {
    throw new Error(
      `Unsupported asset file extension ".${cleaned || 'unknown'}". Allowed: audio, image, video, and PDF files.`
    );
  }
  return cleaned === 'jpeg' ? 'jpg' : cleaned;
}

function getMimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_ASSET_MIME[ext] || 'application/octet-stream';
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function sanitizeId(raw: string): string {
  return (
    raw
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `vo-${Date.now()}`
  );
}

export function getProjectDir(projectId: string): string {
  return path.join(getDataRoot(), sanitizeId(projectId));
}

export function getProjectAssetsDir(projectId: string): string {
  return path.join(getProjectDir(projectId), 'assets');
}

export async function saveDataUrlAsset(
  projectId: string,
  dataUrl: string,
  prefix = 'asset'
): Promise<{ url: string; filename: string }> {
  const assetsDir = getProjectAssetsDir(projectId);
  await ensureDir(assetsDir);

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid file upload format.');
  }
  const mime = match[1].toLowerCase().trim();
  const base64Data = match[2];
  const ext = MIME_TO_ASSET_EXT[mime];
  if (!ext) {
    throw new Error(
      `Unsupported file type "${mime}". Allowed formats: WAV, MP3, M4A, OGG, AAC, PNG, JPG, WEBP, GIF, MP4, MOV, WEBM, and PDF.`
    );
  }

  const safePrefix = sanitizeAssetPrefix(prefix, 'asset');
  const filename = `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const filePath = path.join(assetsDir, filename);
  await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));

  return {
    filename,
    url: `/api/projects/${sanitizeId(projectId)}/assets/${filename}`,
  };
}

export async function saveBufferAsset(
  projectId: string,
  buffer: Buffer,
  prefix = 'vo',
  ext = 'wav'
): Promise<{ url: string; filename: string }> {
  const assetsDir = getProjectAssetsDir(projectId);
  await ensureDir(assetsDir);

  const safeExt = normalizeSupportedExt(ext);
  const safePrefix = sanitizeAssetPrefix(prefix, 'vo');
  const filename = `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${safeExt}`;
  const filePath = path.join(assetsDir, filename);
  await fs.writeFile(filePath, buffer);

  return {
    filename,
    url: `/api/projects/${sanitizeId(projectId)}/assets/${filename}`,
  };
}

export async function seedInitialProjectIfEmpty(): Promise<void> {
  const dataRoot = getDataRoot();
  await ensureDir(dataRoot);
  const entries = await fs.readdir(dataRoot, { withFileTypes: true });
  const hasProjectFolders = entries.some((e) => e.isDirectory());
  if (hasProjectFolders) return;

  const sampleId = 'kinetix-launch-vo';
  const now = new Date().toISOString();

  const starterProject: PipelineProject = {
    id: sampleId,
    createdAt: now,
    updatedAt: now,
    client: 'Kinetix Bio',
    product: {
      name: '30s Launch Hero VO',
      description:
        'Sample 30-second commercial voiceover script ready to audition, customize, or replace with your own script.',
    },
    scriptBrief: {
      topicPrompt:
        '30-second athletic launch spot for Kinetix Core Patch — a 1.2mm wearable sweat-sensing patch that warns runners 20 minutes before dehydration.',
      productOrBrand: 'Kinetix Core Patch',
      targetAudience: 'Endurance runners & marathoners',
      speakerName: 'Narrator',
      targetDurationSec: 30,
      lineCount: 4,
      toneNote: 'Disciplined, grounded, quiet athletic confidence',
    },
    voSettings: { ...DEFAULT_VO_SETTINGS },
    voScript: [
      {
        id: 'vo-seed-1',
        shotId: 'C01',
        speaker: 'Narrator',
        direction: 'quiet, grounded, unhurried',
        line: "You don't hit the wall when your legs give out.",
        audioTags: 'close-mic studio calm',
        emotionalTone: 'Natural & Conversational',
        emotionIntensity: 0.75,
        provider: 'gemini',
        voiceName: 'Kore',
        ttsModel: 'gemini-3.8-flash-lite-tts',
        speed: 1.0,
        pitch: 1.0,
        language: 'en-US',
        pauseAfter: 0.35,
        audioUrl: null,
        durationSec: 5,
        targetWords: 13,
      },
      {
        id: 'vo-seed-2',
        shotId: 'C02',
        speaker: 'Narrator',
        direction: 'subtle tension, intimate clarity',
        line: 'It starts twenty minutes earlier, in drops you never even noticed.',
        audioTags: 'measured emphasis on twenty minutes',
        emotionalTone: 'Dramatic & Cinematic Movie',
        emotionIntensity: 0.8,
        provider: 'gemini',
        voiceName: 'Kore',
        ttsModel: 'gemini-3.8-flash-lite-tts',
        speed: 1.0,
        pitch: 1.0,
        language: 'en-US',
        pauseAfter: 0.35,
        audioUrl: null,
        durationSec: 5,
        targetWords: 13,
      },
      {
        id: 'vo-seed-3',
        shotId: 'C03',
        speaker: 'Narrator',
        direction: 'crisp, assured product clarity',
        line: 'Kinetix reads your sweat sodium and fluid loss in real time.',
        audioTags: 'clean articulation',
        emotionalTone: 'Educational & Explanatory',
        emotionIntensity: 0.75,
        provider: 'gemini',
        voiceName: 'Kore',
        ttsModel: 'gemini-3.8-flash-lite-tts',
        speed: 1.0,
        pitch: 1.0,
        language: 'en-US',
        pauseAfter: 0.35,
        audioUrl: null,
        durationSec: 5,
        targetWords: 13,
      },
      {
        id: 'vo-seed-4',
        shotId: 'C04',
        speaker: 'Narrator',
        direction: 'warm, resolute finish',
        line: 'Know twenty minutes early. Finish strong.',
        audioTags: 'clean pause before finish strong',
        emotionalTone: 'Warm & Friendly',
        emotionIntensity: 0.85,
        provider: 'gemini',
        voiceName: 'Kore',
        ttsModel: 'gemini-3.8-flash-lite-tts',
        speed: 1.0,
        pitch: 1.0,
        language: 'en-US',
        pauseAfter: 0.35,
        audioUrl: null,
        durationSec: 4,
        targetWords: 10,
      },
    ],
    voHasGenerated: true,
    voManuallyEdited: false,
    generationLog: [
      {
        id: 'log-seed-1',
        timestamp: now,
        step: 'Starter Script',
        model: 'Studio Template',
        prompt: 'Initialized standalone Voice Over Studio template',
        seed: null,
        status: 'success',
      },
    ],
  };

  await saveProject(starterProject);
}

export function buildProjectSummary(proj: PipelineProject): ProjectSummary {
  const voLines = Array.isArray(proj.voScript) ? proj.voScript : [];
  const voReadyCount = voLines.filter((v) => Boolean(v.audioUrl)).length;

  return {
    id: proj.id,
    client: proj.client || 'Voiceover',
    productName: proj.product?.name || 'Untitled Script',
    updatedAt: proj.updatedAt,
    voReadyCount,
    totalVoCount: voLines.length,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await seedInitialProjectIfEmpty();
  const dataRoot = getDataRoot();
  const entries = await fs.readdir(dataRoot, { withFileTypes: true });
  const summaries: ProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(dataRoot, entry.name, 'project.json');
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      const proj = JSON.parse(raw) as PipelineProject;
      summaries.push(buildProjectSummary(proj));
    } catch {
      // Skip invalid folder
    }
  }

  return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getProject(projectId: string): Promise<PipelineProject | null> {
  const jsonPath = path.join(getProjectDir(projectId), 'project.json');
  try {
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as PipelineProject;
    return {
      ...parsed,
      client: parsed.client || 'Voiceover',
      product: {
        name: parsed.product?.name || 'Untitled Script',
        description: parsed.product?.description || '',
      },
      voScript: Array.isArray(parsed.voScript) ? parsed.voScript : [],
      voSettings: {
        ...DEFAULT_VO_SETTINGS,
        ...(parsed.voSettings || {}),
      },
      generationLog: Array.isArray(parsed.generationLog) ? parsed.generationLog : [],
    };
  } catch {
    return null;
  }
}

export async function saveProject(project: PipelineProject): Promise<PipelineProject> {
  const id = sanitizeId(project.id);
  const dir = getProjectDir(id);
  await ensureDir(dir);
  await ensureDir(getProjectAssetsDir(id));

  const updated: PipelineProject = {
    ...project,
    id,
    updatedAt: new Date().toISOString(),
  };

  const targetPath = path.join(dir, 'project.json');
  const tmpPath = path.join(
    dir,
    `project.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const payload = JSON.stringify(updated, null, 2);

  try {
    await fs.writeFile(tmpPath, payload, 'utf-8');
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  return updated;
}

export async function deleteProject(projectId: string): Promise<void> {
  const dir = getProjectDir(projectId);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function exportProjectBackupBundle(projectId: string): Promise<{
  format: '52launch-project-backup';
  version: number;
  exportedAt: string;
  project: PipelineProject;
  embeddedAssets: Record<string, string>;
}> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found.');
  }

  const assetsDir = getProjectAssetsDir(projectId);
  const embeddedAssets: Record<string, string> = {};
  try {
    const files = await fs.readdir(assetsDir);
    for (const file of files) {
      if (!isSupportedAssetFilename(file)) continue;
      const buf = await fs.readFile(path.join(assetsDir, file));
      const mime = getMimeFromFilename(file);
      if (mime === 'application/octet-stream') continue;
      embeddedAssets[file] = `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch {
    // No assets folder yet
  }

  return {
    format: '52launch-project-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    embeddedAssets,
  };
}

export async function importProjectBackupBundle(bundle: {
  project?: PipelineProject;
  embeddedAssets?: Record<string, string>;
}): Promise<PipelineProject> {
  const incoming = bundle.project ?? (bundle as unknown as PipelineProject);
  if (!incoming || (!incoming.client && !incoming.product?.name)) {
    throw new Error('This backup file does not contain a valid Voice Over Studio project.');
  }

  const targetId = sanitizeId(
    incoming.id || `${incoming.product?.name || incoming.client || 'vo'}-${Date.now()}`
  );
  const assetsDir = getProjectAssetsDir(targetId);

  const validatedAssets: Array<{ safeName: string; buffer: Buffer }> = [];
  if (bundle.embeddedAssets && typeof bundle.embeddedAssets === 'object') {
    for (const [filename, dataUrl] of Object.entries(bundle.embeddedAssets)) {
      const safeName = path.basename(filename);
      if (safeName !== filename || !isSupportedAssetFilename(safeName)) {
        throw new Error(
          `Backup contains unsupported asset filename "${filename}". Allowed types: audio, image, video, and PDF.`
        );
      }
      const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        throw new Error(`Backup asset "${safeName}" has an invalid data encoding.`);
      }
      const mime = match[1].toLowerCase().trim();
      if (!MIME_TO_ASSET_EXT[mime]) {
        throw new Error(
          `Backup asset "${safeName}" has unsupported MIME type "${mime}".`
        );
      }
      validatedAssets.push({
        safeName,
        buffer: Buffer.from(match[2], 'base64'),
      });
    }
  }

  await ensureDir(assetsDir);
  for (const item of validatedAssets) {
    await fs.writeFile(path.join(assetsDir, item.safeName), item.buffer);
  }

  const rewriteUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const parts = url.split('/assets/');
    if (parts.length === 2) {
      return `/api/projects/${targetId}/assets/${path.basename(parts[1])}`;
    }
    return url;
  };

  const normalized: PipelineProject = {
    id: targetId,
    createdAt: incoming.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    client: incoming.client || 'Voiceover',
    product: {
      name: incoming.product?.name || 'Imported VO Script',
      description: incoming.product?.description || '',
    },
    scriptBrief: incoming.scriptBrief,
    voSettings: {
      ...DEFAULT_VO_SETTINGS,
      ...(incoming.voSettings || {}),
    },
    voScript: (incoming.voScript || []).map((v) => ({
      ...v,
      audioUrl: rewriteUrl(v.audioUrl),
    })),
    voHasGenerated: incoming.voHasGenerated,
    voManuallyEdited: incoming.voManuallyEdited,
    generationLog: Array.isArray(incoming.generationLog) ? incoming.generationLog : [],
  };

  return saveProject(normalized);
}
