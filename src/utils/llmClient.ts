import { parseJsonResponse } from './safeFetch';
import type { VoicePresetMeta } from './voPresets';

export type LlmRoutingMode = 'auto' | 'fal_gemini' | 'google_direct';

export interface LlmRoutingStatus {
  mode: LlmRoutingMode;
  geminiConfigured: boolean;
  falConfigured: boolean;
  elevenLabsConfigured: boolean;
  geminiTextModel: string;
  falGeminiModel: string;
}

export async function getLlmRoutingStatus(): Promise<LlmRoutingStatus> {
  const resp = await fetch('/api/pipeline/llm-status');
  return parseJsonResponse<LlmRoutingStatus>(resp, 'Could not fetch AI routing status.');
}

export async function setLlmRoutingMode(mode: LlmRoutingMode): Promise<LlmRoutingStatus> {
  const resp = await fetch('/api/pipeline/llm-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return parseJsonResponse<LlmRoutingStatus>(resp, 'Could not switch AI engine mode.');
}

export async function fetchElevenLabsVoices(): Promise<{
  voices: VoicePresetMeta[];
  source: 'api' | 'catalog';
}> {
  const resp = await fetch('/api/pipeline/elevenlabs-voices');
  return parseJsonResponse<{
    voices: VoicePresetMeta[];
    source: 'api' | 'catalog';
  }>(resp, 'Could not fetch ElevenLabs voices.');
}
