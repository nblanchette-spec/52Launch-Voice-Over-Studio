import type {
  EditSfxCategory,
  EditSfxEngineId,
  EditSfxStageData,
  ElevenLabsTtsModel,
  FoleyBedEngineId,
  FoleyCategory,
  FoleyCueEngineId,
  FoleyStageData,
  GeminiTtsModel,
  MusicEngineId,
  MusicStageData,
  VoiceCloneModel,
  VoStudioSettings,
} from '../types/pipeline.ts';

export type GeminiVoiceId =
  | 'Puck'
  | 'Charon'
  | 'Kore'
  | 'Fenrir'
  | 'Aoede'
  | 'Zephyr'
  | 'Leda'
  | 'Orus'
  | string;

export type EmotionalToneId =
  | 'Natural & Conversational'
  | 'Warm & Friendly'
  | 'Authoritative & Serious'
  | 'Enthusiastic & High Energy'
  | 'Dramatic & Cinematic Movie'
  | 'Calm & Whispering / ASMR'
  | 'Professional News Anchor'
  | 'Empathetic & Compassionate'
  | 'Playful & Sarcastic'
  | 'Educational & Explanatory';

export interface VoicePresetMeta {
  id: string;
  displayName: string;
  gender: 'Female' | 'Male' | 'Neutral';
  timbre: string;
  description: string;
  bestFor: string;
  defaultPitch: number;
  sampleSentence: string;
  tags: string[];
  /** Optional ElevenLabs voice name for Fal.ai routing */
  falVoiceName?: string;
}

export interface TtsModelOption<T extends string = string> {
  id: T;
  label: string;
  badge: string;
  description: string;
}

export interface EmotionalToneMeta {
  id: EmotionalToneId;
  label: string;
  description: string;
  geminiPrompt: string;
  elevenLabsTag: string;
  dspProfile: {
    bassBoostDb: number;
    trebleBoostDb: number;
    midPresenceDb: number;
    compressionRatio: number;
    reverbWet: number;
  };
}

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const DEFAULT_VO_SETTINGS: VoStudioSettings = {
  provider: 'gemini',
  voiceName: 'Kore',
  elevenLabsVoiceId: '',
  emotionalTone: 'Warm & Friendly',
  emotionIntensity: 0.85,
  speed: 1.0,
  pitch: 1.0,
  language: 'en-US',
  pauseAfter: 0.35,
  ttsModel: 'gemini-3.8-flash-lite-tts',
  enhanceWithDSP: true,
  singleVoiceMode: true,
  elevenLabsStability: 0.5,
  elevenLabsSimilarityBoost: 0.75,
  elevenLabsStyle: 0.2,
};

export const GEMINI_TTS_MODELS: Array<TtsModelOption<GeminiTtsModel>> = [
  {
    id: 'gemini-3.8-flash-tts',
    label: 'Flash 3.8 Studio',
    badge: 'Expressive',
    description: 'Voice design, nuanced acting & vocal tags',
  },
  {
    id: 'gemini-3.8-flash-lite-tts',
    label: 'Flash 3.8 Lite',
    badge: 'Fast',
    description: 'High-throughput commercial & narration TTS',
  },
];

export const ELEVENLABS_TTS_MODELS: Array<TtsModelOption<ElevenLabsTtsModel>> = [
  {
    id: 'eleven_v3',
    label: 'Eleven v3',
    badge: 'Expressive',
    description: 'Most expressive model, supports [whispers] & [laughs]',
  },
  {
    id: 'eleven_multilingual_v2',
    label: 'Multilingual v2',
    badge: 'Rich Studio',
    description: 'Consistent, lifelike narration across 29 languages',
  },
  {
    id: 'eleven_flash_v2_5',
    label: 'Flash v2.5',
    badge: 'Ultra-Fast',
    description: 'Low-latency 32-language generation',
  },
  {
    id: 'eleven_turbo_v2_5',
    label: 'Turbo v2.5',
    badge: 'Balanced',
    description: 'Balanced speed and clarity for commercial spots',
  },
];

