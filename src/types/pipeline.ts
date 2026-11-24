export type StudioStageNumber = 1 | 2 | 3 | 4;

export type VoiceProvider = 'gemini' | 'elevenlabs' | 'clone';

export type GeminiTtsModel =
  | 'gemini-3.8-flash-tts'
  | 'gemini-3.8-flash-lite-tts';

export type ElevenLabsTtsModel =
  | 'eleven_v3'
  | 'eleven_multilingual_v2'
  | 'eleven_flash_v2_5'
  | 'eleven_turbo_v2_5';

export type VoiceCloneModel = 'elevenlabs_ivc' | 'chatterbox_zero_shot';

export type VoTtsModel = GeminiTtsModel | ElevenLabsTtsModel | VoiceCloneModel;

export interface ClonedVoiceProfile {
  id: string;
  name: string;
  description?: string;
  method: 'elevenlabs' | 'chatterbox';
  elevenLabsVoiceId?: string;
  referenceAudioUrl?: string;
  removeBackgroundNoise?: boolean;
  createdAt: string;
}

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
  clonedVoiceId?: string;
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

// --- Shared Uploaded Video Metadata for Stages 2, 3, 4 ---
export interface VideoKeyframeSample {
  timeSec: number;
  dataUrl: string;
}

export interface UploadedVideoMeta {
  assetUrl: string;
  filename: string;
  mimeType: string;
  durationSec: number;
  width?: number;
  height?: number;
  keyframes?: VideoKeyframeSample[];
  uploadedAt: string;
}

// --- Stage 2: Organic On-Camera Foley SFX ---
export type FoleyCategory =
  | 'Footsteps'
  | 'Cloth & Movement'
  | 'Props & Handling'
  | 'Ambience & Room Tone'
  | 'Mechanical & Surface'
  | 'Nature & Weather';

export interface FoleyCue {
  id: string;
  cueNumber: string; // F01, F02
  startTimeSec: number;
  durationSec: number;
  category: FoleyCategory;
  surfaceOrMaterial: string;
  visualAction: string;
  foleyPrompt: string;
  promptInfluence: number;
  gain: number;
  muted?: boolean;
  audioUrl?: string | null;
  engineUsed?: string;
}

export type FoleyCueEngineId =
  | 'mirelo_sfx'
  | 'elevenlabs_sfx'
  | 'stable_audio_sfx';

export type FoleyBedEngineId =
  | 'mirelo_v2a'
  | 'hunyuan_foley'
  | 'thinksound'
  | 'mmaudio_v2';

export interface FoleyStageData {
  video: UploadedVideoMeta | null;
  cueEngine?: FoleyCueEngineId;
  bedEngine?: FoleyBedEngineId;
  focusPrompt?: string;
  analysisSummary?: string;
  cues: FoleyCue[];
  syncedBedVideoUrl?: string | null;
  syncedBedAudioUrl?: string | null;
  syncedBedPrompt?: string;
  lastAnalyzedAt?: string;
}

// --- Stage 3: Editorial / Graphical Transition SFX ---
export type EditSfxCategory =
  | 'Whoosh & Swoosh'
  | 'Impact & Hit'
  | 'Riser & Swell'
  | 'UI & Kinetic Pop'
  | 'Glitch & Stutter'
  | 'Sub Drop & Boom';

export interface EditSfxCue {
  id: string;
  cueNumber: string; // E01, E02
  startTimeSec: number;
  durationSec: number;
  category: EditSfxCategory;
  editEvent: string;
  sfxPrompt: string;
  promptInfluence: number;
  gain: number;
  muted?: boolean;
  audioUrl?: string | null;
  engineUsed?: string;
}

export type EditSfxEngineId =
  | 'elevenlabs_sfx'
  | 'sonilo_sfx'
  | 'mirelo_sfx'
  | 'stable_audio_sfx';

export interface EditSfxStageData {
  video: UploadedVideoMeta | null;
  engine?: EditSfxEngineId;
  editingStyle?: string;
  analysisSummary?: string;
  cues: EditSfxCue[];
  lastAnalyzedAt?: string;
}

// --- Stage 4: Music Orchestration & Composition ---
export type MusicEngineId =
  | 'elevenlabs_music'
  | 'minimax_music'
  | 'sonilo_music'
  | 'stable_audio_25'
  | 'ace_step';

export interface EmotionalBeat {
  id: string;
  label: string;
  startTimeSec: number;
  durationSec: number;
  emotion: string;
  energy: number; // 1 to 10
  instrumentation: string;
  tempoFeel?: string;
  negativeStyles?: string;
  lyricsLine?: string;
}

export interface MusicTrackTake {
  id: string;
  createdAt: string;
  engine: MusicEngineId;
  audioUrl: string;
  durationSec: number;
  promptSummary: string;
}

export interface MusicStageData {
  video: UploadedVideoMeta | null;
  analysisSummary?: string;
  genre: string;
  bpm: number;
  musicalKey: string;
  forceInstrumental: boolean;
  instrumentationPalette: string[];
  negativeStyles: string;
  customDirection: string;
  engine: MusicEngineId;
  beats: EmotionalBeat[];
  masterAudioUrl?: string | null;
  takes: MusicTrackTake[];
  lastAnalyzedAt?: string;
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
  foley?: FoleyStageData;
  editSfx?: EditSfxStageData;
  music?: MusicStageData;
  generationLog: GenerationLogEntry[];
}

export interface ProjectSummary {
  id: string;
  client: string;
  productName: string;
  updatedAt: string;
  voReadyCount: number;
  totalVoCount: number;
  foleyCount?: number;
  editSfxCount?: number;
  musicBeatCount?: number;
}
