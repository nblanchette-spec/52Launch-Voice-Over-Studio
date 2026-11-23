import { fal } from '@fal-ai/client';
import type { ElevenLabsTtsModel } from '../src/types/pipeline.ts';
import {
  ALL_ELEVENLABS_VOICES,
  EMOTIONAL_TONES,
  type VoicePresetMeta,
} from '../src/utils/voPresets.ts';

export const VALID_ELEVENLABS_MODELS: ElevenLabsTtsModel[] = [
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
];

function resolveElevenLabsVoiceMeta(voiceInput?: string): {
  voiceId: string;
  falVoiceName: string;
  displayName: string;
} {
  const cleaned = (voiceInput || '').trim();
  if (!cleaned) {
    const first = ALL_ELEVENLABS_VOICES[0];
    return {
      voiceId: first.id,
      falVoiceName: first.falVoiceName || first.displayName,
      displayName: first.displayName,
    };
  }

  const byIdOrName = ALL_ELEVENLABS_VOICES.find(
    (v) =>
      v.id === cleaned ||
      v.displayName.toLowerCase() === cleaned.toLowerCase() ||
      v.falVoiceName?.toLowerCase() === cleaned.toLowerCase()
  );

  if (byIdOrName) {
    return {
      voiceId: byIdOrName.id,
      falVoiceName: byIdOrName.falVoiceName || byIdOrName.displayName,
      displayName: byIdOrName.displayName,
    };
  }

  // Custom ElevenLabs Voice ID or Voice Name entered by the user
  return {
    voiceId: cleaned,
    falVoiceName: cleaned,
    displayName: cleaned,
  };
}

function mapFalElevenLabsEndpoint(model: ElevenLabsTtsModel): string {
  switch (model) {
    case 'eleven_v3':
      return 'fal-ai/elevenlabs/tts/eleven-v3';
    case 'eleven_multilingual_v2':
      return 'fal-ai/elevenlabs/tts/multilingual-v2';
    case 'eleven_flash_v2_5':
    case 'eleven_turbo_v2_5':
    default:
      return 'fal-ai/elevenlabs/tts/turbo-v2.5';
  }
}

function clampElevenLabsSpeed(speed?: number): number {
  const raw = Number(speed);
  if (!Number.isFinite(raw)) return 1.0;
  return Math.max(0.7, Math.min(1.2, Number(raw.toFixed(2))));
}

function clampUnit(val: number | undefined, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Number(n.toFixed(2))));
}

function prepareElevenLabsText(params: {
  text: string;
  model: ElevenLabsTtsModel;
  emotionalTone?: string;
}): string {
  const trimmed = params.text.trim();
  if (params.model !== 'eleven_v3' || !params.emotionalTone) {
    return trimmed;
  }
  const toneMeta = EMOTIONAL_TONES.find((t) => t.id === params.emotionalTone);
  if (!toneMeta?.elevenLabsTag) return trimmed;
  // Do not double-prefix if the user already inserted an Eleven v3 audio tag
  if (/^\[[^\]]+\]/.test(trimmed)) return trimmed;
  return `${toneMeta.elevenLabsTag} ${trimmed}`;
}

export async function listElevenLabsVoices(): Promise<{
  voices: VoicePresetMeta[];
  source: 'api' | 'catalog';
}> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return { voices: ALL_ELEVENLABS_VOICES, source: 'catalog' };
  }

  try {
    const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });
    if (!resp.ok) {
      return { voices: ALL_ELEVENLABS_VOICES, source: 'catalog' };
    }
    const data = (await resp.json()) as {
      voices?: Array<{
        voice_id: string;
        name: string;
        category?: string;
        description?: string;
        labels?: Record<string, string>;
      }>;
    };
    const apiVoices = Array.isArray(data.voices) ? data.voices : [];
    if (apiVoices.length === 0) {
      return { voices: ALL_ELEVENLABS_VOICES, source: 'catalog' };
    }

    const catalogById = new Map(ALL_ELEVENLABS_VOICES.map((v) => [v.id, v]));
    const merged: VoicePresetMeta[] = [...ALL_ELEVENLABS_VOICES];

    for (const v of apiVoices) {
      if (catalogById.has(v.voice_id)) continue;
      const genderLabel = (v.labels?.gender || '').toLowerCase();
      const gender: 'Female' | 'Male' | 'Neutral' =
        genderLabel === 'female'
          ? 'Female'
          : genderLabel === 'male'
            ? 'Male'
            : 'Neutral';
      const accent = v.labels?.accent || v.category || 'Custom';
      const tone = v.labels?.descriptive || v.labels?.use_case || 'ElevenLabs Voice';
      merged.push({
        id: v.voice_id,
        falVoiceName: v.voice_id,
        displayName: v.name,
        gender,
        timbre: `${accent} · ${tone}`,
        description:
          v.description ||
          `ElevenLabs ${v.category || 'library'} voice (${accent}).`,
        bestFor: v.labels?.use_case || 'Narration & Commercials',
        defaultPitch: 1.0,
        sampleSentence:
          'Designed for quiet precision when every second counts.',
        tags: [v.category || 'Library'].filter(Boolean),
      });
    }

    return { voices: merged, source: 'api' };
  } catch {
    return { voices: ALL_ELEVENLABS_VOICES, source: 'catalog' };
  }
}