export const CORE_GEMINI_VOICES: VoicePresetMeta[] = [
  {
    id: 'Kore',
    displayName: 'Kore',
    gender: 'Female',
    timbre: 'Warm, Expressive & Studio-Clear',
    description: 'Flagship emotive female commercial voice with crystal-clear articulation.',
    bestFor: 'Product Launches, Brand Stories, Explainers',
    defaultPitch: 1.0,
    sampleSentence: 'Designed to keep pace with every mile, without getting in the way.',
    tags: ['Warm', 'Commercial', 'Top Pick'],
  },
  {
    id: 'Charon',
    displayName: 'Charon',
    gender: 'Male',
    timbre: 'Deep, Resonant & Cinematic',
    description: 'Commanding baritone with rich low frequencies for hero spots and trailers.',
    bestFor: 'Hero Spots, Athletic Brands, Documentaries',
    defaultPitch: 0.94,
    sampleSentence: 'Every breakthrough begins twenty minutes before anyone else notices.',
    tags: ['Deep', 'Cinematic', 'Authoritative'],
  },
  {
    id: 'Puck',
    displayName: 'Puck',
    gender: 'Male',
    timbre: 'Energetic, Bright & Playful',
    description: 'Lively pace with dynamic inflection, ideal for social ads and upbeat launches.',
    bestFor: 'Paid Social, Tech Demos, Upbeat Promos',
    defaultPitch: 1.04,
    sampleSentence: 'One quick snap, zero guesswork, and you are ready to roll.',
    tags: ['Energetic', 'Social Ads', 'Upbeat'],
  },
  {
    id: 'Fenrir',
    displayName: 'Fenrir',
    gender: 'Male',
    timbre: 'Rugged, Confident & Intense',
    description: 'Grounded, authentic delivery for endurance, hardware, and founder spots.',
    bestFor: 'Sports, Outdoor Hardware, Action',
    defaultPitch: 0.96,
    sampleSentence: 'When conditions get tough, precision makes the difference.',
    tags: ['Rugged', 'Grounded', 'Sports'],
  },
  {
    id: 'Aoede',
    displayName: 'Aoede',
    gender: 'Female',
    timbre: 'Melodic, Poetic & Theatrical',
    description: 'Expressive storytelling voice with emotional depth and lyrical pacing.',
    bestFor: 'Lifestyle Films, Luxury Brands, Founder Stories',
    defaultPitch: 1.0,
    sampleSentence: 'Crafted from quiet mornings and refined over years of field testing.',
    tags: ['Storytelling', 'Lifestyle', 'Melodic'],
  },
  {
    id: 'Zephyr',
    displayName: 'Zephyr',
    gender: 'Neutral',
    timbre: 'Gentle, Airy & Soothing',
    description: 'Relaxed, calm tone suited for wellness, sleep, and restorative products.',
    bestFor: 'Wellness, Calm Lifestyle, ASMR',
    defaultPitch: 1.0,
    sampleSentence: 'Breathe easier knowing everything is handled quietly in the background.',
    tags: ['Calm', 'Wellness', 'Gentle'],
  },
  {
    id: 'Leda',
    displayName: 'Leda',
    gender: 'Female',
    timbre: 'Vibrant, Cheerful & Engaging',
    description: 'Sparkling commercial energy with bright clarity and friendly warmth.',
    bestFor: 'Social Cutdowns, Consumer Tech, DTC Brands',
    defaultPitch: 1.02,
    sampleSentence: 'Built for busy mornings and engineered to perform right out of the box.',
    tags: ['Vibrant', 'DTC', 'Clear'],
  },
  {
    id: 'Orus',
    displayName: 'Orus',
    gender: 'Male',
    timbre: 'Thoughtful, Measured & Wise',
    description: 'Clear, trustworthy cadence for product demos and science-backed inventions.',
    bestFor: 'Biotech, Explainers, Crowdfunding Campaigns',
    defaultPitch: 0.98,
    sampleSentence: 'Inside a 1.2 millimeter housing lies continuous real-time sensing.',
    tags: ['Explainer', 'Trustworthy', 'Measured'],
  },
];

