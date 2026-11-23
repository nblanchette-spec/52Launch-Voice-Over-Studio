import { GoogleGenAI } from '@google/genai';

export const VALID_GEMINI_VOICES = [
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Aoede',
  'Zephyr',
  'Leda',
  'Orus',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;

export type GeminiTtsModel = 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';

const LANGUAGE_ACCENT_LABELS: Record<string, string> = {
  'en-US': 'American English',
  'en-GB': 'British English (UK accent)',
  'es-ES': 'Castilian Spanish (Spain)',
  'es-MX': 'Latin American Spanish (Mexico)',
  'fr-FR': 'French',
  'de-DE': 'German',
  'ja-JP': 'Japanese',
  'pt-BR': 'Brazilian Portuguese',
  'it-IT': 'Italian',
  'hi-IN': 'Hindi',
  'zh-CN': 'Mandarin Chinese',
  'ko-KR': 'Korean',
  'ar-SA': 'Arabic',
  'nl-NL': 'Dutch',
  'ru-RU': 'Russian',
  'pl-PL': 'Polish',
  'sv-SE': 'Swedish',
  'tr-TR': 'Turkish',
};

const TONE_STYLE_GUIDANCE: Record<string, string> = {
  'Natural & Conversational':
    'Natural, unforced, conversational speaking voice with authentic human cadence and gentle phrasing pauses',
  'Warm & Friendly':
    'Warm, smiling, inviting, and genuinely friendly voice filled with hospitality and approachable warmth',
  'Authoritative & Serious':
    'Serious, commanding, authoritative, and resolute tone with deep conviction and steady gravitas',
  'Enthusiastic & High Energy':
    'Highly enthusiastic, excited, vibrant, and energetic delivery bursting with upbeat momentum',
  'Dramatic & Cinematic Movie':
    'Dramatic, intense, cinematic narrator voice rich with suspense, emotional weight, and gravity',
  'Calm & Whispering / ASMR':
    'Soft, breathy, intimate, close-mic whisper delivered gently with soothing calm',
  'Professional News Anchor':
    'Crisp, poised, objective broadcast voice delivering lines with clarity and authority',
  'Empathetic & Compassionate':
    'Deeply empathetic, tender, heartfelt, and compassionate voice with reassuring emotional warmth',
  'Playful & Sarcastic':
    'Playful, cheeky, witty delivery with expressive sly inflection and crisp timing',
  'Educational & Explanatory':
    'Clear, patient, articulate explainer narrator guiding concepts with engaging curiosity and poise',
};

export function buildVoxStyleDirective(params: {
  direction?: string;
  emotionalTone?: string;
  emotionIntensity?: number;
  stylePrompt?: string;
  speed?: number;
  pitch?: number;
  language?: string;
  skipPitchText?: boolean;
  skipSpeedText?: boolean;
}): string {
  const {
    direction,
    emotionalTone = 'Natural & Conversational',
    emotionIntensity = 0.85,
    stylePrompt,
    speed = 1.0,
    pitch = 1.0,
    language = 'en-US',
    skipPitchText = false,
    skipSpeedText = false,
  } = params;

  const parts: string[] = [];
  const toneGuidance =
    TONE_STYLE_GUIDANCE[emotionalTone] || TONE_STYLE_GUIDANCE['Natural & Conversational'];
  const custom = stylePrompt?.trim() || direction?.trim();

  if (custom) {
    parts.push(`${custom}.`);
    parts.push(`Overall vocal tone: ${toneGuidance}.`);
  } else {
    parts.push(`${toneGuidance}.`);
  }

  const intensity = Math.max(0.1, Math.min(1.0, Number(emotionIntensity) || 0.85));
  if (intensity <= 0.35) {
    parts.push('Keep emotional inflection subtle, understated, and restrained.');
  } else if (intensity <= 0.65) {
    parts.push('Deliver with balanced, natural emotional expression.');
  } else if (intensity <= 0.85) {
    parts.push('Deliver with vivid, expressive emotion and dynamic vocal variation.');
  } else {
    parts.push('Perform with deeply passionate, heightened emotional intensity and dynamic range.');
  }

  if (!skipSpeedText) {
    if (speed <= 0.78) {
      parts.push('Speak at a noticeably slow, deliberate, unhurried pace with dramatic pauses.');
    } else if (speed < 0.94) {
      parts.push('Speak at a measured, slightly slower, thoughtful pace.');
    } else if (speed >= 1.25) {
      parts.push('Speak at a fast, brisk, energetic pace.');
    } else if (speed > 1.06) {
      parts.push('Speak at a lively, slightly brisker upbeat pace.');
    }
  }

  if (!skipPitchText) {
    if (pitch <= 0.85) {
      parts.push('Use a noticeably deeper, lower chest-voice vocal resonance.');
    } else if (pitch < 0.95) {
      parts.push('Use a slightly deeper, warmer lower vocal register.');
    } else if (pitch >= 1.15) {
      parts.push('Use a noticeably brighter, higher vocal pitch register.');
    } else if (pitch > 1.05) {
      parts.push('Use a slightly brighter, elevated vocal register.');
    }
  }

  if (language && language !== 'en-US') {
    const langLabel = LANGUAGE_ACCENT_LABELS[language] || language;
    parts.push(`Speak naturally in ${langLabel}.`);
  }

  return parts.join(' ');
}

function ensureWavBuffer(rawBuffer: Buffer): Buffer {
  const hasRiffHeader =
    rawBuffer.length >= 12 &&
    rawBuffer.toString('ascii', 0, 4) === 'RIFF' &&
    rawBuffer.toString('ascii', 8, 12) === 'WAVE';
  if (hasRiffHeader) {
    return rawBuffer;
  }

  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = rawBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, rawBuffer]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaOrTransientError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err || '').toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('rate limit')
  );
}

