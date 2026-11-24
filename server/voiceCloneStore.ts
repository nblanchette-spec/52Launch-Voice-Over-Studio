import fs from 'fs/promises';
import path from 'path';
import { fal } from '@fal-ai/client';
import type { ClonedVoiceProfile } from '../src/types/pipeline.ts';
import { synthesizeWithElevenLabsTTS } from './elevenLabsTts.ts';

function getDataRoot(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

function getRegistryPath(): string {
  return path.join(getDataRoot(), 'cloned-voices.json');
}

export function getCloneSamplesDir(): string {
  return path.join(getDataRoot(), 'cloned-voice-samples');
}

const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
};

const EXT_TO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

export function resolveCloneSamplePath(filename: string): string | null {
  const dir = path.resolve(getCloneSamplesDir());
  const safe = path.basename(filename);
  if (!safe || safe !== filename) return null;
  const ext = path.extname(safe).toLowerCase();
  if (!EXT_TO_MIME[ext]) return null;
  const resolved = path.resolve(dir, safe);
  if (!resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

export async function listClonedVoices(): Promise<ClonedVoiceProfile[]> {
  try {
    const raw = await fs.readFile(getRegistryPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClonedVoiceProfile[]) : [];
  } catch {
    return [];
  }
}

async function saveRegistry(voices: ClonedVoiceProfile[]): Promise<void> {
  const dataRoot = getDataRoot();
  await fs.mkdir(dataRoot, { recursive: true });
  const target = getRegistryPath();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(voices, null, 2), 'utf-8');
  await fs.rename(tmp, target);
}

export async function createClonedVoice(params: {
  name: string;
  description?: string;
  removeBackgroundNoise?: boolean;
  preferredMethod?: 'elevenlabs' | 'chatterbox';
  samples: Array<{ filename: string; dataUrl: string }>;
}): Promise<ClonedVoiceProfile> {
  const cleanName = params.name.trim();
  if (!cleanName) {
    throw new Error('Please provide a name for the cloned voice.');
  }
  if (!Array.isArray(params.samples) || params.samples.length === 0) {
    throw new Error('Upload or record at least one clear voice audio sample.');
  }

  const decodedSamples = params.samples.map((s, idx) => {
    const match = String(s.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error(`Sample ${idx + 1} is not a valid base64 audio recording.`);
    }
    const rawMime = match[1].toLowerCase().trim().split(';')[0];
    const ext = MIME_TO_EXT[rawMime] || 'mp3';
    const mimeType = EXT_TO_MIME[`.${ext}`] || 'audio/mpeg';
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length < 1000) {
      throw new Error(`Sample ${idx + 1} is too short. Record at least a few seconds of speech.`);
    }
    const safeFilename = `${(s.filename || `sample-${idx + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`.replace(
      new RegExp(`\\.${ext}\\.${ext}$`),
      `.${ext}`
    );
    return { filename: safeFilename, mimeType, ext, buffer };
  });

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const falKey = process.env.FAL_KEY?.trim();
  const useElevenLabs =
    params.preferredMethod === 'elevenlabs'
      ? Boolean(apiKey)
      : params.preferredMethod === 'chatterbox'
        ? false
        : Boolean(apiKey);

  if (params.preferredMethod === 'elevenlabs' && !apiKey) {
    throw new Error(
      'ElevenLabs Instant Voice Cloning requires ELEVENLABS_API_KEY in Settings > Secrets (or switch clone engine to Zero-Shot Reference Clone if FAL_KEY is set).'
    );
  }

  if (!useElevenLabs && !falKey) {
    throw new Error(
      'Voice cloning requires ELEVENLABS_API_KEY (ElevenLabs Instant Clone) or FAL_KEY (Zero-Shot Reference Clone) in Settings > Secrets.'
    );
  }

  if (useElevenLabs && apiKey) {
    const form = new FormData();
    form.append('name', cleanName);
    if (params.description?.trim()) {
      form.append('description', params.description.trim());
    }
    form.append('remove_background_noise', params.removeBackgroundNoise !== false ? 'true' : 'false');

    for (const sample of decodedSamples) {
      const uint8 = new Uint8Array(sample.buffer);
      form.append('files', new Blob([uint8], { type: sample.mimeType }), sample.filename);
    }

    const resp = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: form,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      let detail = `ElevenLabs Voice Cloning failed (${resp.status})`;
      try {
        const parsed = JSON.parse(errText) as { detail?: { message?: string } | string };
        if (typeof parsed.detail === 'string') detail = parsed.detail;
        else if (parsed.detail?.message) detail = parsed.detail.message;
      } catch {
        if (errText) detail = `${detail}: ${errText.slice(0, 220)}`;
      }
      throw new Error(detail);
    }

    const result = (await resp.json()) as { voice_id?: string };
    if (!result.voice_id) {
      throw new Error('ElevenLabs did not return a voice_id for the cloned voice.');
    }

    const profile: ClonedVoiceProfile = {
      id: `clone-${Date.now().toString(36)}`,
      name: cleanName,
      description: params.description?.trim() || 'ElevenLabs Instant Voice Clone',
      method: 'elevenlabs',
      elevenLabsVoiceId: result.voice_id,
      removeBackgroundNoise: params.removeBackgroundNoise !== false,
      createdAt: new Date().toISOString(),
    };

    const existing = await listClonedVoices();
    await saveRegistry([profile, ...existing]);
    return profile;
  }

  // Zero-shot Chatterbox clone via Fal.ai: store primary sample on disk cleanly
  const primary = decodedSamples[0];
  const samplesDir = getCloneSamplesDir();
  await fs.mkdir(samplesDir, { recursive: true });
  const storedName = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${primary.ext}`;
  await fs.writeFile(path.join(samplesDir, storedName), primary.buffer);

  const profile: ClonedVoiceProfile = {
    id: `clone-${Date.now().toString(36)}`,
    name: cleanName,
    description: params.description?.trim() || 'Zero-Shot Reference Voice Clone',
    method: 'chatterbox',
    referenceAudioUrl: `/api/cloned-voices/samples/${storedName}`,
    createdAt: new Date().toISOString(),
  };

  const existing = await listClonedVoices();
  await saveRegistry([profile, ...existing]);
  return profile;
}

export async function deleteClonedVoice(id: string): Promise<void> {
  const existing = await listClonedVoices();
  const target = existing.find((v) => v.id === id);
  const remaining = existing.filter((v) => v.id !== id);
  await saveRegistry(remaining);

  if (target?.method === 'elevenlabs' && target.elevenLabsVoiceId && process.env.ELEVENLABS_API_KEY?.trim()) {
    await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(target.elevenLabsVoiceId)}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY.trim() },
    }).catch(() => undefined);
  }

  if (target?.referenceAudioUrl) {
    const fname = path.basename(target.referenceAudioUrl);
    const resolved = resolveCloneSamplePath(fname);
    if (resolved) {
      await fs.rm(resolved, { force: true }).catch(() => undefined);
    }
  }
}