export const ALL_GEMINI_VOICE_PRESETS: VoicePresetMeta[] = [
  ...CORE_GEMINI_VOICES,
  { id: 'Callirrhoe', displayName: 'Callirrhoe', gender: 'Female', timbre: 'Easy-going & Natural', description: 'Relaxed, effortless everyday female voice.', bestFor: 'Conversational Ads, Testimonials', defaultPitch: 1.0, sampleSentence: 'It feels like something you have trusted for years.', tags: ['Natural'] },
  { id: 'Autonoe', displayName: 'Autonoe', gender: 'Female', timbre: 'Bright, Poised & Articulate', description: 'Crisp, intelligent professional female tone.', bestFor: 'Pitch Videos, B2B Explainers', defaultPitch: 1.02, sampleSentence: 'Every detail was designed around real daily workflows.', tags: ['Professional'] },
  { id: 'Enceladus', displayName: 'Enceladus', gender: 'Male', timbre: 'Soft-Spoken & Intimate', description: 'Close-mic gentle male tone.', bestFor: 'Calm Storytelling, Wellness', defaultPitch: 0.98, sampleSentence: 'Notice the quiet craft in every millimeter.', tags: ['Intimate'] },
  { id: 'Iapetus', displayName: 'Iapetus', gender: 'Male', timbre: 'Clear, Crisp & Neutral', description: 'Balanced, articulate announcer voice.', bestFor: 'Tutorials, Walkthroughs', defaultPitch: 1.0, sampleSentence: 'Simple setup in under thirty seconds.', tags: ['Clear'] },
  { id: 'Umbriel', displayName: 'Umbriel', gender: 'Male', timbre: 'Warm & Casual', description: 'Friendly, unhurried casual male voice.', bestFor: 'Lifestyle, DTC Spots', defaultPitch: 0.96, sampleSentence: 'Once you try it, going back makes no sense.', tags: ['Casual'] },
  { id: 'Algieba', displayName: 'Algieba', gender: 'Male', timbre: 'Smooth, Velvety & Rich', description: 'Polished, warm resonant male voice.', bestFor: 'Luxury Commercials, Brand Films', defaultPitch: 0.94, sampleSentence: 'Crafted with timeless balance, built to endure.', tags: ['Velvety'] },
  { id: 'Despina', displayName: 'Despina', gender: 'Female', timbre: 'Smooth, Fluid & Polished', description: 'Warm, velvety female commercial voice.', bestFor: 'Brand Storytelling', defaultPitch: 1.0, sampleSentence: 'Smooth phrasing turns complex technology into effortless utility.', tags: ['Smooth'] },
  { id: 'Erinome', displayName: 'Erinome', gender: 'Female', timbre: 'Crisp & Direct', description: 'Direct, bright articulate female tone.', bestFor: 'Product Demos, Direct Response', defaultPitch: 1.02, sampleSentence: 'Three upgrades that change how you work.', tags: ['Direct'] },
  { id: 'Algenib', displayName: 'Algenib', gender: 'Male', timbre: 'Gravelly & Textured', description: 'Weathered, character-rich male voice.', bestFor: 'Grit, Heritage, Outdoor', defaultPitch: 0.92, sampleSentence: 'Built for miles of real road, not a showroom shelf.', tags: ['Gravelly'] },
  { id: 'Rasalgethi', displayName: 'Rasalgethi', gender: 'Male', timbre: 'Informative & Grounded', description: 'Grounded conversational male voice.', bestFor: 'Tech Walkthroughs, Crowdfunding', defaultPitch: 0.99, sampleSentence: 'Here is how the sensor measures every shift.', tags: ['Informative'] },
  { id: 'Laomedeia', displayName: 'Laomedeia', gender: 'Female', timbre: 'Upbeat & Lively', description: 'High-energy sparkling commercial voice.', bestFor: 'Social Hooks, Launches', defaultPitch: 1.04, sampleSentence: 'Ready to upgrade your daily routine?', tags: ['Upbeat'] },
  { id: 'Achernar', displayName: 'Achernar', gender: 'Female', timbre: 'Soft & Delicate', description: 'Quiet, tender female voice.', bestFor: 'Wellness, Calm Fiction', defaultPitch: 1.02, sampleSentence: 'Let the morning start without the rush.', tags: ['Gentle'] },
  { id: 'Alnilam', displayName: 'Alnilam', gender: 'Male', timbre: 'Firm & Grounded', description: 'Steady, deep, confident male voice.', bestFor: 'Authority, Hardware', defaultPitch: 0.92, sampleSentence: 'Steady performance under real pressure.', tags: ['Firm'] },
  { id: 'Schedar', displayName: 'Schedar', gender: 'Male', timbre: 'Even & Steady', description: 'Even-metered analytical male tone.', bestFor: 'Specs, Walkthroughs', defaultPitch: 0.98, sampleSentence: 'Calibrated to perform consistently every session.', tags: ['Steady'] },
  { id: 'Gacrux', displayName: 'Gacrux', gender: 'Female', timbre: 'Mature, Rich Alto', description: 'Deeper, authoritative female alto.', bestFor: 'Founder Films, Leadership', defaultPitch: 0.94, sampleSentence: 'Real innovation starts with solving an overlooked problem.', tags: ['Alto'] },
  { id: 'Pulcherrima', displayName: 'Pulcherrima', gender: 'Female', timbre: 'Expressive & Dynamic', description: 'Forward-projecting theatrical female voice.', bestFor: 'Hero Reveals', defaultPitch: 1.02, sampleSentence: 'Wait until you see what happens in motion.', tags: ['Expressive'] },
  { id: 'Achird', displayName: 'Achird', gender: 'Male', timbre: 'Friendly & Approachable', description: 'Warm conversational male voice.', bestFor: 'How-To, Friendly DTC', defaultPitch: 1.01, sampleSentence: 'Let me show you how fast this works.', tags: ['Friendly'] },
  { id: 'Zubenelgenubi', displayName: 'Zubenelgenubi', gender: 'Male', timbre: 'Relaxed & Laid-Back', description: 'Unhurried conversational male tone.', bestFor: 'Founder Voice, Casual Ads', defaultPitch: 0.97, sampleSentence: 'Once you put it side by side, the difference is obvious.', tags: ['Laid-Back'] },
  { id: 'Vindemiatrix', displayName: 'Vindemiatrix', gender: 'Female', timbre: 'Warm & Comforting', description: 'Soft, comforting female voice.', bestFor: 'Care, Health, Lifestyle', defaultPitch: 0.99, sampleSentence: 'Every thoughtful detail is designed around comfort.', tags: ['Soothing'] },
  { id: 'Sadachbia', displayName: 'Sadachbia', gender: 'Male', timbre: 'Lively & Animated', description: 'Quick-witted animated male tone.', bestFor: 'Hooks, Promos', defaultPitch: 1.03, sampleSentence: 'Yes, it really works right on the first try.', tags: ['Lively'] },
  { id: 'Sadaltager', displayName: 'Sadaltager', gender: 'Male', timbre: 'Knowledgeable & Mature', description: 'Trustworthy mentor voice.', bestFor: 'Engineering, Heritage', defaultPitch: 0.95, sampleSentence: 'Years of research distilled into one simple tool.', tags: ['Mature'] },
  { id: 'Sulafat', displayName: 'Sulafat', gender: 'Female', timbre: 'Warm & Resonant', description: 'Welcoming, emotionally full female voice.', bestFor: 'Brand Films, Home & Design', defaultPitch: 0.98, sampleSentence: 'Made for the moments that actually matter.', tags: ['Resonant'] },
];

