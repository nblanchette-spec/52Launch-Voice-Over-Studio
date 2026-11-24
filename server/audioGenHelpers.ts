import fs from 'fs/promises';
import { fal } from '@fal-ai/client';
import type { EmotionalBeat, MusicEngineId } from '../src/types/pipeline.ts';

function clampNumber(val: number | undefined, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function generateSoundEffect(options: {
  prompt: string;
  durationSec?: number;
  promptInfluence?: number;
}): Promise<{
  audioBuffer: Buffer;
  mimeType: string;
  ext: 'mp3' | 'wav';
  engineUsed: string;
}> {
  const text = options.prompt.trim();
  if (!text) {
    throw new Error('Describe the sound effect before generating.');
  }

  const durationSeconds = Number(clampNumber(options.durationSec, 0.5, 22, 2.5).toFixed(1));
  const promptInfluence = Number(clampNumber(options.promptInfluence, 0, 1, 0.45).toFixed(2));

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const falKey = process.env.FAL_KEY?.trim();

  if (!apiKey && !falKey) {
    throw new Error(
      'Sound generation requires ELEVENLABS_API_KEY or FAL_KEY in Settings > Secrets.'
    );
  }

  // 1. Direct ElevenLabs Sound Generation API
  if (apiKey) {
    const resp = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        duration_seconds: durationSeconds,
        prompt_influence: promptInfluence,
      }),
    });

    if (resp.ok) {
      const audioBuffer = Buffer.from(await resp.arrayBuffer());
      return {
        audioBuffer,
        mimeType: 'audio/mpeg',
        ext: 'mp3',
        engineUsed: 'elevenlabs-sound-generation',
      };
    }

    const errText = await resp.text().catch(() => '');
    if (!falKey) {
      let detail = `ElevenLabs SFX error (${resp.status})`;
      try {
        const parsed = JSON.parse(errText) as { detail?: { message?: string } | string };
        if (typeof parsed.detail === 'string') detail = parsed.detail;
        else if (parsed.detail?.message) detail = parsed.detail.message;
      } catch {
        if (errText) detail = `${detail}: ${errText.slice(0, 220)}`;
      }
      throw new Error(detail);
    }
  }

  // 2. Fal.ai ElevenLabs Sound Effects fallback
  fal.config({ credentials: falKey! });
  const result = await fal.subscribe('fal-ai/elevenlabs/sound-effects/v2', {
    input: {
      text,
      duration_seconds: durationSeconds,
      prompt_influence: promptInfluence,
    },
    logs: false,
  });

  const data = result.data as { audio?: { url?: string; content_type?: string } };
  const audioUrl = data?.audio?.url;
  if (!audioUrl) {
    throw new Error('Fal ElevenLabs Sound Effects did not return an audio file.');
  }

  const dl = await fetch(audioUrl);
  if (!dl.ok) {
    throw new Error(`Could not download generated SFX (${dl.status}).`);
  }
  const audioBuffer = Buffer.from(await dl.arrayBuffer());
  const mime = data?.audio?.content_type || 'audio/mpeg';
  const ext: 'mp3' | 'wav' = mime.includes('wav') ? 'wav' : 'mp3';

  return {
    audioBuffer,
    mimeType: mime,
    ext,
    engineUsed: 'fal-elevenlabs-sfx-v2',
  };
}

export async function generateSyncedFoleyVideoBed(options: {
  videoFilePath: string;
  videoMimeType: string;
  prompt: string;
  durationSec?: number;
}): Promise<{
  videoBuffer: Buffer;
  mimeType: string;
  ext: 'mp4';
  engineUsed: string;
}> {
  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) {
    throw new Error('Full-video MMAudio V2 foley synthesis requires FAL_KEY in Settings > Secrets.');
  }

  fal.config({ credentials: falKey });
  const buf = await fs.readFile(options.videoFilePath);
  const uploadedVideoUrl = await fal.storage.upload(
    new Blob([new Uint8Array(buf)], { type: options.videoMimeType || 'video/mp4' })
  );

  const duration = Math.round(clampNumber(options.durationSec, 1, 30, 8));
  const result = await fal.subscribe('fal-ai/mmaudio-v2', {
    input: {
      video_url: uploadedVideoUrl,
      prompt:
        options.prompt.trim() ||
        'Organic realistic on-camera foley audio matching footsteps, surfaces, handling, and natural room tone',
      duration,
    },
    logs: false,
  });

  const data = result.data as { video?: { url?: string; content_type?: string } };
  const videoUrl = data?.video?.url;
  if (!videoUrl) {
    throw new Error('MMAudio V2 completed without returning a synced video file.');
  }

  const dl = await fetch(videoUrl);
  if (!dl.ok) {
    throw new Error(`Could not download synced foley video (${dl.status}).`);
  }

  return {
    videoBuffer: Buffer.from(await dl.arrayBuffer()),
    mimeType: data?.video?.content_type || 'video/mp4',
    ext: 'mp4',
    engineUsed: 'fal-mmaudio-v2',
  };
}