function isInvalidFieldError(err: unknown, fieldName: string): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return msg.includes('Unknown name') && msg.includes(fieldName);
}

function getTtsClient(fallbackClient: GoogleGenAI): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackClient;
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callTtsGenerateWithPayloadModes(
  ttsClient: GoogleGenAI,
  activeModel: GeminiTtsModel,
  spokenText: string,
  styleDirective: string,
  chosenVoice: string
) {
  const speechConfig = {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: chosenVoice },
    },
  };

  // Mode 1: v1beta standard speechMetadata + speechConfig
  try {
    return await ttsClient.models.generateContent({
      model: activeModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: spokenText,
              speechMetadata: {
                style: styleDirective,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig,
      },
    });
  } catch (err: unknown) {
    if (!isInvalidFieldError(err, 'speechMetadata') && !isInvalidFieldError(err, 'speechConfig')) {
      throw err;
    }

    // Mode 2: If backend rejected speechMetadata on Part, use systemInstruction + speechConfig
    if (isInvalidFieldError(err, 'speechMetadata') && !isInvalidFieldError(err, 'speechConfig')) {
      try {
        return await ttsClient.models.generateContent({
          model: activeModel,
          contents: [
            {
              role: 'user',
              parts: [{ text: spokenText }],
            },
          ],
          config: {
            systemInstruction: `Read ONLY the user's spoken words aloud naturally without reading instructions. Perform in this vocal style: ${styleDirective}`,
            responseModalities: ['AUDIO'],
            speechConfig,
          },
        });
      } catch (err2: unknown) {
        if (isQuotaOrTransientError(err2)) throw err2;
        // Mode 3: Plain text part + speechConfig only
        return await ttsClient.models.generateContent({
          model: activeModel,
          contents: [
            {
              role: 'user',
              parts: [{ text: spokenText }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig,
          },
        });
      }
    }

    // Mode 4: Plain text + responseModalities only (last resort if speechConfig rejected on API tier)
    return await ttsClient.models.generateContent({
      model: activeModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Using voice persona ${chosenVoice} (${styleDirective}), speak the following line aloud:\n\n${spokenText}`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
      },
    });
  }
}

export async function synthesizeWithGeminiTTS(
  aiClient: GoogleGenAI,
  options: {
    text: string;
    voice?: string;
    model?: GeminiTtsModel;
    direction?: string;
    emotionalTone?: string;
    emotionIntensity?: number;
    stylePrompt?: string;
    speed?: number;
    pitch?: number;
    language?: string;
    skipPitchText?: boolean;
    skipSpeedText?: boolean;
  }
): Promise<{
  wavBuffer: Buffer;
  audioBase64: string;
  mimeType: string;
  voice: string;
  model: GeminiTtsModel;
  styleDirective: string;
}> {
  const chosenVoice = (VALID_GEMINI_VOICES as readonly string[]).includes(
    options.voice || ''
  )
    ? (options.voice as string)
    : 'Kore';

  const preferredModel: GeminiTtsModel =
    options.model === 'gemini-3.8-flash-tts'
      ? 'gemini-3.8-flash-tts'
      : 'gemini-3.8-flash-lite-tts';

  const modelsToTry: GeminiTtsModel[] =
    preferredModel === 'gemini-3.8-flash-tts'
      ? ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']
      : ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];

  const styleDirective = buildVoxStyleDirective(options);
  const spokenText = options.text.trim();
  const ttsClient = getTtsClient(aiClient);
  let lastErr: unknown;

  for (const activeModel of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await callTtsGenerateWithPayloadModes(
          ttsClient,
          activeModel,
          spokenText,
          styleDirective,
          chosenVoice
        );

        const candidate = response.candidates?.[0];
        const audioPart = candidate?.content?.parts?.find((p) =>
          Boolean(p.inlineData?.data)
        );
        if (!audioPart?.inlineData?.data) {
          const textReply = candidate?.content?.parts?.find((p) => p.text)?.text;
          throw new Error(
            textReply
              ? `Gemini voice model returned text instead of audio: ${textReply}`
              : 'Gemini voice model returned an empty audio response.'
          );
        }

        const rawBuf = Buffer.from(audioPart.inlineData.data, 'base64');
        const wavBuffer = ensureWavBuffer(rawBuf);

        return {
          wavBuffer,
          audioBase64: wavBuffer.toString('base64'),
          mimeType: 'audio/wav',
          voice: chosenVoice,
          model: activeModel,
          styleDirective,
        };
      } catch (err: unknown) {
        lastErr = err;
        if (isQuotaOrTransientError(err)) {
          if (attempt < 2) {
            const backoffMs = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
            await sleep(backoffMs);
            continue;
          }
          // Exhausted retries on this model; try fallback TTS model if available
          break;
        }
        throw err;
      }
    }
  }

  throw lastErr || new Error('Gemini voice synthesis failed.');
}