export const CORE_ELEVENLABS_VOICES: VoicePresetMeta[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    falVoiceName: 'Rachel',
    displayName: 'Rachel',
    gender: 'Female',
    timbre: 'Calm, Clear & Narrative',
    description: 'Studio-standard American female voice with warm, effortless narration.',
    bestFor: 'Explainers, Brand Stories, Commercials',
    defaultPitch: 1.0,
    sampleSentence: 'Designed to keep pace with every mile, without getting in the way.',
    tags: ['Narration', 'Warm', 'Classic'],
  },
  {
    id: '9BWtsMINqrJLrRacOk9x',
    falVoiceName: 'Aria',
    displayName: 'Aria',
    gender: 'Female',
    timbre: 'Expressive, Dynamic & Modern',
    description: 'Expressive commercial voice with natural inflection and social-ad punch.',
    bestFor: 'Paid Social, DTC Launches, Hero Spots',
    defaultPitch: 1.0,
    sampleSentence: 'One quick snap, zero guesswork, and you are ready to roll.',
    tags: ['Expressive', 'Commercial', 'Top Pick'],
  },
  {
    id: 'CwhRBWXzGAHq8TQ4Fs17',
    falVoiceName: 'Roger',
    displayName: 'Roger',
    gender: 'Male',
    timbre: 'Confident, Classy & Resonant',
    description: 'Refined, steady male voice with broadcast polish and trustworthy poise.',
    bestFor: 'Executive Spots, Luxury, Broadcast',
    defaultPitch: 0.96,
    sampleSentence: 'Every breakthrough begins twenty minutes before anyone else notices.',
    tags: ['Confident', 'Broadcast', 'Resonant'],
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    falVoiceName: 'Sarah',
    displayName: 'Sarah',
    gender: 'Female',
    timbre: 'Soft, Approachable & Sincere',
    description: 'Gentle, conversational voice suited for lifestyle, wellness, and testimonials.',
    bestFor: 'Wellness, Lifestyle, Care',
    defaultPitch: 1.0,
    sampleSentence: 'Breathe easier knowing everything is handled quietly in the background.',
    tags: ['Soft', 'Conversational', 'Friendly'],
  },
  {
    id: 'IKne3meq5aSn9XLyUdCD',
    falVoiceName: 'Charlie',
    displayName: 'Charlie',
    gender: 'Male',
    timbre: 'Natural, Casual & Australian',
    description: 'Relaxed, conversational male delivery that feels genuine and unscripted.',
    bestFor: 'Founder Stories, Casual DTC, Social',
    defaultPitch: 1.0,
    sampleSentence: 'Once you put it side by side, the difference is obvious.',
    tags: ['Casual', 'Authentic', 'Conversational'],
  },
  {
    id: 'JBFqnCBsd6RMkjVDRZzb',
    falVoiceName: 'George',
    displayName: 'George',
    gender: 'Male',
    timbre: 'Warm British Raspy Storytelling',
    description: 'Distinguished British narrator with warm character and authority.',
    bestFor: 'Documentaries, Heritage, Trailers',
    defaultPitch: 0.95,
    sampleSentence: 'Crafted from quiet mornings and refined over years of field testing.',
    tags: ['British', 'Storyteller', 'Warm'],
  },
  {
    id: 'cgSgspJ2msm6clMCkdW9',
    falVoiceName: 'Jessica',
    displayName: 'Jessica',
    gender: 'Female',
    timbre: 'Bright, Upbeat & Trendy',
    description: 'Lively American female voice with crisp energy for fast-paced scripts.',
    bestFor: 'Social Hooks, Tech Demos, Promos',
    defaultPitch: 1.02,
    sampleSentence: 'Built for busy mornings and engineered to perform right out of the box.',
    tags: ['Upbeat', 'Social', 'Crisp'],
  },
  {
    id: 'TX3LPaxmHKxFdv7VOQHJ',
    falVoiceName: 'Liam',
    displayName: 'Liam',
    gender: 'Male',
    timbre: 'Articulate, Grounded & Young',
    description: 'Clean, modern American male voice built for tech explainers and launches.',
    bestFor: 'Product Demos, Crowdfunding, B2B',
    defaultPitch: 1.0,
    sampleSentence: 'Inside a 1.2 millimeter housing lies continuous real-time sensing.',
    tags: ['Modern', 'Articulate', 'Tech'],
  },
];

