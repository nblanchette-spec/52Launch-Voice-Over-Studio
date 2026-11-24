import { parseJsonResponse } from './safeFetch';
import type { ClonedVoiceProfile } from '../types/pipeline';
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

export async function fetchClonedVoices(): Promise<ClonedVoiceProfile[]> {
  const resp = await fetch('/api/pipeline/voice-clones');
  const data = await parseJsonResponse<{ clones?: ClonedVoiceProfile[] }>(
    resp,
    'Could not load cloned voices.'
  );
  return Array.isArray(data.clones) ? data.clones : [];
}

export async function createClonedVoiceApi(payload: {
  name: string;
  description?: string;
  removeBackgroundNoise?: boolean;
  preferredMethod?: 'elevenlabs' | 'chatterbox';
  samples: Array<{ filename: string; dataUrl: string }>;
}): Promise<{ clone: ClonedVoiceProfile; clones: ClonedVoiceProfile[] }> {
  const resp = await fetch('/api/pipeline/voice-clones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{
    clone: ClonedVoiceProfile;
    clones: ClonedVoiceProfile[];
    error?: string;
  }>(resp, 'Voice cloning failed.');
  if (!resp.ok) throw new Error(data.error || 'Voice cloning failed.');
  return { clone: data.clone, clones: data.clones || [] };
}

export async function deleteClonedVoiceApi(id: string): Promise<ClonedVoiceProfile[]> {
  const resp = await fetch(`/api/pipeline/voice-clones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await parseJsonResponse<{ clones?: ClonedVoiceProfile[]; error?: string }>(
    resp,
    'Could not delete cloned voice.'
  );
  if (!resp.ok) throw new Error(data.error || 'Could not delete cloned voice.');
  return data.clones || [];
}