export async function synthesizeWithElevenLabsTTS(options: {
  text: string;
  voice?: string;
  model?: ElevenLabsTtsModel;
  emotionalTone?: string;
  emotionIntensity?: number;
  speed?: number;
  language?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  skipSpeedText?: boolean;
}): Promise<{
  audioBuffer: Buffer;
  audioBase64: string;
  mimeType: string;
  ext: 'mp3';
  voice: string;
  model: ElevenLabsTtsModel;
  styleDirective: string;
  providerUsed: 'elevenlabs-direct' | 'fal-elevenlabs';
}> {
  const model: ElevenLabsTtsModel = VALID_ELEVENLABS_MODELS.includes(
    options.model as ElevenLabsTtsModel
  )
    ? (options.model as ElevenLabsTtsModel)
    : 'eleven_v3';

  const voiceMeta = resolveElevenLabsVoiceMeta(options.voice);
  const preparedText = prepareElevenLabsText({
    text: options.text,
    model,
    emotionalTone: options.emotionalTone,
  });

  const stability = clampUnit(options.stability, 0.5);
  const similarityBoost = clampUnit(options.similarityBoost, 0.75);
  const styleVal = clampUnit(
    options.style,
    typeof options.emotionIntensity === 'number'
      ? Math.max(0, Math.min(0.85, (options.emotionIntensity - 0.2) * 0.8))
      : 0.2
  );
  const speedVal = options.skipSpeedText ? 1.0 : clampElevenLabsSpeed(options.speed);
  const langShort = (options.language || 'en-US').split('-')[0].toLowerCase();

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const falKey = process.env.FAL_KEY?.trim();

  if (!apiKey && !falKey) {
    throw new Error(
      'ElevenLabs synthesis requires ELEVENLABS_API_KEY or FAL_KEY in server environment variables.'
    );
  }

  // 1. Direct ElevenLabs API when ELEVENLABS_API_KEY is configured
  if (apiKey) {
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceMeta.voiceId
    )}?output_format=mp3_44100_128`;

    const voiceSettings: Record<string, unknown> = {
      stability,
      similarity_boost: similarityBoost,
      speed: speedVal,
    };
    if (model === 'eleven_multilingual_v2' || model === 'eleven_v3') {
      voiceSettings.style = styleVal;
      voiceSettings.use_speaker_boost = true;
    }

    const body: Record<string, unknown> = {
      text: preparedText,
      model_id: model,
      voice_settings: voiceSettings,
    };
    if (
      langShort &&
      (model === 'eleven_flash_v2_5' || model === 'eleven_turbo_v2_5')
    ) {
      body.language_code = langShort;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const arrayBuf = await resp.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuf);
      return {
        audioBuffer,
        audioBase64: audioBuffer.toString('base64'),
        mimeType: 'audio/mpeg',
        ext: 'mp3',
        voice: voiceMeta.displayName,
        model,
        styleDirective: `${options.emotionalTone || 'Natural'} (stability ${stability}, similarity ${similarityBoost})`,
        providerUsed: 'elevenlabs-direct',
      };
    }

    const errText = await resp.text().catch(() => '');
    // If direct API failed and FAL_KEY is available, fall through to Fal; otherwise throw clear error
    if (!falKey) {
      let detail = `ElevenLabs API error (${resp.status})`;
      try {
        const parsed = JSON.parse(errText) as { detail?: { message?: string } | string };
        if (typeof parsed.detail === 'string') detail = parsed.detail;
        else if (parsed.detail?.message) detail = parsed.detail.message;
      } catch {
        if (errText) detail = `${detail}: ${errText.slice(0, 200)}`;
      }
      throw new Error(detail);
    }
  }

  // 2. ElevenLabs via Fal.ai
  fal.config({ credentials: falKey! });
  const falEndpoint = mapFalElevenLabsEndpoint(model);
  const falInput: Record<string, unknown> = {
    text: preparedText,
    voice: voiceMeta.falVoiceName,
    stability,
    similarity_boost: similarityBoost,
    speed: speedVal,
  };
  if (model === 'eleven_multilingual_v2' || model === 'eleven_v3') {
    falInput.style = styleVal;
  }
  if (
    langShort &&
    (model === 'eleven_flash_v2_5' || model === 'eleven_turbo_v2_5')
  ) {
    falInput.language_code = langShort;
  }

  const result = await fal.subscribe(falEndpoint, {
    input: falInput,
    logs: false,
  });

  const data = result.data as { audio?: { url?: string } };
  const audioUrl = data?.audio?.url;
  if (!audioUrl) {
    throw new Error('ElevenLabs via Fal completed without returning an audio file.');
  }

  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) {
    throw new Error(`Could not download ElevenLabs audio (${audioResp.status}).`);
  }
  const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

  return {
    audioBuffer,
    audioBase64: audioBuffer.toString('base64'),
    mimeType: 'audio/mpeg',
    ext: 'mp3',
    voice: voiceMeta.displayName,
    model,
    styleDirective: `${options.emotionalTone || 'Natural'} via Fal (${falEndpoint})`,
    providerUsed: 'fal-elevenlabs',
  };
}