export const ALL_ELEVENLABS_VOICES: VoicePresetMeta[] = [
  ...CORE_ELEVENLABS_VOICES,
  {
    id: 'pFZP5JQG7iQjIQuC4Bku',
    falVoiceName: 'Lily',
    displayName: 'Lily',
    gender: 'Female',
    timbre: 'Velvety, Warm British',
    description: 'Poised British female narrator with gentle, cinematic warmth.',
    bestFor: 'Luxury, Lifestyle, Brand Films',
    defaultPitch: 1.0,
    sampleSentence: 'Made for the moments that actually matter.',
    tags: ['British', 'Velvety'],
  },
  {
    id: 'nPczCjzI2devNBz1zQrb',
    falVoiceName: 'Brian',
    displayName: 'Brian',
    gender: 'Male',
    timbre: 'Deep, Comforting & Steady',
    description: 'Rich American baritone with classic documentary and trailer presence.',
    bestFor: 'Documentaries, Trailers, Authority',
    defaultPitch: 0.94,
    sampleSentence: 'Steady performance under real pressure.',
    tags: ['Deep', 'Baritone'],
  },
  {
    id: 'onwK4e9ZLuTAKqWW03F9',
    falVoiceName: 'Daniel',
    displayName: 'Daniel',
    gender: 'Male',
    timbre: 'Authoritative British News',
    description: 'Crisp British broadcast voice with authoritative precision.',
    bestFor: 'Explainers, Broadcast, Corporate',
    defaultPitch: 0.98,
    sampleSentence: 'Calibrated to perform consistently every session.',
    tags: ['British', 'Broadcast'],
  },
  {
    id: 'FGY2WhTYpPnrIDTdsKH5',
    falVoiceName: 'Laura',
    displayName: 'Laura',
    gender: 'Female',
    timbre: 'Upbeat, Expressive & Sassy',
    description: 'High-energy expressive delivery for punchy ads and hooks.',
    bestFor: 'Paid Social, Promos',
    defaultPitch: 1.02,
    sampleSentence: 'Ready to upgrade your daily routine?',
    tags: ['Upbeat', 'Expressive'],
  },
  {
    id: 'XrExE9yKIg1WjnnlVkGX',
    falVoiceName: 'Matilda',
    displayName: 'Matilda',
    gender: 'Female',
    timbre: 'Warm, Friendly & Storytelling',
    description: 'Engaging, warm narrator suited for product stories and audiobooks.',
    bestFor: 'Brand Stories, How-To',
    defaultPitch: 1.0,
    sampleSentence: 'Notice the quiet craft in every millimeter.',
    tags: ['Warm', 'Friendly'],
  },
  {
    id: 'SAz9YHcvj6GT2YYXdXww',
    falVoiceName: 'River',
    displayName: 'River',
    gender: 'Neutral',
    timbre: 'Calm, Balanced & Confident',
    description: 'Gender-neutral modern voice with calm, grounded poise.',
    bestFor: 'Tech, Design, Wellness',
    defaultPitch: 1.0,
    sampleSentence: 'Every detail was designed around real daily workflows.',
    tags: ['Neutral', 'Balanced'],
  },
  {
    id: 'bIHbv24MWmeRgasZH58o',
    falVoiceName: 'Will',
    displayName: 'Will',
    gender: 'Male',
    timbre: 'Friendly, Laid-Back & Warm',
    description: 'Easygoing young American male voice with approachable warmth.',
    bestFor: 'Lifestyle, DTC, Testimonials',
    defaultPitch: 1.0,
    sampleSentence: 'Let me show you how fast this works.',
    tags: ['Friendly', 'Casual'],
  },
  {
    id: 'iP95p4xoKVk53GoZ742B',
    falVoiceName: 'Chris',
    displayName: 'Chris',
    gender: 'Male',
    timbre: 'Casual, Conversational & Direct',
    description: 'Everyday conversational American male voice for natural reads.',
    bestFor: 'Conversational Ads, Walkthroughs',
    defaultPitch: 1.0,
    sampleSentence: 'Here is how the sensor measures every shift.',
    tags: ['Conversational', 'Direct'],
  },
];