function buildMusicPromptAndPlan(options: {
  genre: string;
  bpm: number;
  musicalKey: string;
  forceInstrumental: boolean;
  instrumentationPalette: string[];
  negativeStyles: string;
  customDirection: string;
  beats: EmotionalBeat[];
  targetDurationSec: number;
}) {
  const sortedBeats = [...(options.beats || [])].sort(
    (a, b) => a.startTimeSec - b.startTimeSec
  );

  const paletteText =
    options.instrumentationPalette.length > 0
      ? options.instrumentationPalette.join(', ')
      : 'Orchestral strings, felt piano, warm sub bass';

  const beatTimelineDesc = sortedBeats
    .map((b, idx) => {
      const end = (b.startTimeSec + b.durationSec).toFixed(0);
      return `Section ${idx + 1} (${b.startTimeSec.toFixed(0)}s-${end}s) "${b.label}": emotion ${b.emotion}, energy ${b.energy}/10, instrumentation ${b.instrumentation}${b.tempoFeel ? `, feel ${b.tempoFeel}` : ''}`;
    })
    .join('; ');

  const promptParts = [
    `${options.genre} film/commercial score at ${Math.round(options.bpm)} BPM in ${options.musicalKey}.`,
    `Core palette: ${paletteText}.`,
    options.forceInstrumental ? 'Strictly instrumental, no lead vocals.' : '',
    beatTimelineDesc ? `Emotional progression: ${beatTimelineDesc}.` : '',
    options.customDirection?.trim() ? `Direction: ${options.customDirection.trim()}.` : '',
  ].filter(Boolean);

  const prompt = promptParts.join(' ').slice(0, 3900);

  const positiveGlobal = [
    options.genre,
    `${Math.round(options.bpm)} BPM`,
    options.musicalKey,
    ...options.instrumentationPalette.slice(0, 6),
    options.forceInstrumental ? 'instrumental' : 'vocal harmony',
  ].filter(Boolean);

  const negativeGlobal = [
    ...(options.negativeStyles || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(options.forceInstrumental ? ['vocals', 'singing', 'spoken word'] : []),
  ];

  const totalSec = clampNumber(
    options.targetDurationSec ||
      sortedBeats.reduce((sum, b) => Math.max(sum, b.startTimeSec + b.durationSec), 0),
    5,
    240,
    30
  );

  const sections =
    sortedBeats.length > 0
      ? sortedBeats.map((b) => ({
          section_name: b.label || 'Score Section',
          duration_ms: Math.round(clampNumber(b.durationSec, 3, 120, 8) * 1000),
          positive_local_styles: [
            b.emotion,
            ...b.instrumentation
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 4),
            b.energy >= 8
              ? 'high energy climax'
              : b.energy <= 3
                ? 'subtle sparse minimalist'
                : 'medium dynamic build',
            b.tempoFeel || '',
          ].filter(Boolean),
          negative_local_styles: (b.negativeStyles || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          lines:
            !options.forceInstrumental && b.lyricsLine?.trim()
              ? [b.lyricsLine.trim()]
              : [],
        }))
      : [
          {
            section_name: 'Main Theme',
            duration_ms: Math.round(totalSec * 1000),
            positive_local_styles: positiveGlobal,
            negative_local_styles: negativeGlobal,
            lines: [],
          },
        ];

  return {
    prompt,
    totalSec: Math.round(totalSec),
    compositionPlan: {
      positive_global_styles: positiveGlobal,
      negative_global_styles: negativeGlobal,
      sections,
    },
  };
}

export async function generateMusicScore(options: {
  engine: MusicEngineId;
  genre: string;
  bpm: number;
  musicalKey: string;
  forceInstrumental: boolean;
  instrumentationPalette: string[];
  negativeStyles: string;
  customDirection: string;
  beats: EmotionalBeat[];
  targetDurationSec: number;
}): Promise<{
  audioBuffer: Buffer;
  mimeType: string;
  ext: 'mp3' | 'wav';
  engineUsed: string;
  promptSummary: string;
  durationSec: number;
}> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const falKey = process.env.FAL_KEY?.trim();

  if (!apiKey && !falKey) {
    throw new Error(
      'Music composition requires ELEVENLABS_API_KEY or FAL_KEY in Settings > Secrets.'
    );
  }

  const { prompt, totalSec, compositionPlan } = buildMusicPromptAndPlan(options);

  if (options.engine === 'elevenlabs_music' && apiKey) {
    // Try structured composition_plan first for exact emotional beat alignment
    const planResp = await fetch(
      'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          model_id: 'music_v1',
          composition_plan: compositionPlan,
        }),
      }
    );

    if (planResp.ok) {
      const audioBuffer = Buffer.from(await planResp.arrayBuffer());
      return {
        audioBuffer,
        mimeType: 'audio/mpeg',
        ext: 'mp3',
        engineUsed: 'elevenlabs-music-plan',
        promptSummary: prompt,
        durationSec: totalSec,
      };
    }

    // Fallback to prompt + music_length_ms if plan parameters hit 422
    const promptResp = await fetch(
      'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          model_id: 'music_v1',
          prompt,
          music_length_ms: Math.round(clampNumber(totalSec, 3, 300, 30) * 1000),
          force_instrumental: options.forceInstrumental,
        }),
      }
    );

    if (promptResp.ok) {
      const audioBuffer = Buffer.from(await promptResp.arrayBuffer());
      return {
        audioBuffer,
        mimeType: 'audio/mpeg',
        ext: 'mp3',
        engineUsed: 'elevenlabs-music-prompt',
        promptSummary: prompt,
        durationSec: totalSec,
      };
    }

    const errText = await promptResp.text().catch(() => '');
    if (!falKey) {
      let detail = `ElevenLabs Music error (${promptResp.status})`;
      try {
        const parsed = JSON.parse(errText) as { detail?: { message?: string } | string };
        if (typeof parsed.detail === 'string') detail = parsed.detail;
        else if (parsed.detail?.message) detail = parsed.detail.message;
      } catch {
        if (errText) detail = `${detail}: ${errText.slice(0, 220)}`;
      }
      throw new Error(detail);
    }
  }

  if (!falKey) {
    throw new Error(
      'This music engine requires FAL_KEY in Settings > Secrets (or switch to ElevenLabs Music with ELEVENLABS_API_KEY).'
    );
  }

  fal.config({ credentials: falKey });

  if (options.engine === 'elevenlabs_music') {
    try {
      const res = await fal.subscribe('fal-ai/elevenlabs/music', {
        input: {
          prompt,
          music_length_ms: Math.round(clampNumber(totalSec, 3, 300, 30) * 1000),
          force_instrumental: options.forceInstrumental,
        },
        logs: false,
      });
      const data = res.data as { audio?: { url?: string; content_type?: string } };
      const audioUrl = data?.audio?.url;
      if (audioUrl) {
        const dl = await fetch(audioUrl);
        if (dl.ok) {
          const audioBuffer = Buffer.from(await dl.arrayBuffer());
          const mime = data?.audio?.content_type || 'audio/mpeg';
          return {
            audioBuffer,
            mimeType: mime,
            ext: mime.includes('wav') ? 'wav' : 'mp3',
            engineUsed: 'fal-elevenlabs-music',
            promptSummary: prompt,
            durationSec: totalSec,
          };
        }
      }
    } catch {
      // Fall through to ACE-Step if Fal ElevenLabs music fails
    }
  }

  // Fal ACE-Step Score Synthesis
  const tags = [
    options.genre,
    `${Math.round(options.bpm)} bpm`,
    options.musicalKey,
    ...options.instrumentationPalette,
    ...options.beats.map((b) => b.emotion),
  ]
    .filter(Boolean)
    .join(', ');

  const lyricsLines = options.forceInstrumental
    ? '[inst]'
    : options.beats
        .map((b) => `[${b.label}]\n${b.lyricsLine?.trim() || '(instrumental passage)'}`)
        .join('\n');

  const aceRes = await fal.subscribe('fal-ai/ace-step', {
    input: {
      tags,
      lyrics: lyricsLines || '[inst]',
      duration: clampNumber(totalSec, 10, 240, 30),
    },
    logs: false,
  });

  const aceData = aceRes.data as { audio?: { url?: string; content_type?: string } };
  const aceUrl = aceData?.audio?.url;
  if (!aceUrl) {
    throw new Error('Music generation completed without returning an audio file.');
  }

  const dl = await fetch(aceUrl);
  if (!dl.ok) {
    throw new Error(`Could not download composed music track (${dl.status}).`);
  }

  const audioBuffer = Buffer.from(await dl.arrayBuffer());
  const mime = aceData?.audio?.content_type || 'audio/wav';
  return {
    audioBuffer,
    mimeType: mime,
    ext: mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : 'wav',
    engineUsed: 'fal-ace-step',
    promptSummary: prompt,
    durationSec: totalSec,
  };
}
