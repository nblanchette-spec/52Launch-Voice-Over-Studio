export type VoiceProvider = 'gemini' | 'elevenlabs';

export type GeminiTtsModel =
  | 'gemini-3.8-flash-tts'
  | 'gemini-3.8-flash-lite-tts';

export type ElevenLabsTtsModel =
  | 'eleven_v3'
  | 'eleven_multilingual_v2'
  | 'eleven_flash_v2_5'
  | 'eleven_turbo_v2_5';

export type VoTtsModel = GeminiTtsModel | ElevenLabsTtsModel;

export interface VoScriptLine {
  id: string;
  shotId: string; // Cue label, e.g. C01, C02
  speaker: string;
  direction: string;
  line: string;
  audioTags: string;
  emotionalTone?: string;
  emotionIntensity?: number;
  provider?: VoiceProvider;
  voiceName?: string;
  ttsModel?: VoTtsModel;
  speed?: number;
  pitch?: number;
  language?: string;
  pauseAfter?: number;
  audioUrl?: string | null;
  durationSec?: number;
  targetWords?: number;
}

export interface VoStudioSettings {
  provider: VoiceProvider;
  voiceName: string;
  elevenLabsVoiceId?: string;
  emotionalTone: string;
  emotionIntensity: number;
  speed: number;
  pitch: number;
  language: string;
  pauseAfter: number;
  ttsModel: VoTtsModel;
  enhanceWithDSP: boolean;
  singleVoiceMode: boolean;
  customStylePrompt?: string;
  elevenLabsStability?: number;
  elevenLabsSimilarityBoost?: number;
  elevenLabsStyle?: number;
}

export interface GenerationLogEntry {
  id: string;
  timestamp: string;
  step: string;
  shotId?: string;
  model: string;
  prompt: string;
  seed?: number | null;
  status: 'success' | 'error';
  notes?: string;
}

export interface ScriptBriefConfig {
  topicPrompt: string;
  productOrBrand: string;
  targetAudience: string;
  speakerName: string;
  targetDurationSec: number;
  lineCount: number;
  toneNote: string;
}

export interface PipelineProject {
  id: string;
  createdAt: string;
  updatedAt: string;
  client: string;
  product: {
    name: string;
    description: string;
  };
  scriptBrief?: ScriptBriefConfig;
  voScript: VoScriptLine[];
  voHasGenerated?: boolean;
  voManuallyEdited?: boolean;
  voSettings?: VoStudioSettings;
  generationLog: GenerationLogEntry[];
}

export interface ProjectSummary {
  id: string;
  client: string;
  productName: string;
  updatedAt: string;
  voReadyCount: number;
  totalVoCount: number;
}