export const EMOTIONAL_TONES: EmotionalToneMeta[] = [
  {
    id: 'Natural & Conversational',
    label: 'Conversational',
    description: 'Realistic everyday delivery with natural pauses and cadence.',
    geminiPrompt: 'Natural, articulate, and conversational speaking voice with effortless human pacing.',
    elevenLabsTag: '',
    dspProfile: { bassBoostDb: 1, trebleBoostDb: 1, midPresenceDb: 0, compressionRatio: 2, reverbWet: 0.05 },
  },
  {
    id: 'Warm & Friendly',
    label: 'Warm & Friendly',
    description: 'Inviting, smiling warmth with genuine hospitality.',
    geminiPrompt: 'Warm, smiling, friendly voice, welcoming and sincere.',
    elevenLabsTag: '[warmly]',
    dspProfile: { bassBoostDb: 2.5, trebleBoostDb: 1.5, midPresenceDb: 1, compressionRatio: 2.5, reverbWet: 0.08 },
  },
  {
    id: 'Authoritative & Serious',
    label: 'Authoritative',
    description: 'Deep, firm, commanding broadcast timbre with steady authority.',
    geminiPrompt: 'Serious, authoritative, commanding, and firm tone with deep conviction.',
    elevenLabsTag: '[seriously]',
    dspProfile: { bassBoostDb: 3.5, trebleBoostDb: 1, midPresenceDb: 2, compressionRatio: 3.5, reverbWet: 0.04 },
  },
  {
    id: 'Enthusiastic & High Energy',
    label: 'High Energy',
    description: 'Punchy, excited promotional voiceover that hooks attention.',
    geminiPrompt: 'High energy, enthusiastically excited and vibrant with crisp momentum.',
    elevenLabsTag: '[excited]',
    dspProfile: { bassBoostDb: 1, trebleBoostDb: 3, midPresenceDb: 2, compressionRatio: 3.2, reverbWet: 0.06 },
  },
  {
    id: 'Dramatic & Cinematic Movie',
    label: 'Cinematic',
    description: 'Theatrical gravity with spacious dramatic suspense.',
    geminiPrompt: 'Dramatic, cinematic commercial narrator voice, rich with quiet intensity and gravity.',
    elevenLabsTag: '[dramatically]',
    dspProfile: { bassBoostDb: 4, trebleBoostDb: 1.8, midPresenceDb: -0.5, compressionRatio: 4, reverbWet: 0.14 },
  },
  {
    id: 'Calm & Whispering / ASMR',
    label: 'Quiet / Intimate',
    description: 'Intimate, close-mic voice with soft breath and gentle resonance.',
    geminiPrompt: 'Soft, intimate, close-microphone delivery with gentle breath and quiet calm.',
    elevenLabsTag: '[whispers]',
    dspProfile: { bassBoostDb: -1, trebleBoostDb: 3.5, midPresenceDb: -1.5, compressionRatio: 4, reverbWet: 0.1 },
  },
  {
    id: 'Professional News Anchor',
    label: 'Broadcast Clear',
    description: 'Even-metered, poised broadcast clarity.',
    geminiPrompt: 'Crisp, poised, objective television broadcast delivery with spotless diction.',
    elevenLabsTag: '',
    dspProfile: { bassBoostDb: 2, trebleBoostDb: 2, midPresenceDb: 1.5, compressionRatio: 3, reverbWet: 0.03 },
  },
  {
    id: 'Empathetic & Compassionate',
    label: 'Empathetic',
    description: 'Caring, heartfelt, understanding, and gently reassuring.',
    geminiPrompt: 'Empathetic, compassionate, heartfelt and gently reassuring voice.',
    elevenLabsTag: '[softly]',
    dspProfile: { bassBoostDb: 2, trebleBoostDb: 0.5, midPresenceDb: 1, compressionRatio: 2, reverbWet: 0.07 },
  },
  {
    id: 'Playful & Sarcastic',
    label: 'Witty / Playful',
    description: 'Wry smile, cheeky inflection, and smart timing.',
    geminiPrompt: 'Playful, witty, slightly tongue-in-cheek delivery with crisp comedic timing.',
    elevenLabsTag: '[playfully]',
    dspProfile: { bassBoostDb: 0, trebleBoostDb: 2.2, midPresenceDb: 1, compressionRatio: 2.5, reverbWet: 0.05 },
  },
  {
    id: 'Educational & Explanatory',
    label: 'Explainer',
    description: 'Patient, articulate flow that makes features effortless to grasp.',
    geminiPrompt: 'Clear, patient, articulate explainer narration guiding the viewer cleanly.',
    elevenLabsTag: '',
    dspProfile: { bassBoostDb: 1.5, trebleBoostDb: 2, midPresenceDb: 1, compressionRatio: 2.2, reverbWet: 0.04 },
  },
];

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en-US', name: 'English (US)', nativeName: 'English (US)', flag: '🇺🇸' },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)', flag: '🇬🇧' },
  { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español (España)', flag: '🇪🇸' },
  { code: 'es-MX', name: 'Spanish (Latin America)', nativeName: 'Español (LatAm)', flag: '🇲🇽' },
  { code: 'fr-FR', name: 'French (France)', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de-DE', name: 'German (Germany)', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'it-IT', name: 'Italian (Italy)', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'hi-IN', name: 'Hindi (India)', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'zh-CN', name: 'Chinese (Mandarin)', nativeName: '中文 (简体)', flag: '🇨🇳' },
  { code: 'ko-KR', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'ar-SA', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'nl-NL', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'pl-PL', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'sv-SE', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'tr-TR', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
];

export const VOICE_CLONE_MODELS: Array<{
  id: VoiceCloneModel;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'elevenlabs_ivc',
    label: 'ElevenLabs Instant Clone',
    badge: 'ELEVENLABS',
    description: 'Creates a persistent cloned Voice ID via ElevenLabs API (runs across Eleven v3 / Multilingual / Turbo).',
  },
  {
    id: 'chatterbox_zero_shot',
    label: 'Zero-Shot Reference Clone',
    badge: 'FAL CHATTERBOX',
    description: 'Clones voice timbre directly from your uploaded audio sample via Fal.ai with paralinguistic expressiveness.',
  },
];

export const FOLEY_CATEGORIES: FoleyCategory[] = [
  'Footsteps',
  'Cloth & Movement',
  'Props & Handling',
  'Ambience & Room Tone',
  'Mechanical & Surface',
  'Nature & Weather',
];

export const EDIT_SFX_CATEGORIES: EditSfxCategory[] = [
  'Whoosh & Swoosh',
  'Impact & Hit',
  'Riser & Swell',
  'UI & Kinetic Pop',
  'Glitch & Stutter',
  'Sub Drop & Boom',
];

export const QUICK_EDIT_SFX_PRESETS: Array<{
  label: string;
  category: EditSfxCategory;
  durationSec: number;
  prompt: string;
}> = [
  {
    label: 'Clean Air Whoosh',
    category: 'Whoosh & Swoosh',
    durationSec: 1.0,
    prompt: 'Crisp, fast aerodynamic camera whip-pan air whoosh transition, clean studio sound design, dry',
  },
  {
    label: 'Sub Bass Drop',
    category: 'Sub Drop & Boom',
    durationSec: 2.0,
    prompt: 'Deep cinematic sub-bass drop impact with smooth warm low-end tail for logo reveal',
  },
  {
    label: 'Kinetic UI Click',
    category: 'UI & Kinetic Pop',
    durationSec: 0.6,
    prompt: 'Modern tactile minimalist UI pop click and subtle glass chime for motion graphic text reveal',
  },
  {
    label: 'Tension Riser',
    category: 'Riser & Swell',
    durationSec: 3.0,
    prompt: 'Smooth cinematic reverse cymbal and filtered synth tension riser building cleanly to peak',
  },
  {
    label: 'Punchy Hit',
    category: 'Impact & Hit',
    durationSec: 1.2,
    prompt: 'Tight modern commercial edit hit punch with crisp transient snap and short low body',
  },
  {
    label: 'Digital Glitch Cut',
    category: 'Glitch & Stutter',
    durationSec: 0.8,
    prompt: 'Short rhythmic digital data glitch stutter transition sound effect, crisp stereo texture',
  },
];

export const MUSIC_GENRE_PRESETS: string[] = [
  'Cinematic Orchestral',
  'Modern Hybrid Electronic',
  'Minimal Felt Piano & Strings',
  'High-Energy Commercial Percussion',
  'Indie Acoustic & Warm Folk',
  'Atmospheric Ambient Score',
  'Sleek Tech & Synth Pulse',
  'Epic Trailer & Brass',
];

export const MUSIC_KEYS: string[] = [
  'C Major',
  'A Minor',
  'D Minor',
  'G Major',
  'E Minor',
  'F Major',
  'B♭ Major',
  'G Minor',
  'C Minor',
  'F♯ Minor',
];

export const EMOTIONAL_BEAT_PRESETS: string[] = [
  'Intimate & Minimal',
  'Curious & Reflective',
  'Suspenseful & Rising',
  'Driving & Kinetic',
  'Triumphant & Heroic',
  'Hopeful & Warm',
  'Melancholic & Poignant',
  'Dark & Industrial',
  'Playful & Lighthearted',
  'Euphoric Finale',
];

export const INSTRUMENTATION_PALETTE: string[] = [
  'Strings',
  'Felt Piano',
  'Brass',
  'Taiko & Percussion',
  'Analog Synth Pads',
  'Sub Bass',
  'Acoustic Guitar',
  'Electric Guitar',
  'Solo Cello',
  'Woodwinds',
  'Choir Texture',
  'Electronic Beat',
];

export const FOLEY_CUE_ENGINES: Array<{
  id: FoleyCueEngineId;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'mirelo_sfx',
    label: 'Mirelo SFX 2.0',
    badge: 'RECOMMENDED FOLEY',
    description: 'Physical surface & environmental foley synthesis with music-suppression built in.',
  },
  {
    id: 'elevenlabs_sfx',
    label: 'ElevenLabs SFX v2',
    badge: 'CRISP DRY CUES',
    description: 'Clean isolated studio foley props, impacts & close-mic details.',
  },
  {
    id: 'stable_audio_sfx',
    label: 'Stable Audio 3 SFX',
    badge: 'TEXTURAL BED',
    description: 'Diffusion SFX checkpoint for ambient room tones, nature & surface textures.',
  },
];

