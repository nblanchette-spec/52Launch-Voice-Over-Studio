import fs from 'fs/promises';
import { fal } from '@fal-ai/client';
import type {
  EditSfxEngineId,
  EmotionalBeat,
  FoleyBedEngineId,
  FoleyCueEngineId,
  MusicEngineId,
} from '../src/types/pipeline.ts';

function clampNumber(
  val: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function downloadAudioUrl(
  url: string,
  fallbackMime = 'audio/mpeg'
): Promise<{ audioBuffer: Buffer; mimeType: string; ext: 'mp3' | 'wav' }> {
  const dl = await fetch(url);
  if (!dl.ok) {
    throw new Error(`Could not download generated audio (${dl.status}).`);
  }
  const headerMime = dl.headers.get('content-type')?.split(';')[0]?.trim();
  const mimeType = headerMime || fallbackMime;
  const audioBuffer = Buffer.from(await dl.arrayBuffer());
  const ext: 'mp3' | 'wav' = mimeType.includes('wav') ? 'wav' : 'mp3';
  return { audioBuffer, mimeType, ext };
}

async function generateWithElevenLabsSfx(
  text: string,
  durationSeconds: number,
  promptInfluence: number,
  apiKey?: string,
  falKey?: string
): Promise<{
  audioBuffer: Buffer;
  mimeType: string;
  ext: 'mp3' | 'wav';
  engineUsed: string;
}> {
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

  if (!falKey) {
    throw new Error('ElevenLabs SFX requires ELEVENLABS_API_KEY or FAL_KEY in Settings > Secrets.');
  }

  fal.config({ credentials: falKey });
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

  const dl = await downloadAudioUrl(audioUrl, data?.audio?.content_type || 'audio/mpeg');
  return {
    ...dl,
    mimeType: data?.audio?.content_type || dl.mimeType,
    engineUsed: 'fal-elevenlabs-sfx-v2',
  };
}

export async function generateSoundEffect(options: {
  prompt: string;
  durationSec?: number;
  promptInfluence?: number;
  engine?: FoleyCueEngineId | EditSfxEngineId;
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
  const promptInfluence = Number(clampNumber(options.promptInfluence, 0, 1, 0.55).toFixed(2));
  const engine = options.engine || 'elevenlabs_sfx';

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const falKey = process.env.FAL_KEY?.trim();

  if (!apiKey && !falKey) {
    throw new Error(
      'Sound generation requires FAL_KEY or ELEVENLABS_API_KEY in Settings > Secrets.'
    );
  }

  // If a Fal-specific model was chosen but only ELEVENLABS_API_KEY is configured, degrade cleanly
  if (engine !== 'elevenlabs_sfx' && !falKey) {
    return generateWithElevenLabsSfx(text, durationSeconds, promptInfluence, apiKey, undefined);
  }

  if (engine === 'mirelo_sfx') {
    fal.config({ credentials: falKey! });
    const res = await fal.subscribe('mirelo-ai/sfx2.0/text-to-audio', {
      input: {
        prompt: text,
        duration: clampNumber(durationSeconds, 1, 30, 3),
        negative_prompt: 'music, singing, speech, dialogue, background chatter',
        num_samples: 1,
        upload_audio_format: 'mp3',
      },
      logs: false,
    });
    const data = res.data as {
      audio?: Array<{ url?: string; content_type?: string }> | { url?: string; content_type?: string };
    };
    const item = Array.isArray(data?.audio) ? data.audio[0] : data?.audio;
    if (!item?.url) {
      throw new Error('Mirelo SFX 2.0 did not return an audio file.');
    }
    const dl = await downloadAudioUrl(item.url, item.content_type || 'audio/mpeg');
    return {
      ...dl,
      mimeType: item.content_type || dl.mimeType,
      engineUsed: 'fal-mirelo-sfx-v2',
    };
  }

  if (engine === 'sonilo_sfx') {
    fal.config({ credentials: falKey! });
    const res = await fal.subscribe('sonilo/v1.1/text-to-sound-effects', {
      input: {
        prompt: text,
        duration: clampNumber(durationSeconds, 0.5, 60, 2.5),
        audio_format: 'mp3',
      },
      logs: false,
    });
    const data = res.data as { audio?: { url?: string; content_type?: string } };
    if (!data?.audio?.url) {
      throw new Error('Sonilo v1.1 SFX did not return an audio file.');
    }
    const dl = await downloadAudioUrl(data.audio.url, data.audio.content_type || 'audio/mpeg');
    return {
      ...dl,
      mimeType: data.audio.content_type || dl.mimeType,
      engineUsed: 'fal-sonilo-v1.1-sfx',
    };
  }

  if (engine === 'stable_audio_sfx') {
    fal.config({ credentials: falKey! });
    const res = await fal.subscribe('fal-ai/stable-audio-3/small/sfx/text-to-audio', {
      input: {
        prompt: text,
        duration: clampNumber(durationSeconds, 0.5, 45, 3),
        negative_prompt: 'music, speech, singing, low quality, distortion',
        guidance_scale: Math.round((4 + promptInfluence * 6) * 10) / 10,
        output_format: 'mp3',
      },
      logs: false,
    });
    const data = res.data as { audio?: { url?: string; content_type?: string } };
    if (!data?.audio?.url) {
      throw new Error('Stable Audio 3 SFX did not return an audio file.');
    }
    const dl = await downloadAudioUrl(data.audio.url, data.audio.content_type || 'audio/mpeg');
    return {
      ...dl,
      mimeType: data.audio.content_type || dl.mimeType,
      engineUsed: 'fal-stable-audio-3-sfx',
    };
  }

  return generateWithElevenLabsSfx(text, durationSeconds, promptInfluence, apiKey, falKey);
}

export async function generateSyncedFoleyVideoBed(options: {
  videoFilePath: string;
  videoMimeType: string;
  prompt: string;
  durationSec?: number;
  engine?: FoleyBedEngineId;
}): Promise<{
  mediaType: 'audio' | 'video';
  buffer: Buffer;
  mimeType: string;
  ext: 'mp3' | 'wav' | 'mp4';
  engineUsed: string;
}> {
  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) {
    throw new Error('Full-video foley bed synthesis requires FAL_KEY in Settings > Secrets.');
  }

  const engine: FoleyBedEngineId = options.engine || 'mirelo_v2a';
  fal.config({ credentials: falKey });

  const buf = await fs.readFile(options.videoFilePath);
  const uploadedVideoUrl = await fal.storage.upload(
    new Blob([new Uint8Array(buf)], { type: options.videoMimeType || 'video/mp4' })
  );

  const foleyPrompt =
    options.prompt.trim() ||
    'Organic realistic on-camera foley audio matching footsteps, surfaces, handling, and natural room tone';
  const duration = Math.round(clampNumber(options.durationSec, 1, 60, 8));

  if (engine === 'mirelo_v2a') {
    const res = await fal.subscribe('mirelo-ai/sfx2.0/video-to-audio', {
      input: {
        video_url: uploadedVideoUrl,
        text_prompt: foleyPrompt,
        negative_prompt: 'music, soundtrack, singing, dialogue',
        duration,
        num_samples: 1,
        preserve_speech: false,
        upload_audio_format: 'mp3',
      },
      logs: false,
    });
    const data = res.data as {
      audio?: Array<{ url?: string; content_type?: string }> | { url?: string; content_type?: string };
    };
    const item = Array.isArray(data?.audio) ? data.audio[0] : data?.audio;
    if (!item?.url) {
      throw new Error('Mirelo SFX 2.0 Video-to-Audio did not return a foley track.');
    }
    const dl = await downloadAudioUrl(item.url, item.content_type || 'audio/mpeg');
    return {
      mediaType: 'audio',
      buffer: dl.audioBuffer,
      mimeType: item.content_type || dl.mimeType,
      ext: dl.ext,
      engineUsed: 'fal-mirelo-sfx2-video-to-audio',
    };
  }

  if (engine === 'hunyuan_foley') {
    const res = await fal.subscribe('fal-ai/hunyuan-video-foley', {
      input: {
        video_url: uploadedVideoUrl,
        text_prompt: foleyPrompt,
        negative_prompt: 'noisy, harsh, background music, singing',
        guidance_scale: 4.5,
      },
      logs: false,
    });
    const data = res.data as { video?: { url?: string; content_type?: string } };
    if (!data?.video?.url) {
      throw new Error('HunyuanVideo-Foley completed without returning a synced video.');
    }
    const dl = await fetch(data.video.url);
    if (!dl.ok) {
      throw new Error(`Could not download HunyuanVideo-Foley video (${dl.status}).`);
    }
    return {
      mediaType: 'video',
      buffer: Buffer.from(await dl.arrayBuffer()),
      mimeType: data.video.content_type || 'video/mp4',
      ext: 'mp4',
      engineUsed: 'fal-hunyuan-video-foley',
    };
  }

  if (engine === 'thinksound') {
    const res = await fal.subscribe('fal-ai/thinksound', {
      input: {
        video_url: uploadedVideoUrl,
        prompt: foleyPrompt,
        cfg_scale: 5,
      },
      logs: false,
    });
    const data = res.data as { video?: { url?: string; content_type?: string } };
    if (!data?.video?.url) {
      throw new Error('ThinkSound CoT completed without returning a synced video.');
    }
    const dl = await fetch(data.video.url);
    if (!dl.ok) {
      throw new Error(`Could not download ThinkSound foley video (${dl.status}).`);
    }
    return {
      mediaType: 'video',
      buffer: Buffer.from(await dl.arrayBuffer()),
      mimeType: data.video.content_type || 'video/mp4',
      ext: 'mp4',
      engineUsed: 'fal-thinksound',
    };
  }

  // Fallback / default: MMAudio V2
  const result = await fal.subscribe('fal-ai/mmaudio-v2', {
    input: {
      video_url: uploadedVideoUrl,
      prompt: foleyPrompt,
      duration: Math.min(30, duration),
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
    mediaType: 'video',
    buffer: Buffer.from(await dl.arrayBuffer()),
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
    options.negativeStyles?.trim() ? `Avoid: ${options.negativeStyles.trim()}.` : '',
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
    sortedBeats,
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
  videoFilePath?: string | null;
  videoMimeType?: string;
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

  const { prompt, totalSec, sortedBeats, compositionPlan } = buildMusicPromptAndPlan(options);

  if (options.engine === 'elevenlabs_music' && apiKey) {
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
    const res = await fal.subscribe('fal-ai/elevenlabs/music', {
      input: {
        prompt,
        music_length_ms: Math.round(clampNumber(totalSec, 3, 300, 30) * 1000),
        force_instrumental: options.forceInstrumental,
      },
      logs: false,
    });
    const data = res.data as { audio?: { url?: string; content_type?: string } };
    if (!data?.audio?.url) {
      throw new Error('Fal ElevenLabs Music did not return an audio file.');
    }
    const dl = await downloadAudioUrl(data.audio.url, data.audio.content_type || 'audio/mpeg');
    return {
      ...dl,
      mimeType: data.audio.content_type || dl.mimeType,
      engineUsed: 'fal-elevenlabs-music',
      promptSummary: prompt,
      durationSec: totalSec,
    };
  }

  if (options.engine === 'minimax_music') {
    const customLyrics = sortedBeats
      .map((b, idx) => {
        const tag =
          idx === 0
            ? '[Intro]'
            : idx === sortedBeats.length - 1
              ? '[Outro]'
              : b.energy >= 8
                ? '[Chorus]'
                : '[Bridge]';
        const line = b.lyricsLine?.trim();
        return line ? `${tag}\n${line}` : `${tag}\n[Inst]`;
      })
      .join('\n')
      .slice(0, 3400);

    const hasLyricsText = sortedBeats.some((b) => Boolean(b.lyricsLine?.trim()));

    const res = await fal.subscribe('fal-ai/minimax-music/v2.6', {
      input: {
        prompt: prompt.slice(0, 1980),
        is_instrumental: options.forceInstrumental,
        lyrics: options.forceInstrumental
          ? '[Intro]\n[Inst]\n[Bridge]\n[Solo]\n[Outro]'
          : hasLyricsText
            ? customLyrics
            : '',
        lyrics_optimizer: !options.forceInstrumental && !hasLyricsText,
      },
      logs: false,
    });
    const data = res.data as { audio?: { url?: string; content_type?: string } };
    if (!data?.audio?.url) {
      throw new Error('MiniMax Music v2.6 did not return an audio file.');
    }
    const dl = await downloadAudioUrl(data.audio.url, data.audio.content_type || 'audio/mpeg');
    return {
      ...dl,
      mimeType: data.audio.content_type || dl.mimeType,
      engineUsed: 'fal-minimax-music-v2.6',
      promptSummary: prompt,
      durationSec: totalSec,
    };
  }

  if (options.engine === 'sonilo_music') {
    if (options.videoFilePath) {
      const videoBuf = await fs.readFile(options.videoFilePath);
      const uploadedVideoUrl = await fal.storage.upload(
        new Blob([new Uint8Array(videoBuf)], {
          type: options.videoMimeType || 'video/mp4',
        })
      );
      const res = await fal.subscribe('sonilo/v1.1/video-to-music', {
        input: {
          video_url: uploadedVideoUrl,
          prompt: prompt.slice(0, 1500),
          prompt_influence: 0.65,
          duration: clampNumber(totalSec, 1, 180, 30),
          num_samples: 1,
        },
        logs: false,
      });
      const data = res.data as { audio?: { url?: string; content_type?: string } };
      if (!data?.audio?.url) {
        throw new Error('Sonilo v1.1 Video-to-Music did not return an audio file.');
      }
      const dl = await downloadAudioUrl(data.audio.url, data.audio.content_type || 'audio/mpeg');
      return {
        ...dl,
        mimeType: data.audio.content_type || dl.mimeType,
        engineUsed: 'fal-sonilo-v1.1-video-to-music',
        promptSummary: prompt,
        durationSec: totalSec,
      };
    }

    const res = await fal.subscribe('sonilo/v1.1/text-to-music', {
      input: {
        prompt: prompt.slice(0, 1500),
        duration: clampNumber(totalSec, 5, 180, 30),
        num_samples: 1,
      },
      logs: false,
    });
    const data = res.data as { audio?: { url?: string; content_type?: string } };
    if (!data?.audio?.url) {
      throw new Error('Sonilo v1.1 Text-to-Music did not return an audio file.');
    }
    const dl = await downloadAudioUrl(data.audio.url, data.audio.content_type || 'audio/mpeg');
    return {
      ...dl,
      mimeType: data.audio.content_type || dl.mimeType,
      engineUsed: 'fal-sonilo-v1.1-text-to-music',
      promptSummary: prompt,
      durationSec: totalSec,
    };
  }

  if (options.engine === 'stable_audio_25') {
    const res = await fal.subscribe('fal-ai/stable-audio-25/text-to-audio', {
      input: {
        prompt: prompt.slice(0, 1900),
        seconds_total: clampNumber(totalSec, 5, 190, 30),
        guidance_scale: 4.5,
      },
      logs: false,
    });
    const data = res.data as { audio?: { url?: string; content_type?: string } };
    if (!data?.audio?.url) {
      throw new Error('Stable Audio 2.5 did not return an audio file.');
    }
    const dl = await downloadAudioUrl(data.audio.url, data.audio.content_type || 'audio/wav');
    return {
      ...dl,
      mimeType: data.audio.content_type || dl.mimeType,
      engineUsed: 'fal-stable-audio-25',
      promptSummary: prompt,
      durationSec: totalSec,
    };
  }

  // Fal ACE-Step Score Synthesis
  const tags = [
    options.genre,
    `${Math.round(options.bpm)} bpm`,
    options.musicalKey,
    ...options.instrumentationPalette,
    ...sortedBeats.map((b) => b.emotion),
  ]
    .filter(Boolean)
    .join(', ');

  const lyricsLines = options.forceInstrumental
    ? '[inst]'
    : sortedBeats
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

  const dl = await downloadAudioUrl(aceUrl, aceData?.audio?.content_type || 'audio/wav');
  return {
    ...dl,
    mimeType: aceData?.audio?.content_type || dl.mimeType,
    engineUsed: 'fal-ace-step',
    promptSummary: prompt,
    durationSec: totalSec,
  };
}