export async function synthesizeWithClonedVoice(options: {
  clonedVoiceId: string;
  text: string;
  emotionalTone?: string;
  emotionIntensity?: number;
  speed?: number;
  language?: string;
  ttsModel?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}): Promise<{
  audioBuffer: Buffer;
  audioBase64: string;
  mimeType: string;
  ext: 'mp3' | 'wav';
  voice: string;
  model: string;
  styleDirective: string;
}> {
  const existing = await listClonedVoices();
  const profile = existing.find(
    (v) => v.id === options.clonedVoiceId || v.elevenLabsVoiceId === options.clonedVoiceId
  );

  if (!profile) {
    throw new Error('Cloned voice profile not found. Select or create a cloned voice first.');
  }

  if (profile.method === 'elevenlabs' && profile.elevenLabsVoiceId) {
    const model =
      options.ttsModel === 'eleven_multilingual_v2' ||
      options.ttsModel === 'eleven_flash_v2_5' ||
      options.ttsModel === 'eleven_turbo_v2_5' ||
      options.ttsModel === 'eleven_v3'
        ? options.ttsModel
        : 'eleven_v3';

    const tts = await synthesizeWithElevenLabsTTS({
      text: options.text,
      voice: profile.elevenLabsVoiceId,
      model,
      emotionalTone: options.emotionalTone,
      emotionIntensity: options.emotionIntensity,
      speed: options.speed,
      language: options.language,
      stability: options.stability,
      similarityBoost: options.similarityBoost,
      style: options.style,
    });

    return {
      audioBuffer: tts.audioBuffer,
      audioBase64: tts.audioBase64,
      mimeType: tts.mimeType,
      ext: 'mp3',
      voice: profile.name,
      model: `${tts.model} (Clone)`,
      styleDirective: tts.styleDirective,
    };
  }

  // Chatterbox Zero-Shot Reference Clone via Fal
  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) {
    throw new Error('FAL_KEY is required in Settings > Secrets for Zero-Shot Reference Voice Cloning.');
  }

  const samplePath = profile.referenceAudioUrl
    ? resolveCloneSamplePath(path.basename(profile.referenceAudioUrl))
    : null;
  if (!samplePath) {
    throw new Error('Reference voice audio file is missing on disk.');
  }

  const sampleBuffer = await fs.readFile(samplePath);
  const ext = path.extname(samplePath).toLowerCase();
  const mime = EXT_TO_MIME[ext] || 'audio/mpeg';

  fal.config({ credentials: falKey });
  const uploadedRefUrl = await fal.storage.upload(new Blob([new Uint8Array(sampleBuffer)], { type: mime }));

  const exaggeration = Math.max(
    0.25,
    Math.min(1.0, typeof options.emotionIntensity === 'number' ? options.emotionIntensity : 0.6)
  );

  const result = await fal.subscribe('fal-ai/chatterbox/text-to-speech', {
    input: {
      text: options.text.trim(),
      audio_url: uploadedRefUrl,
      exaggeration,
    },
    logs: false,
  });

  const data = result.data as { audio?: { url?: string; content_type?: string } };
  const audioUrl = data?.audio?.url;
  if (!audioUrl) {
    throw new Error('Chatterbox voice clone finished without returning an audio URL.');
  }

  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) {
    throw new Error(`Could not download cloned voice audio (${audioResp.status}).`);
  }
  const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
  const outMime = data?.audio?.content_type || audioResp.headers.get('content-type') || 'audio/wav';
  const outExt: 'mp3' | 'wav' = outMime.includes('mpeg') || outMime.includes('mp3') ? 'mp3' : 'wav';

  return {
    audioBuffer,
    audioBase64: audioBuffer.toString('base64'),
    mimeType: outMime,
    ext: outExt,
    voice: profile.name,
    model: 'chatterbox_zero_shot',
    styleDirective: `Cloned reference "${profile.name}" (exaggeration ${exaggeration.toFixed(2)})`,
  };
}