export const FOLEY_BED_ENGINES: Array<{
  id: FoleyBedEngineId;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'mirelo_v2a',
    label: 'Mirelo SFX 2.0 Video-to-Audio',
    badge: 'BEST VIDEO-TO-FOLEY',
    description: 'Reads video frames directly and outputs a pure, speech-free WAV/MP3 synced foley track.',
  },
  {
    id: 'hunyuan_foley',
    label: 'HunyuanVideo-Foley',
    badge: 'PHYSICAL FOLEY',
    description: 'Tencent foley model built specifically for real-world physics & contact transients.',
  },
  {
    id: 'thinksound',
    label: 'ThinkSound CoT',
    badge: 'VISUAL REASONING',
    description: 'Chain-of-thought visual reasoning model that infers nuanced object interactions.',
  },
  {
    id: 'mmaudio_v2',
    label: 'MMAudio V2',
    badge: 'FAST SYNC',
    description: 'Rapid frame-locked audio-video foley synthesis.',
  },
];

export const EDIT_SFX_ENGINES: Array<{
  id: EditSfxEngineId;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'elevenlabs_sfx',
    label: 'ElevenLabs SFX v2',
    badge: 'BEST EDIT SFX',
    description: 'Sharpest commercial transients for air swooshes, hits, risers & UI pops.',
  },
  {
    id: 'sonilo_sfx',
    label: 'Sonilo v1.1 SFX',
    badge: 'EDIT PACING',
    description: 'Purpose-built commercial video SFX model tailored for cuts and motion.',
  },
  {
    id: 'mirelo_sfx',
    label: 'Mirelo SFX 2.0',
    badge: 'ACOUSTIC PUNCH',
    description: 'Clean wide-band cinematic impacts and textured whooshes.',
  },
  {
    id: 'stable_audio_sfx',
    label: 'Stable Audio 3 SFX',
    badge: 'SYNTH & GLITCH',
    description: 'Electronic swells, glitch stutters, risers, and stylized sound design.',
  },
];

