import fs from 'fs/promises';
import zlib from 'zlib';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { fal } from '@fal-ai/client';

export type LlmRoutingMode = 'auto' | 'fal_gemini' | 'google_direct';

function getDefaultGeminiTextModel(): string {
  return process.env.GEMINI_TEXT_MODEL?.trim() || 'gemini-3.5-flash-lite';
}

function getDefaultFalGeminiModel(): string {
  return process.env.FAL_GEMINI_MODEL?.trim() || 'google/gemini-3.5-flash-lite';
}

let runtimeLlmMode: LlmRoutingMode =
  process.env.PREFER_FAL_GEMINI === 'true' ? 'fal_gemini' : 'auto';

export interface LlmInlinePart {
  text?: string;
  inlineData?: {
    data: string;
    mimeType: string;
  };
  fileData?: {
    fileUri: string;
    mimeType: string;
  };
  filename?: string;
}

export interface LlmJsonCallOptions {
  prompt: string;
  systemPrompt?: string;
  responseSchema?: unknown;
  jsonSchemaHint?: string;
  parts?: LlmInlinePart[];
  thinkingLow?: boolean;
  preferFal?: boolean;
  geminiModelOverride?: string;
}

export interface LlmJsonResult<T> {
  data: T;
  providerUsed: 'google-gemini' | 'fal-gemini';
  modelUsed: string;
}

export function getLlmMode(): LlmRoutingMode {
  return runtimeLlmMode;
}

export function setLlmMode(next: LlmRoutingMode): LlmRoutingMode {
  if (next === 'auto' || next === 'fal_gemini' || next === 'google_direct') {
    runtimeLlmMode = next;
  }
  return runtimeLlmMode;
}

export function hasValidGeminiKey(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key);
}

export function hasValidFalKey(): boolean {
  const key = process.env.FAL_KEY?.trim();
  return Boolean(key);
}

export function hasValidElevenLabsKey(): boolean {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  return Boolean(key);
}

export function getLlmStatus() {
  return {
    mode: runtimeLlmMode,
    geminiConfigured: hasValidGeminiKey(),
    falConfigured: hasValidFalKey(),
    elevenLabsConfigured: hasValidElevenLabsKey(),
    geminiTextModel: getDefaultGeminiTextModel(),
    falGeminiModel: getDefaultFalGeminiModel(),
  };
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientGeminiError(err: unknown): boolean {
  const status =
    (err as { status?: number; code?: number })?.status ??
    (err as { code?: number })?.code;
  const raw =
    err instanceof Error ? err.message.toLowerCase() : String(err || '').toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    raw.includes('429') ||
    raw.includes('503') ||
    raw.includes('resource_exhausted') ||
    raw.includes('quota') ||
    raw.includes('unavailable') ||
    raw.includes('overloaded') ||
    raw.includes('rate limit')
  );
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 2
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isTransientGeminiError(err) && attempt < maxAttempts - 1) {
        const delayMs = 900 * Math.pow(2, attempt) + Math.floor(Math.random() * 350);
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function formatLlmError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : '';
  if (!raw) return fallback;

  let message = raw;
  let code: number | undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) {
      message = String(parsed.error.message);
      code = typeof parsed.error.code === 'number' ? parsed.error.code : undefined;
    }
  } catch {
    // Non-JSON error message
  }

  const lower = message.toLowerCase();
  if (code === 403 || lower.includes('permission_denied') || lower.includes('api_key_invalid')) {
    return 'Gemini API authentication failed. Add FAL_KEY to the server environment variables (or verify GEMINI_API_KEY).';
  }
  if (code === 429 || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return 'AI rate/quota limit reached on direct Gemini and Fal fallback was unavailable. Check FAL_KEY or try again shortly.';
  }
  if (code === 404 || lower.includes('not_found')) {
    return 'The requested AI model endpoint was unavailable. Please retry in a moment.';
  }
  return message || fallback;
}

/**
 * Extracts readable literal strings (BT ... ET / Tj / TJ) from uncompressed or FlateDecode
 * PDF streams using Node built-in zlib, so Fal OpenRouter Gemini can still read PDF style
 * guides and briefs even when direct GEMINI_API_KEY inline PDF parsing is unavailable.
 */