export const MUSIC_ENGINES: Array<{
  id: MusicEngineId;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'elevenlabs_music',
    label: 'ElevenLabs Music Composer',
    badge: 'MULTI-BEAT PLAN',
    description: 'Executes structured emotional-beat sections with exact durations & instrumentation.',
  },
  {
    id: 'minimax_music',
    label: 'MiniMax Music v2.6',
    badge: 'SUNO-CLASS / FAL',
    description: 'Best Fal alternative to Suno/Treblo — full structural arrangements, vocals or instrumental.',
  },
  {
    id: 'sonilo_music',
    label: 'Sonilo v1.1 Video-to-Music',
    badge: 'PICTURE-LOCKED',
    description: 'Reads your uploaded video directly to compose music matched to scene pacing.',
  },
  {
    id: 'stable_audio_25',
    label: 'Stable Audio 2.5',
    badge: 'BROADCAST SCORE',
    description: 'Clean stereo instrumental underscore, ambient pads, and commercial beds via Fal.',
  },
  {
    id: 'ace_step',
    label: 'ACE-Step Studio',
    badge: 'OPEN SCORE',
    description: 'Tag-driven open music synthesis with structural lyric/section tokens.',
  },
];

export const DEFAULT_FOLEY_STAGE: FoleyStageData = {
  video: null,
  cueEngine: 'mirelo_sfx',
  bedEngine: 'mirelo_v2a',
  focusPrompt: '',
  analysisSummary: '',
  cues: [],
  syncedBedVideoUrl: null,
  syncedBedAudioUrl: null,
  syncedBedPrompt: '',
};

export const DEFAULT_EDIT_SFX_STAGE: EditSfxStageData = {
  video: null,
  engine: 'elevenlabs_sfx',
  editingStyle: 'Modern sleek commercial cut',
  analysisSummary: '',
  cues: [],
};

export const DEFAULT_MUSIC_STAGE: MusicStageData = {
  video: null,
  analysisSummary: '',
  genre: 'Modern Hybrid Electronic',
  bpm: 112,
  musicalKey: 'D Minor',
  forceInstrumental: true,
  instrumentationPalette: ['Felt Piano', 'Strings', 'Analog Synth Pads', 'Sub Bass'],
  negativeStyles: 'harsh clipping, chaotic noise, vocal chatter',
  customDirection: '',
  engine: 'elevenlabs_music',
  beats: [
    {
      id: 'beat-1',
      label: 'Cold Open / Hook',
      startTimeSec: 0,
      durationSec: 8,
      emotion: 'Intimate & Minimal',
      energy: 3,
      instrumentation: 'Soft felt piano and warm low sub pad',
      tempoFeel: 'Spacious half-time',
    },
    {
      id: 'beat-2',
      label: 'Momentum Build',
      startTimeSec: 8,
      durationSec: 10,
      emotion: 'Suspenseful & Rising',
      energy: 6,
      instrumentation: 'Pulsing analog synth arpeggio, muted strings, subtle percussion',
      tempoFeel: 'Building 8th-note pulse',
    },
    {
      id: 'beat-3',
      label: 'Hero Climax & Resolve',
      startTimeSec: 18,
      durationSec: 12,
      emotion: 'Triumphant & Heroic',
      energy: 9,
      instrumentation: 'Full soaring string section, driving percussion, warm sub bass',
      tempoFeel: 'Driving wide-screen',
    },
  ],
  masterAudioUrl: null,
  takes: [],
};