export function extractReadableTextFromPdfBuffer(
  pdfBuffer: Buffer,
  maxChars = 18000
): string {
  const chunks: string[] = [];

  const collectTextOperators = (rawText: string) => {
    // Match parenthesized PDF string literals: (Hello World) Tj or [(H) 10 (ello)] TJ
    const literalRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = literalRegex.exec(rawText)) !== null) {
      const unescaped = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .replace(/[^\x20-\x7E\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (unescaped.length >= 2 && /[a-zA-Z0-9#]/.test(unescaped)) {
        chunks.push(unescaped);
      }
    }
  };

  // Scan binary PDF streams
  let cursor = 0;
  while (cursor < pdfBuffer.length) {
    const streamIdx = pdfBuffer.indexOf('stream', cursor, 'latin1');
    if (streamIdx === -1) break;
    let dataStart = streamIdx + 6;
    if (pdfBuffer[dataStart] === 0x0d && pdfBuffer[dataStart + 1] === 0x0a) dataStart += 2;
    else if (pdfBuffer[dataStart] === 0x0a || pdfBuffer[dataStart] === 0x0d) dataStart += 1;

    const endIdx = pdfBuffer.indexOf('endstream', dataStart, 'latin1');
    if (endIdx === -1) break;

    const streamData = pdfBuffer.subarray(dataStart, endIdx);
    const headerSlice = pdfBuffer
      .subarray(Math.max(0, streamIdx - 280), streamIdx)
      .toString('latin1');

    // Skip raster image streams
    if (!/\/Subtype\s*\/Image\b/i.test(headerSlice)) {
      if (/\/FlateDecode\b/i.test(headerSlice)) {
        try {
          const inflated = zlib.inflateSync(streamData);
          collectTextOperators(inflated.toString('latin1'));
        } catch {
          // Some streams use predictors or corrupt zlib headers; skip safely
        }
      } else {
        collectTextOperators(streamData.toString('latin1'));
      }
    }
    cursor = endIdx + 9;
    if (chunks.join(' ').length >= maxChars) break;
  }

  // Fallback ASCII scan for uncompressed PDFs or hex codes embedded in metadata
  const rawAscii = pdfBuffer.toString('latin1');
  const hexCodes = Array.from(new Set(rawAscii.match(/#[0-9a-fA-F]{6}\b/g) || [])).slice(
    0,
    24
  );

  let combined = chunks.join(' ').replace(/\s+/g, ' ').trim();
  if (combined.length > maxChars) {
    combined = `${combined.slice(0, maxChars)}\n...[PDF text truncated]...`;
  }
  if (hexCodes.length > 0 && !combined.includes(hexCodes[0])) {
    combined = `${combined}\nDetected Hex Color Codes in PDF: ${hexCodes.join(', ')}`.trim();
  }
  return combined;
}

function extractBalancedJsonSubstring(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (
    (cleaned.startsWith('{') && cleaned.endsWith('}')) ||
    (cleaned.startsWith('[') && cleaned.endsWith(']'))
  ) {
    return cleaned;
  }

  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  let start = -1;
  let openCh = '{';
  let closeCh = '}';

  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    openCh = '{';
    closeCh = '}';
  } else if (arrStart !== -1) {
    start = arrStart;
    openCh = '[';
    closeCh = ']';
  }

  if (start === -1) return cleaned;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return cleaned.slice(start);
}

function parseLlmJson<T>(rawText: string): T {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    throw new Error('AI returned an empty response.');
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const extracted = extractBalancedJsonSubstring(trimmed);
    return JSON.parse(extracted) as T;
  }
}

async function callViaGoogleGemini<T>(
  opts: LlmJsonCallOptions
): Promise<LlmJsonResult<T>> {
  const ai = getGeminiClient();

  const geminiParts: Array<{
    text?: string;
    inlineData?: { data: string; mimeType: string };
    fileData?: { fileUri: string; mimeType: string };
  }> = [];

  if (opts.parts && opts.parts.length > 0) {
    for (const p of opts.parts) {
      if (p.fileData) {
        geminiParts.push({ fileData: p.fileData });
      } else if (p.inlineData) {
        geminiParts.push({ inlineData: p.inlineData });
      } else if (p.text) {
        geminiParts.push({ text: p.text });
      }
    }
  }

  const finalPrompt = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n${opts.prompt}`
    : opts.prompt;
  geminiParts.push({ text: finalPrompt });

  const config: Record<string, unknown> = {
    responseMimeType: 'application/json',
  };
  if (opts.responseSchema) {
    config.responseSchema = opts.responseSchema;
  }
  if (opts.thinkingLow) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  }

  const contentsPayload =
    geminiParts.length === 1 && geminiParts[0].text
      ? geminiParts[0].text
      : { parts: geminiParts };

  const geminiModel = opts.geminiModelOverride || getDefaultGeminiTextModel();
  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: geminiModel,
      contents: contentsPayload,
      config,
    })
  );

  const parsed = parseLlmJson<T>(response.text ?? '');
  return {
    data: parsed,
    providerUsed: 'google-gemini',
    modelUsed: geminiModel,
  };
}

function extractTextFromFalResponse(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const obj = data as Record<string, unknown>;
  if (typeof obj.output === 'string') return obj.output;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.response === 'string') return obj.response;
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const msg = (obj.choices[0] as { message?: { content?: unknown } })?.message;
    if (typeof msg?.content === 'string') return msg.content;
  }
  return JSON.stringify(data);
}

async function callViaFalGemini<T>(
  opts: LlmJsonCallOptions
): Promise<LlmJsonResult<T>> {
  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) {
    throw new Error('Add FAL_KEY to the server environment variables.');
  }
  fal.config({ credentials: falKey });

  const extraTextSections: string[] = [];
  const imageUrls: string[] = [];

  if (opts.parts && opts.parts.length > 0) {
    for (const p of opts.parts) {
      if (p.text) {
        extraTextSections.push(p.text);
        continue;
      }
      if (p.inlineData) {
        const mime = p.inlineData.mimeType || '';
        if (mime.startsWith('image/')) {
          if (imageUrls.length < 6) {
            try {
              const buf = Buffer.from(p.inlineData.data, 'base64');
              const blob = new Blob([buf], { type: mime });
              const uploadedUrl = await fal.storage.upload(blob);
              if (uploadedUrl) {
                imageUrls.push(uploadedUrl);
              }
            } catch {
              // Skip failed individual image upload cleanly
            }
          }
        } else if (mime === 'application/pdf') {
          try {
            const buf = Buffer.from(p.inlineData.data, 'base64');
            const pdfText = extractReadableTextFromPdfBuffer(buf, 14000);
            if (pdfText) {
              extraTextSections.push(
                `--- Extracted PDF Text (${p.filename || 'Document'}) ---\n${pdfText}`
              );
            }
          } catch {
            // Skip unreadable PDF stream
          }
        }
      }
    }
  }

  const schemaInstruction = opts.jsonSchemaHint
    ? `\n\nSTRICT OUTPUT FORMAT:\nReturn ONLY valid, raw JSON (no markdown fences, no commentary) matching this exact structure:\n${opts.jsonSchemaHint}`
    : `\n\nSTRICT OUTPUT FORMAT:\nReturn ONLY valid, raw JSON (no markdown code fences, no extra prose).`;

  const assembledPrompt = [
    ...extraTextSections,
    opts.prompt,
    schemaInstruction,
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt =
    opts.systemPrompt ||
    'You are an expert commercial production AI assistant for 52Launch Studio. Always reply with strictly valid JSON only.';

  const falModel = getDefaultFalGeminiModel();
  const result =
    imageUrls.length > 0
      ? await fal.subscribe('openrouter/router/vision', {
          input: {
            model: falModel,
            prompt: assembledPrompt,
            system_prompt: systemPrompt,
            image_urls: imageUrls,
          },
          logs: false,
        })
      : await fal.subscribe('openrouter/router', {
          input: {
            model: falModel,
            prompt: assembledPrompt,
            system_prompt: systemPrompt,
          },
          logs: false,
        });
  const rawText = extractTextFromFalResponse(result?.data);
  const parsed = parseLlmJson<T>(rawText);

  return {
    data: parsed,
    providerUsed: 'fal-gemini',
    modelUsed: `fal:${falModel}`,
  };
}

/**
 * Unified JSON LLM runner supporting both Google Gemini direct AND Gemini via Fal OpenRouter.
 * Automatically fails over to Fal Gemini whenever quota/rate/token/auth errors happen or
 * GEMINI_API_KEY is absent, or uses Fal Gemini directly when mode === 'fal_gemini'.
 */
export async function generateJsonWithGeminiOrFal<T>(
  opts: LlmJsonCallOptions
): Promise<LlmJsonResult<T>> {
  const mode = opts.preferFal ? 'fal_gemini' : runtimeLlmMode;

  if (mode === 'fal_gemini') {
    return callViaFalGemini<T>(opts);
  }

  if (mode === 'google_direct') {
    return callViaGoogleGemini<T>(opts);
  }

  // Auto mode: prefer Google Gemini if configured, fail over cleanly to Fal Gemini
  if (!hasValidGeminiKey()) {
    if (hasValidFalKey()) {
      return callViaFalGemini<T>(opts);
    }
    throw new Error(
      'Add FAL_KEY to the server environment variables (or configure GEMINI_API_KEY).'
    );
  }

  try {
    return await callViaGoogleGemini<T>(opts);
  } catch (googleErr) {
    if (hasValidFalKey()) {
      console.warn(
        '[llmHelpers] Direct Gemini failed or hit quota/token limit; failing over to Gemini via Fal:',
        googleErr instanceof Error ? googleErr.message : String(googleErr)
      );
      return callViaFalGemini<T>(opts);
    }
    throw googleErr;
  }
}

export interface VideoAnalysisCallOptions<T> {
  videoFilePath?: string | null;
  videoMimeType?: string;
  keyframes?: Array<{ timeSec: number; dataUrl: string }>;
  prompt: string;
  systemPrompt?: string;
  responseSchema?: unknown;
  jsonSchemaHint?: string;
  thinkingLow?: boolean;
}

function buildKeyframeParts(
  keyframes?: Array<{ timeSec: number; dataUrl: string }>
): LlmInlinePart[] {
  if (!keyframes || keyframes.length === 0) return [];
  const parts: LlmInlinePart[] = [];
  for (const frame of keyframes.slice(0, 10)) {
    const match = frame.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) continue;
    parts.push({
      text: `Video keyframe at t=${frame.timeSec.toFixed(1)}s:`,
    });
    parts.push({
      inlineData: {
        mimeType: match[1] || 'image/jpeg',
        data: match[2],
      },
    });
  }
  return parts;
}

/**
 * Analyzes an uploaded video natively via Google Gemini (Files API or inlineData
 * with gemini-4-hydrogen), or falls back seamlessly to extracted timestamped
 * storyboard keyframes via Fal OpenRouter Vision if direct Gemini is unavailable.
 */
export async function generateJsonWithVideoOrFrames<T>(
  opts: VideoAnalysisCallOptions<T>
): Promise<LlmJsonResult<T>> {
  const mode = runtimeLlmMode;
  const videoModel = process.env.GEMINI_VIDEO_MODEL?.trim() || 'gemini-4-hydrogen';
  const frameParts = buildKeyframeParts(opts.keyframes);

  const runFramesFallback = () => {
    if (frameParts.length === 0 && !opts.videoFilePath) {
      throw new Error('Upload a playable video clip before running visual analysis.');
    }
    return callViaFalGemini<T>({
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      responseSchema: opts.responseSchema,
      jsonSchemaHint: opts.jsonSchemaHint,
      parts: frameParts,
      thinkingLow: opts.thinkingLow,
    });
  };

  if (mode === 'fal_gemini') {
    return runFramesFallback();
  }

  const runDirectVideo = async (): Promise<LlmJsonResult<T>> => {
    const ai = getGeminiClient();
    let uploadedFileName: string | null = null;

    try {
      const videoParts: LlmInlinePart[] = [];
      if (opts.videoFilePath) {
        const stat = await fs.stat(opts.videoFilePath);
        const mime = opts.videoMimeType || 'video/mp4';
        if (stat.size <= 14 * 1024 * 1024) {
          const buf = await fs.readFile(opts.videoFilePath);
          videoParts.push({
            inlineData: {
              data: buf.toString('base64'),
              mimeType: mime,
            },
          });
        } else {
          let uploaded = await ai.files.upload({
            file: opts.videoFilePath,
            config: { mimeType: mime },
          });
          uploadedFileName = uploaded.name || null;

          const deadline = Date.now() + 120_000;
          while (uploaded.state === 'PROCESSING' && Date.now() < deadline) {
            await sleep(2500);
            uploaded = await ai.files.get({ name: uploaded.name || '' });
          }
          if (uploaded.state === 'FAILED' || !uploaded.uri) {
            throw new Error('Gemini video processing failed for uploaded file.');
          }
          videoParts.push({
            fileData: {
              fileUri: uploaded.uri,
              mimeType: uploaded.mimeType || mime,
            },
          });
        }
      } else if (frameParts.length > 0) {
        videoParts.push(...frameParts);
      }

      return await callViaGoogleGemini<T>({
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        responseSchema: opts.responseSchema,
        jsonSchemaHint: opts.jsonSchemaHint,
        parts: videoParts,
        thinkingLow: opts.thinkingLow,
        geminiModelOverride: videoModel,
      });
    } finally {
      if (uploadedFileName) {
        await ai.files.delete({ name: uploadedFileName }).catch(() => undefined);
      }
    }
  };

  if (mode === 'google_direct') {
    return runDirectVideo();
  }

  if (!hasValidGeminiKey()) {
    if (hasValidFalKey()) {
      return runFramesFallback();
    }
    throw new Error(
      'Add GEMINI_API_KEY or FAL_KEY to the server environment variables for video analysis.'
    );
  }

  try {
    return await runDirectVideo();
  } catch (err) {
    if (hasValidFalKey() && frameParts.length > 0) {
      console.warn(
        '[llmHelpers] Direct Gemini video analysis failed; failing over to Fal Vision keyframes:',
        err instanceof Error ? err.message : String(err)
      );
      return runFramesFallback();
    }
    throw err;
  }
}

