import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Loader2,
  Play,
  Pause,
  Square,
  Volume2,
  Download,
  AlertTriangle,
  Plus,
  Trash2,
  Globe,
  Sliders,
  Mic2,
  Wand2,
  VolumeX,
  Eye,
  FileText,
  Upload,
} from 'lucide-react';
import {
  ClonedVoiceProfile,
  ElevenLabsTtsModel,
  GeminiTtsModel,
  PipelineProject,
  ScriptBriefConfig,
  VoiceProvider,
  VoScriptLine,
  VoStudioSettings,
} from '../../types/pipeline';
import {
  ALL_ELEVENLABS_VOICES,
  ALL_GEMINI_VOICE_PRESETS,
  CORE_ELEVENLABS_VOICES,
  CORE_GEMINI_VOICES,
  DEFAULT_VO_SETTINGS,
  ELEVENLABS_TTS_MODELS,
  EMOTIONAL_TONES,
  GEMINI_TTS_MODELS,
  SUPPORTED_LANGUAGES,
  type VoicePresetMeta,
} from '../../utils/voPresets';
import {
  base64ToAudioBuffer,
  concatenateAudioBuffers,
  exportMasterOrStems,
  getAudioContext,
  processAudioWithDSP,
  urlToAudioBuffer,
} from '../../utils/voAudioEngine';
import {
  createClonedVoiceApi,
  deleteClonedVoiceApi,
  fetchClonedVoices,
  fetchElevenLabsVoices,
} from '../../utils/llmClient';
import { parseJsonResponse } from '../../utils/safeFetch';
import { VoiceCloneModal } from './VoiceCloneModal';

interface Step8VoStudioProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onProjectUpdated: (updated: PipelineProject) => void;
  onPreviewPdf?: () => void;
  elevenLabsConfigured?: boolean;
  falConfigured?: boolean;
}

const TIMELINE_SEGMENT_COLORS = [
  '#f59e0b',
  '#10b981',
  '#38bdf8',
  '#a78bfa',
  '#fb7185',
  '#34d399',
];

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function pitchRatioToSemitones(ratio: number): number {
  return Math.round(12 * Math.log2(Math.max(0.5, ratio)) * 2) / 2;
}

function semitonesToPitchRatio(semitones: number): number {
  return Number(Math.pow(2, semitones / 12).toFixed(3));
}

function isElevenLabsModel(model?: string): model is ElevenLabsTtsModel {
  return (
    model === 'eleven_v3' ||
    model === 'eleven_multilingual_v2' ||
    model === 'eleven_flash_v2_5' ||
    model === 'eleven_turbo_v2_5'
  );
}

export const Step8VoStudio: React.FC<Step8VoStudioProps> = ({
  project,
  onUpdateProject,
  onProjectUpdated,
  onPreviewPdf,
  elevenLabsConfigured = true,
  falConfigured = true,
}) => {
  const voSettings: VoStudioSettings = useMemo(
    () => ({
      ...DEFAULT_VO_SETTINGS,
      ...(project.voSettings || {}),
    }),
    [project.voSettings]
  );

  const activeProvider: VoiceProvider = voSettings.provider || 'gemini';

  const [elevenLabsCatalog, setElevenLabsCatalog] = useState<VoicePresetMeta[]>(
    ALL_ELEVENLABS_VOICES
  );
  const [clonedVoices, setClonedVoices] = useState<ClonedVoiceProfile[]>([]);
  const [voiceCloneModalOpen, setVoiceCloneModalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    void fetchElevenLabsVoices()
      .then((res) => {
        if (mounted && Array.isArray(res.voices) && res.voices.length > 0) {
          setElevenLabsCatalog(res.voices);
        }
      })
      .catch(() => undefined);
    void fetchClonedVoices()
      .then((list) => {
        if (mounted) setClonedVoices(list);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const [isWritingScript, setIsWritingScript] = useState(false);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [briefBrand, setBriefBrand] = useState(
    project.scriptBrief?.productOrBrand || project.product.name || ''
  );
  const [briefPrompt, setBriefPrompt] = useState(
    project.scriptBrief?.topicPrompt || project.product.description || ''
  );
  const [briefAudience, setBriefAudience] = useState(
    project.scriptBrief?.targetAudience || ''
  );
  const [briefSpeaker, setBriefSpeaker] = useState(
    project.scriptBrief?.speakerName || 'Narrator'
  );
  const [briefDurationSec, setBriefDurationSec] = useState<number>(
    project.scriptBrief?.targetDurationSec || 30
  );
  const [briefLineCount, setBriefLineCount] = useState<number>(
    project.scriptBrief?.lineCount || 5
  );
  const [briefToneNote, setBriefToneNote] = useState(
    project.scriptBrief?.toneNote || voSettings.emotionalTone
  );

  // Sync brief fields when switching projects
  useEffect(() => {
    setBriefBrand(project.scriptBrief?.productOrBrand || project.product.name || '');
    setBriefPrompt(
      project.scriptBrief?.topicPrompt || project.product.description || ''
    );
    setBriefAudience(project.scriptBrief?.targetAudience || '');
    setBriefSpeaker(project.scriptBrief?.speakerName || 'Narrator');
    setBriefDurationSec(project.scriptBrief?.targetDurationSec || 30);
    setBriefLineCount(project.scriptBrief?.lineCount || 5);
    setBriefToneNote(
      project.scriptBrief?.toneNote ||
        project.voSettings?.emotionalTone ||
        DEFAULT_VO_SETTINGS.emotionalTone
    );
  }, [project.id]);

  // Paste / Upload script modal state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPdfBase64, setImportPdfBase64] = useState<string | null>(null);
  const [importFilename, setImportFilename] = useState<string | null>(null);
  const [importSpeaker, setImportSpeaker] = useState('Narrator');
  const [importAiEnhance, setImportAiEnhance] = useState(false);
  const [importReplaceExisting, setImportReplaceExisting] = useState(true);
  const [isImportingScript, setIsImportingScript] = useState(false);
  const scriptFileInputRef = useRef<HTMLInputElement | null>(null);

  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Voice audition & generation state
  const [auditioningVoiceId, setAuditioningVoiceId] = useState<string | null>(null);
  const [generatingLineId, setGeneratingLineId] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);

  // Translation popover state
  const [translateOpen, setTranslateOpen] = useState(false);
  const [translateTargetLang, setTranslateTargetLang] = useState('es-MX');
  const [isTranslating, setIsTranslating] = useState(false);

  // Export modal state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'master' | 'stems'>('master');
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [exportBitrate, setExportBitrate] = useState<128 | 192 | 320>(320);
  const [exportNormalize, setExportNormalize] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Audio playback & waveform state
  const rawBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const [processedBuffers, setProcessedBuffers] = useState<
    Array<{
      line: VoScriptLine;
      buffer: AudioBuffer;
      startSec: number;
      endSec: number;
      pauseAfter: number;
    }>
  >([]);
  const [isDecodingAudio, setIsDecodingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [volume, setVolume] = useState(0.95);
  const [isMuted, setIsMuted] = useState(false);
  const [activePlayingLineId, setActivePlayingLineId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const masterPlayBufferRef = useRef<AudioBuffer | null>(null);
  const playStartCtxTimeRef = useRef<number>(0);
  const playOffsetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const totalTargetSeconds = useMemo(
    () =>
      project.voScript.reduce(
        (sum, v) => sum + (Number(v.durationSec) || 4),
        0
      ),
    [project.voScript]
  );

  const readyAudioLines = useMemo(
    () => project.voScript.filter((v) => Boolean(v.audioUrl)),
    [project.voScript]
  );

  const cloneVoicePresets: VoicePresetMeta[] = useMemo(
    () =>
      clonedVoices.map((c) => ({
        id: c.id,
        displayName: c.name,
        gender: 'Neutral',
        timbre: c.method === 'elevenlabs' ? 'ElevenLabs Instant Clone' : 'Zero-Shot Chatterbox Clone',
        description: c.description || 'Custom cloned voice from uploaded/recorded audio sample.',
        bestFor: 'Authentic speaker cloning',
        defaultPitch: 1.0,
        sampleSentence: 'Designed for quiet precision when every second counts.',
        tags: ['Cloned'],
      })),
    [clonedVoices]
  );

  const activeVoicePresets = useMemo(
    () =>
      activeProvider === 'clone'
        ? cloneVoicePresets
        : activeProvider === 'elevenlabs'
          ? elevenLabsCatalog
          : ALL_GEMINI_VOICE_PRESETS,
    [activeProvider, cloneVoicePresets, elevenLabsCatalog]
  );

  const coreVoicePresets = useMemo(
    () =>
      activeProvider === 'clone'
        ? cloneVoicePresets.slice(0, 6)
        : activeProvider === 'elevenlabs'
          ? CORE_ELEVENLABS_VOICES
          : CORE_GEMINI_VOICES,
    [activeProvider, cloneVoicePresets]
  );

  const activeCloneProfile = useMemo(
    () =>
      activeProvider === 'clone'
        ? clonedVoices.find(
            (c) => c.id === (voSettings.clonedVoiceId || voSettings.voiceName)
          ) || clonedVoices[0] || null
        : null,
    [activeProvider, clonedVoices, voSettings.clonedVoiceId, voSettings.voiceName]
  );

  const selectedVoiceMeta = useMemo(() => {
    if (activeProvider === 'clone') {
      const hit = cloneVoicePresets.find(
        (v) => v.id === (voSettings.clonedVoiceId || voSettings.voiceName)
      );
      return (
        hit ||
        cloneVoicePresets[0] || {
          id: '',
          displayName: 'No Clone Selected',
          gender: 'Neutral' as const,
          timbre: 'Upload or record a sample',
          description: 'Create a custom voice clone from a 10–30 second solo speech sample.',
          bestFor: 'Custom Voiceover',
          defaultPitch: 1.0,
          sampleSentence: 'Designed for quiet precision when every second counts.',
          tags: ['Clone'],
        }
      );
    }
    const activeId =
      activeProvider === 'elevenlabs'
        ? voSettings.elevenLabsVoiceId?.trim() || voSettings.voiceName
        : voSettings.voiceName;
    const hit = activeVoicePresets.find(
      (v) => v.id === activeId || v.displayName === activeId
    );
    if (hit) return hit;
    if (activeProvider === 'elevenlabs' && activeId) {
      return {
        id: activeId,
        displayName: activeId,
        gender: 'Neutral' as const,
        timbre: 'Custom ElevenLabs Voice ID',
        description: 'Custom ElevenLabs voice ID or cloned voice.',
        bestFor: 'Custom Voiceover',
        defaultPitch: 1.0,
        sampleSentence:
          'Designed for quiet precision when every second counts.',
        tags: ['Custom'],
      };
    }
    return coreVoicePresets[0] || CORE_GEMINI_VOICES[0];
  }, [
    activeProvider,
    activeVoicePresets,
    cloneVoicePresets,
    coreVoicePresets,
    voSettings.voiceName,
    voSettings.elevenLabsVoiceId,
    voSettings.clonedVoiceId,
  ]);

  const stopPlayback = useCallback(() => {
    if (playbackSourceRef.current) {
      try {
        playbackSourceRef.current.stop();
        playbackSourceRef.current.disconnect();
      } catch {
        // Ignore already stopped
      }
      playbackSourceRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsPlaying(false);
    setActivePlayingLineId(null);
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  // Rebuild processed DSP audio timeline whenever lines or DSP settings change
  useEffect(() => {
    let cancelled = false;

    const rebuildTimeline = async () => {
      const linesWithAudio = project.voScript.filter((v) => Boolean(v.audioUrl));
      if (linesWithAudio.length === 0) {
        masterPlayBufferRef.current = null;
        setProcessedBuffers([]);
        setTotalDuration(0);
        setCurrentTime(0);
        return;
      }

      setIsDecodingAudio(true);
      try {
        const ctx = getAudioContext();
        const segments: Array<{
          line: VoScriptLine;
          buffer: AudioBuffer;
          startSec: number;
          endSec: number;
          pauseAfter: number;
        }> = [];
        let cursor = 0;

        for (let i = 0; i < linesWithAudio.length; i++) {
          const line = linesWithAudio[i];
          if (!line.audioUrl) continue;

          let rawBuf = rawBufferCacheRef.current.get(line.audioUrl);
          if (!rawBuf) {
            rawBuf = await urlToAudioBuffer(line.audioUrl, ctx);
            rawBufferCacheRef.current.set(line.audioUrl, rawBuf);
          }

          const lineTone =
            EMOTIONAL_TONES.find(
              (t) => t.id === (line.emotionalTone || voSettings.emotionalTone)
            ) || EMOTIONAL_TONES[0];

          const effectiveSpeed = voSettings.singleVoiceMode
            ? voSettings.speed
            : (line.speed ?? voSettings.speed);
          const effectivePitch = voSettings.singleVoiceMode
            ? voSettings.pitch
            : (line.pitch ?? voSettings.pitch);

          const processed = voSettings.enhanceWithDSP
            ? await processAudioWithDSP(rawBuf, {
                speed: effectiveSpeed,
                pitch: effectivePitch,
                bassBoostDb: lineTone.dspProfile.bassBoostDb,
                trebleBoostDb: lineTone.dspProfile.trebleBoostDb,
                midPresenceDb: lineTone.dspProfile.midPresenceDb,
                reverbWet: lineTone.dspProfile.reverbWet,
                compression: true,
              })
            : await processAudioWithDSP(rawBuf, {
                speed: effectiveSpeed,
                pitch: effectivePitch,
              });

          const gap = line.pauseAfter ?? voSettings.pauseAfter;
          segments.push({
            line,
            buffer: processed,
            startSec: cursor,
            endSec: cursor + processed.duration,
            pauseAfter: gap,
          });
          cursor += processed.duration + (i < linesWithAudio.length - 1 ? gap : 0);
        }

        if (cancelled) return;

        const gapMap: Record<number, number> = {};
        segments.forEach((seg, idx) => {
          gapMap[idx] = seg.pauseAfter;
        });

        const master = concatenateAudioBuffers(
          ctx,
          segments.map((s) => s.buffer),
          voSettings.pauseAfter,
          gapMap
        );

        masterPlayBufferRef.current = master;
        setProcessedBuffers(segments);
        setTotalDuration(master ? master.duration : 0);
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Could not decode saved VO audio.'
          );
        }
      } finally {
        if (!cancelled) setIsDecodingAudio(false);
      }
    };

    void rebuildTimeline();
    return () => {
      cancelled = true;
    };
  }, [
    project.voScript,
    voSettings.enhanceWithDSP,
    voSettings.speed,
    voSettings.pitch,
    voSettings.pauseAfter,
    voSettings.emotionalTone,
    voSettings.singleVoiceMode,
  ]);

  // Draw waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx2d.clearRect(0, 0, width, height);
    ctx2d.fillStyle = '#111114';
    ctx2d.fillRect(0, 0, width, height);

    const master = masterPlayBufferRef.current;
    if (!master || totalDuration <= 0) {
      ctx2d.strokeStyle = '#2A2A34';
      ctx2d.beginPath();
      ctx2d.moveTo(0, height / 2);
      ctx2d.lineTo(width, height / 2);
      ctx2d.stroke();
      return;
    }

    const channelData = master.getChannelData(0);
    const barCount = 120;
    const step = Math.max(1, Math.floor(channelData.length / barCount));
    const barWidth = width / barCount;
    const progressRatio = Math.min(1, Math.max(0, currentTime / totalDuration));

    for (let i = 0; i < barCount; i++) {
      let peak = 0;
      const startIdx = i * step;
      for (let j = 0; j < step && startIdx + j < channelData.length; j += 4) {
        const val = Math.abs(channelData[startIdx + j]);
        if (val > peak) peak = val;
      }
      const barH = Math.max(4, peak * (height * 0.84));
      const x = i * barWidth;
      const y = (height - barH) / 2;
      const isPlayed = i / barCount <= progressRatio;
      ctx2d.fillStyle = isPlayed ? '#f59e0b' : '#334155';
      ctx2d.fillRect(x + 1, y, Math.max(2, barWidth - 2), barH);
    }

    const needleX = progressRatio * width;
    ctx2d.fillStyle = '#fef3c7';
    ctx2d.fillRect(needleX, 0, 2, height);
  }, [processedBuffers, currentTime, totalDuration]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const startPlaybackFrom = (offsetSec: number) => {
    const master = masterPlayBufferRef.current;
    if (!master) return;

    stopPlayback();
    const audioCtx = getAudioContext();
    const safeOffset = Math.max(0, Math.min(offsetSec, master.duration - 0.05));

    const source = audioCtx.createBufferSource();
    source.buffer = master;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = isMuted ? 0 : volume;

    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    playbackSourceRef.current = source;
    gainNodeRef.current = gainNode;
    playStartCtxTimeRef.current = audioCtx.currentTime;
    playOffsetRef.current = safeOffset;
    setIsPlaying(true);

    source.onended = () => {
      if (playbackSourceRef.current === source) {
        playbackSourceRef.current = null;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setIsPlaying(false);
        setActivePlayingLineId(null);
        setCurrentTime(0);
        playOffsetRef.current = 0;
      }
    };

    source.start(0, safeOffset);

    const tick = () => {
      if (!playbackSourceRef.current) return;
      const elapsed = audioCtx.currentTime - playStartCtxTimeRef.current;
      const pos = Math.min(master.duration, playOffsetRef.current + elapsed);
      setCurrentTime(pos);

      const seg = processedBuffers.find((s) => pos >= s.startSec && pos <= s.endSec);
      setActivePlayingLineId(seg ? seg.line.id : null);

      if (pos < master.duration) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      playOffsetRef.current = currentTime;
      stopPlayback();
    } else {
      startPlaybackFrom(currentTime >= totalDuration - 0.05 ? 0 : currentTime);
    }
  };

  const handlePlaySingleLine = async (line: VoScriptLine) => {
    if (!line.audioUrl) return;
    const seg = processedBuffers.find((s) => s.line.id === line.id);
    if (seg) {
      startPlaybackFrom(seg.startSec);
      return;
    }
    try {
      stopPlayback();
      const ctx = getAudioContext();
      const buf = await urlToAudioBuffer(line.audioUrl, ctx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = isMuted ? 0 : volume;
      src.connect(gain);
      gain.connect(ctx.destination);
      playbackSourceRef.current = src;
      setIsPlaying(true);
      setActivePlayingLineId(line.id);
      src.onended = () => {
        setIsPlaying(false);
        setActivePlayingLineId(null);
      };
      src.start(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not play line audio.');
    }
  };

  const updateVoSettings = (patch: Partial<VoStudioSettings>) => {
    const nextSettings: VoStudioSettings = { ...voSettings, ...patch };
    void onUpdateProject({
      ...project,
      voSettings: nextSettings,
    });
  };

  const handleSwitchProvider = (nextProvider: VoiceProvider) => {
    if (nextProvider === activeProvider) return;
    if (nextProvider === 'clone') {
      const targetClone =
        clonedVoices.find((c) => c.id === voSettings.clonedVoiceId) ||
        clonedVoices[0];
      updateVoSettings({
        provider: 'clone',
        voiceName: targetClone?.id || '',
        clonedVoiceId: targetClone?.id || '',
        ttsModel:
          targetClone?.method === 'chatterbox'
            ? 'chatterbox_zero_shot'
            : 'elevenlabs_ivc',
      });
      if (clonedVoices.length === 0) {
        setVoiceCloneModalOpen(true);
      }
    } else if (nextProvider === 'elevenlabs') {
      const currentIsEl = elevenLabsCatalog.some(
        (v) => v.id === voSettings.voiceName || v.displayName === voSettings.voiceName
      );
      const nextVoice =
        voSettings.elevenLabsVoiceId?.trim() ||
        (currentIsEl ? voSettings.voiceName : CORE_ELEVENLABS_VOICES[0].id);
      const nextModel: ElevenLabsTtsModel = isElevenLabsModel(voSettings.ttsModel)
        ? voSettings.ttsModel
        : 'eleven_v3';
      updateVoSettings({
        provider: 'elevenlabs',
        voiceName: nextVoice,
        ttsModel: nextModel,
      });
    } else {
      const currentIsGem = ALL_GEMINI_VOICE_PRESETS.some(
        (v) => v.id === voSettings.voiceName
      );
      const nextVoice = currentIsGem
        ? voSettings.voiceName
        : CORE_GEMINI_VOICES[0].id;
      const nextModel: GeminiTtsModel =
        voSettings.ttsModel === 'gemini-3.8-flash-tts'
          ? 'gemini-3.8-flash-tts'
          : 'gemini-3.8-flash-lite-tts';
      updateVoSettings({
        provider: 'gemini',
        voiceName: nextVoice,
        ttsModel: nextModel,
      });
    }
  };

  const handleApplySettingsToAllLines = () => {
    const chosenVoice =
      activeProvider === 'clone'
        ? voSettings.clonedVoiceId || voSettings.voiceName
        : activeProvider === 'elevenlabs'
          ? voSettings.elevenLabsVoiceId?.trim() || voSettings.voiceName
          : voSettings.voiceName;
    const nextLines = project.voScript.map((v) => ({
      ...v,
      provider: activeProvider,
      ttsModel: voSettings.ttsModel,
      voiceName: chosenVoice,
      emotionalTone: voSettings.emotionalTone,
      emotionIntensity: voSettings.emotionIntensity,
      speed: voSettings.speed,
      pitch: voSettings.pitch,
      language: voSettings.language,
      pauseAfter: voSettings.pauseAfter,
    }));
    void onUpdateProject({
      ...project,
      voScript: nextLines,
      voManuallyEdited: true,
    });
    const provLabel =
      activeProvider === 'clone'
        ? 'Cloned Voice'
        : activeProvider === 'elevenlabs'
          ? 'ElevenLabs'
          : 'Gemini';
    setStatusNote(
      `Applied ${selectedVoiceMeta.displayName} (${provLabel} · ${voSettings.emotionalTone}) settings across all ${nextLines.length} lines.`
    );
  };

  const updateVoLine = (lineId: string, patch: Partial<VoScriptLine>) => {
    const nextLines = project.voScript.map((v) =>
      v.id === lineId ? { ...v, ...patch } : v
    );
    void onUpdateProject({
      ...project,
      voScript: nextLines,
      voManuallyEdited: true,
    });
  };

  const handleAddLine = () => {
    const durationSec = 4;
    const nextNum = project.voScript.length + 1;
    const chosenVoice =
      activeProvider === 'clone'
        ? voSettings.clonedVoiceId || voSettings.voiceName
        : activeProvider === 'elevenlabs'
          ? voSettings.elevenLabsVoiceId?.trim() || voSettings.voiceName
          : voSettings.voiceName;
    const newLine: VoScriptLine = {
      id: `vo-${Date.now()}`,
      shotId: `C${String(nextNum).padStart(2, '0')}`,
      speaker: briefSpeaker || 'Narrator',
      direction: 'warm, clear commercial delivery',
      line: '',
      audioTags: 'clear studio delivery',
      emotionalTone: voSettings.emotionalTone,
      emotionIntensity: voSettings.emotionIntensity,
      provider: activeProvider,
      voiceName: chosenVoice,
      ttsModel: voSettings.ttsModel,
      speed: voSettings.speed,
      pitch: voSettings.pitch,
      language: voSettings.language,
      pauseAfter: voSettings.pauseAfter,
      audioUrl: null,
      durationSec,
      targetWords: Math.max(3, Math.round(durationSec * 2.5)),
    };
    void onUpdateProject({
      ...project,
      voScript: [...project.voScript, newLine],
      voHasGenerated: true,
      voManuallyEdited: true,
    });
  };

  const handleRemoveLine = (lineId: string) => {
    void onUpdateProject({
      ...project,
      voScript: project.voScript.filter((v) => v.id !== lineId),
      voManuallyEdited: true,
    });
  };

  const handleOpenWriteScript = () => {
    if (project.voManuallyEdited && project.voScript.length > 0) {
      setConfirmOverwriteOpen(true);
    } else {
      setScriptModalOpen(true);
    }
  };

  const handleRunGenerateScript = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);
    setStatusNote(null);
    setIsWritingScript(true);
    try {
      const briefPayload: ScriptBriefConfig = {
        topicPrompt: briefPrompt.trim(),
        productOrBrand: briefBrand.trim() || project.product.name,
        targetAudience: briefAudience.trim(),
        speakerName: briefSpeaker.trim() || 'Narrator',
        targetDurationSec: Number(briefDurationSec) || 30,
        lineCount: Number(briefLineCount) || 5,
        toneNote: briefToneNote.trim() || voSettings.emotionalTone,
      };
      const resp = await fetch('/api/pipeline/vo-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          ...briefPayload,
          language: voSettings.language,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
        resp,
        'Could not generate VO script.'
      );
      onProjectUpdated(data.project);
      setScriptModalOpen(false);
      setStatusNote('VO script written by Gemini and timed at ~2.5 words/sec.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not write VO script.');
    } finally {
      setIsWritingScript(false);
    }
  };

  const handleScriptFileSelect = async (file: File) => {
    setErrorMsg(null);
    setImportFilename(file.name);
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      const reader = new FileReader();
      reader.onload = () => {
        setImportPdfBase64(String(reader.result || ''));
        setImportText('');
      };
      reader.readAsDataURL(file);
      return;
    }
    const text = await file.text();
    setImportPdfBase64(null);
    setImportText(text);
  };

  const handleRunImportScript = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!importText.trim() && !importPdfBase64) {
      setErrorMsg('Paste script text or select a script file to upload.');
      return;
    }
    setErrorMsg(null);
    setStatusNote(null);
    setIsImportingScript(true);
    try {
      const resp = await fetch('/api/pipeline/vo-import-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          rawText: importText,
          pdfBase64: importPdfBase64 || undefined,
          filename: importFilename || undefined,
          useAiEnhance: importAiEnhance,
          defaultSpeaker: importSpeaker.trim() || 'Narrator',
          replaceExisting: importReplaceExisting,
        }),
      });
      const data = await parseJsonResponse<{
        project: PipelineProject;
        importedCount: number;
      }>(resp, 'Could not import script.');
      onProjectUpdated(data.project);
      setImportModalOpen(false);
      setImportText('');
      setImportPdfBase64(null);
      setImportFilename(null);
      setStatusNote(
        `Loaded ${data.importedCount} voiceover cue${data.importedCount === 1 ? '' : 's'} into the studio.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not import script.');
    } finally {
      setIsImportingScript(false);
    }
  };

  const handleAuditionVoice = async (voiceId: string, sampleText?: string) => {
    setErrorMsg(null);
    setAuditioningVoiceId(voiceId);
    try {
      const preset = activeVoicePresets.find((v) => v.id === voiceId);
      const resp = await fetch('/api/pipeline/vo-audition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text:
            sampleText ||
            preset?.sampleSentence ||
            'Designed for quiet precision when every second counts.',
          provider: activeProvider,
          voiceName: voiceId,
          emotionalTone: voSettings.emotionalTone,
          emotionIntensity: voSettings.emotionIntensity,
          ttsModel: voSettings.ttsModel,
          language: voSettings.language,
          stylePrompt: voSettings.customStylePrompt,
          speed: voSettings.speed,
          elevenLabsStability: voSettings.elevenLabsStability,
          elevenLabsSimilarityBoost: voSettings.elevenLabsSimilarityBoost,
          elevenLabsStyle: voSettings.elevenLabsStyle,
        }),
      });
      const data = await parseJsonResponse<{ audioBase64: string }>(
        resp,
        'Voice audition failed.'
      );

      stopPlayback();
      const ctx = getAudioContext();
      const buf = await base64ToAudioBuffer(data.audioBase64, ctx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = isMuted ? 0 : volume;
      src.connect(gain);
      gain.connect(ctx.destination);
      playbackSourceRef.current = src;
      setIsPlaying(true);
      src.onended = () => setIsPlaying(false);
      src.start(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not audition voice.');
    } finally {
      setAuditioningVoiceId(null);
    }
  };

  const synthesizeLine = async (line: VoScriptLine): Promise<PipelineProject | null> => {
    if (!line.line.trim()) return null;
    setGeneratingLineId(line.id);

    const effectiveProvider: VoiceProvider = voSettings.singleVoiceMode
      ? activeProvider
      : line.provider || activeProvider;

    const globalVoice =
      activeProvider === 'clone'
        ? voSettings.clonedVoiceId || voSettings.voiceName
        : activeProvider === 'elevenlabs'
          ? voSettings.elevenLabsVoiceId?.trim() || voSettings.voiceName
          : voSettings.voiceName;

    const activeVoice = voSettings.singleVoiceMode
      ? globalVoice
      : line.voiceName || globalVoice;

    const activeModel = voSettings.singleVoiceMode
      ? voSettings.ttsModel
      : line.ttsModel ||
        (effectiveProvider === 'clone'
          ? 'elevenlabs_ivc'
          : effectiveProvider === 'elevenlabs'
            ? isElevenLabsModel(voSettings.ttsModel)
              ? voSettings.ttsModel
              : 'eleven_v3'
            : !isElevenLabsModel(voSettings.ttsModel)
              ? voSettings.ttsModel
              : 'gemini-3.8-flash-lite-tts');

    const activeTone = line.emotionalTone || voSettings.emotionalTone;
    const activeSpeed = voSettings.singleVoiceMode
      ? voSettings.speed
      : line.speed ?? voSettings.speed;
    const activePitch = voSettings.singleVoiceMode
      ? voSettings.pitch
      : line.pitch ?? voSettings.pitch;

    const resp = await fetch('/api/pipeline/vo-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        lineId: line.id,
        line: line.line,
        direction: line.direction,
        speaker: line.speaker,
        audioTags: line.audioTags,
        emotionalTone: activeTone,
        emotionIntensity: line.emotionIntensity ?? voSettings.emotionIntensity,
        provider: effectiveProvider,
        voiceName: activeVoice,
        speed: activeSpeed,
        pitch: activePitch,
        language: voSettings.language,
        pauseAfter: line.pauseAfter ?? voSettings.pauseAfter,
        ttsModel: activeModel,
        stylePrompt: voSettings.customStylePrompt,
        skipPitchText: voSettings.enhanceWithDSP,
        skipSpeedText: voSettings.enhanceWithDSP,
        elevenLabsStability: voSettings.elevenLabsStability,
        elevenLabsSimilarityBoost: voSettings.elevenLabsSimilarityBoost,
        elevenLabsStyle: voSettings.elevenLabsStyle,
        voSettings,
      }),
    });
    const data = await parseJsonResponse<{
      audioBase64?: string;
      audioUrl?: string;
      project: PipelineProject;
    }>(resp, `Could not synthesize ${line.shotId}.`);

    if (data.audioBase64 && data.audioUrl) {
      try {
        const ctx = getAudioContext();
        const buf = await base64ToAudioBuffer(data.audioBase64, ctx);
        rawBufferCacheRef.current.set(data.audioUrl, buf);
      } catch {
        // Fallback to URL fetch if decode deferred
      }
    }
    onProjectUpdated(data.project);
    return data.project;
  };

  const handleGenerateSingleLine = async (line: VoScriptLine) => {
    setErrorMsg(null);
    setStatusNote(null);
    try {
      await synthesizeLine(line);
      setStatusNote(`Voiceover audio ready for ${line.shotId}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Voice generation failed.');
    } finally {
      setGeneratingLineId(null);
    }
  };

  const handleGenerateAllAudio = async () => {
    const speakable = project.voScript.filter((v) => v.line.trim().length > 0);
    if (speakable.length === 0) return;

    setErrorMsg(null);
    setStatusNote(null);
    setIsGeneratingAll(true);
    try {
      for (let idx = 0; idx < speakable.length; idx++) {
        const line = speakable[idx];
        setStatusNote(
          `Synthesizing voiceover ${idx + 1}/${speakable.length} (${line.shotId})...`
        );
        await synthesizeLine(line);
        if (idx < speakable.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
      const engineLabel =
        activeProvider === 'clone'
          ? 'Cloned Voice'
          : activeProvider === 'elevenlabs'
            ? 'ElevenLabs'
            : 'Gemini TTS';
      setStatusNote(
        `Rendered ${speakable.length} voiceover clip${speakable.length === 1 ? '' : 's'} with ${engineLabel}.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Batch voiceover generation stopped early.'
      );
    } finally {
      setGeneratingLineId(null);
      setIsGeneratingAll(false);
    }
  };

  const handleTranslateScript = async () => {
    setErrorMsg(null);
    setIsTranslating(true);
    try {
      const langMeta = SUPPORTED_LANGUAGES.find((l) => l.code === translateTargetLang);
      const resp = await fetch('/api/pipeline/vo-translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          targetLanguage: translateTargetLang,
          targetLanguageName: langMeta?.name || translateTargetLang,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject }>(
        resp,
        'Could not translate script.'
      );
      onProjectUpdated(data.project);
      setTranslateOpen(false);
      setStatusNote(
        `Translated VO script into ${langMeta?.name || translateTargetLang}. Regenerate audio clips to hear the new language.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Translation failed.');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleRunExport = async () => {
    if (processedBuffers.length === 0) return;
    setIsExporting(true);
    setErrorMsg(null);
    try {
      await exportMasterOrStems({
        projectName: `${project.client}-${project.product.name}`,
        items: processedBuffers.map((seg) => ({
          shotId: seg.line.shotId,
          speaker: seg.line.speaker,
          line: seg.line.line,
          buffer: seg.buffer,
          pauseAfter: seg.pauseAfter,
        })),
        format: exportFormat,
        bitrate: exportBitrate,
        normalize: exportNormalize,
        mode: exportMode,
      });
      setExportOpen(false);
      setStatusNote(
        exportMode === 'master'
          ? `Downloaded master ${exportFormat.toUpperCase()} voiceover track.`
          : `Downloaded individual stems (.zip) in ${exportFormat.toUpperCase()}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const pitchSemitones = pitchRatioToSemitones(voSettings.pitch);
  const currentAuditionVoiceId =
    activeProvider === 'clone'
      ? voSettings.clonedVoiceId || voSettings.voiceName || clonedVoices[0]?.id || ''
      : activeProvider === 'elevenlabs'
        ? voSettings.elevenLabsVoiceId?.trim() || voSettings.voiceName
        : voSettings.voiceName;

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
        <div>
          <div className="text-xs font-medium text-[#C6202F]">
            52Launch · Script &amp; Multi-Voice Studio
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Voiceover Script &amp; Audio Production
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Generate or paste your script, cast from Gemini 3.8 TTS or ElevenLabs voices,
            dial in emotional tone &amp; pacing, audition live, and export master WAV/MP3 or stems.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isWritingScript}
            onClick={handleOpenWriteScript}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
          >
            {isWritingScript ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#C6202F]" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#C6202F]" />
            )}
            {isWritingScript
              ? 'Writing VO Script...'
              : project.voScript.length > 0
                ? 'Write / Refresh script (Gemini)'
                : 'Write VO script (Gemini)'}
          </button>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-[#891A23]" />
            Paste / Upload script
          </button>

          <div className="relative">
            <button
              type="button"
              disabled={project.voScript.length === 0}
              onClick={() => setTranslateOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-[#891A23]" />
              Translate
            </button>
            {translateOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white border border-[#E2E2E6] rounded-xl p-4 shadow-2xl z-30 space-y-3">
                <div className="text-xs font-semibold text-[#111114]">
                  Translate Script for International Spot
                </div>
                <select
                  value={translateTargetLang}
                  onChange={(e) => setTranslateTargetLang(e.target.value)}
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setTranslateOpen(false)}
                    className="px-2.5 py-1.5 text-xs text-[#5A5A66] hover:text-[#24242B] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isTranslating}
                    onClick={() => void handleTranslateScript()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
                  >
                    {isTranslating && <Loader2 className="w-3 h-3 animate-spin" />}
                    Translate Lines
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={
              isGeneratingAll ||
              Boolean(generatingLineId) ||
              project.voScript.every((v) => !v.line.trim())
            }
            onClick={() => void handleGenerateAllAudio()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
          >
            {isGeneratingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mic2 className="w-3.5 h-3.5" />
            )}
            {isGeneratingAll
              ? 'Generating VO...'
              : `Generate all VO audio (${project.voScript.filter((v) => v.line.trim()).length})`}
          </button>

          {onPreviewPdf && project.voScript.length > 0 && (
            <button
              type="button"
              onClick={onPreviewPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-[#891A23]" />
              Preview PDF
            </button>
          )}

          <button
            type="button"
            disabled={processedBuffers.length === 0}
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export WAV / MP3
          </button>
        </div>
      </div>

      {/* Overwrite manual edit confirmation */}
      {confirmOverwriteOpen && (
        <div className="p-4 rounded-xl bg-[#FDF4F5] border border-[#C6202F]/55 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-[#6E141C]">
            <AlertTriangle className="w-4 h-4 text-[#C6202F] shrink-0 mt-0.5" />
            <div>
              <strong>You have manual edits in the VO script.</strong> Generating a new
              Gemini script will replace your current lines. Continue?
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmOverwriteOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] rounded-lg cursor-pointer"
            >
              Keep my edits
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmOverwriteOpen(false);
                setScriptModalOpen(true);
              }}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
            >
              Configure fresh Gemini script
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
          {errorMsg}
        </div>
      )}

      {statusNote && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-900">
          {statusNote}
        </div>
      )}

      {/* Main Split Studio Layout: Left Voice & Delivery Casting, Right Waveform + Script Lines */}
      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6 items-start">
        {/* LEFT PANEL: Gemini & ElevenLabs Voice Casting & Delivery Studio */}
        <aside className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#C6202F]" />
              <h2 className="text-sm font-bold text-[#111114]">
                Voice Casting &amp; Cloning
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setVoiceCloneModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#891A23] bg-[#FDF4F5] hover:bg-[#F9E4E7] border border-[#EABAC0] px-2.5 py-1 rounded-md cursor-pointer transition-colors"
            >
              <Mic2 className="w-3 h-3" />
              Clone Voice ({clonedVoices.length})
            </button>
          </div>

          {/* Voice Provider Toggle + Engine Model Picker */}
          <div className="space-y-2.5">
            <label className="text-xs font-medium text-[#3A3A44] block">
              Voice Engine Provider &amp; Model
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handleSwitchProvider('gemini')}
                className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  activeProvider === 'gemini'
                    ? 'bg-[#C6202F] border-[#AD1A27] text-white'
                    : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                }`}
              >
                Gemini 3.8
              </button>
              <button
                type="button"
                onClick={() => handleSwitchProvider('elevenlabs')}
                className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  activeProvider === 'elevenlabs'
                    ? 'bg-[#C6202F] border-[#AD1A27] text-white'
                    : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                }`}
              >
                ElevenLabs
              </button>
              <button
                type="button"
                onClick={() => handleSwitchProvider('clone')}
                className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  activeProvider === 'clone'
                    ? 'bg-[#C6202F] border-[#AD1A27] text-white'
                    : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                }`}
              >
                Cloned Voice
              </button>
            </div>

            {activeProvider === 'gemini' ? (
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                {GEMINI_TTS_MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    title={m.description}
                    onClick={() => updateVoSettings({ ttsModel: m.id })}
                    className={`px-2.5 py-2 rounded-lg border text-left cursor-pointer ${
                      voSettings.ttsModel === m.id
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#5A5A66]'
                    }`}
                  >
                    <div className="text-xs font-semibold">{m.label}</div>
                    <div className="text-[10px] text-[#6E6E7A] mt-0.5">{m.badge}</div>
                  </button>
                ))}
              </div>
            ) : activeProvider === 'elevenlabs' ? (
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                {ELEVENLABS_TTS_MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    title={m.description}
                    onClick={() => updateVoSettings({ ttsModel: m.id })}
                    className={`px-2.5 py-2 rounded-lg border text-left cursor-pointer ${
                      voSettings.ttsModel === m.id
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#5A5A66]'
                    }`}
                  >
                    <div className="text-xs font-semibold">{m.label}</div>
                    <div className="text-[10px] text-[#6E6E7A] mt-0.5">{m.badge}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-2.5 rounded-lg bg-[#FDF4F5] border border-[#EABAC0] text-[11px] text-[#6E141C] flex items-center justify-between gap-2">
                <span>
                  {activeCloneProfile
                    ? `Active Clone Engine: ${
                        activeCloneProfile.method === 'elevenlabs'
                          ? 'ElevenLabs Instant Clone'
                          : 'Zero-Shot Chatterbox Clone'
                      }`
                    : 'No cloned voices saved yet.'}
                </span>
                <button
                  type="button"
                  onClick={() => setVoiceCloneModalOpen(true)}
                  className="px-2 py-1 text-[10px] font-semibold bg-[#C6202F] text-white rounded cursor-pointer shrink-0"
                >
                  + New Clone
                </button>
              </div>
            )}
          </div>

          {/* Core Featured Voices Quick Picker + Full Voice Dropdown */}
          <div className="space-y-2.5 pt-1 border-t border-[#E2E2E6]">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-[#3A3A44]">
                {activeProvider === 'clone'
                  ? `Cast Cloned Voice (${clonedVoices.length} Saved)`
                  : activeProvider === 'elevenlabs'
                    ? `Cast Voice (${elevenLabsCatalog.length} ElevenLabs Voices)`
                    : 'Cast Voice (30 Gemini Studio Voices)'}
              </label>
              <button
                type="button"
                disabled={auditioningVoiceId !== null || !currentAuditionVoiceId}
                onClick={() =>
                  void handleAuditionVoice(
                    currentAuditionVoiceId,
                    selectedVoiceMeta.sampleSentence
                  )
                }
                className="inline-flex items-center gap-1 text-[#C6202F] hover:text-[#891A23] font-medium cursor-pointer disabled:opacity-40"
              >
                {auditioningVoiceId === currentAuditionVoiceId ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                Audition {selectedVoiceMeta.displayName}
              </button>
            </div>

            {activeProvider === 'clone' && clonedVoices.length === 0 ? (
              <button
                type="button"
                onClick={() => setVoiceCloneModalOpen(true)}
                className="w-full py-3 px-3 border border-dashed border-[#C6202F]/50 bg-[#FDF4F5] rounded-lg text-xs font-semibold text-[#891A23] hover:bg-[#F9E6E8] cursor-pointer"
              >
                + Upload Audio Sample or Record Mic to Clone a Voice
              </button>
            ) : (
              <>
                <select
                  value={
                    activeProvider === 'clone'
                      ? voSettings.clonedVoiceId || voSettings.voiceName
                      : voSettings.voiceName
                  }
                  onChange={(e) => {
                    if (activeProvider === 'clone') {
                      const picked = clonedVoices.find((c) => c.id === e.target.value);
                      updateVoSettings({
                        voiceName: e.target.value,
                        clonedVoiceId: e.target.value,
                        ttsModel:
                          picked?.method === 'chatterbox'
                            ? 'chatterbox_zero_shot'
                            : 'elevenlabs_ivc',
                      });
                    } else {
                      updateVoSettings({
                        voiceName: e.target.value,
                        elevenLabsVoiceId: '',
                      });
                    }
                  }}
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                >
                  {activeVoicePresets.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName} ({v.gender}) — {v.timbre}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  {coreVoicePresets.map((voice) => {
                    const selected =
                      activeProvider === 'clone'
                        ? (voSettings.clonedVoiceId || voSettings.voiceName) === voice.id
                        : voSettings.voiceName === voice.id &&
                          !voSettings.elevenLabsVoiceId?.trim();
                    return (
                      <button
                        key={voice.id}
                        type="button"
                        onClick={() => {
                          if (activeProvider === 'clone') {
                            const picked = clonedVoices.find((c) => c.id === voice.id);
                            updateVoSettings({
                              voiceName: voice.id,
                              clonedVoiceId: voice.id,
                              ttsModel:
                                picked?.method === 'chatterbox'
                                  ? 'chatterbox_zero_shot'
                                  : 'elevenlabs_ivc',
                            });
                          } else {
                            updateVoSettings({
                              voiceName: voice.id,
                              elevenLabsVoiceId: '',
                            });
                          }
                        }}
                        className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[#FDF2F3] border-[#C6202F] text-[#111114]'
                            : 'bg-[#F6F6F7] border-[#E2E2E6] hover:border-[#891A23] text-[#3A3A44]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold truncate">
                            {voice.displayName}
                          </span>
                          <span className="text-[10px] text-[#5A5A66] shrink-0">
                            {voice.gender}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#5A5A66] mt-0.5 truncate">
                          {voice.timbre}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {activeProvider === 'elevenlabs' && (
              <div className="pt-1">
                <label className="text-[11px] font-medium text-[#5A5A66] block mb-1">
                  Custom ElevenLabs Voice ID (Optional)
                </label>
                <input
                  type="text"
                  value={voSettings.elevenLabsVoiceId || ''}
                  onChange={(e) =>
                    updateVoSettings({ elevenLabsVoiceId: e.target.value })
                  }
                  placeholder="Paste custom / cloned ElevenLabs Voice ID..."
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
            )}

            <p className="text-[11px] text-[#5A5A66] leading-relaxed">
              <strong className="text-[#24242B]">{selectedVoiceMeta.displayName}:</strong>{' '}
              {selectedVoiceMeta.description} Best for {selectedVoiceMeta.bestFor}.
            </p>
          </div>

          {/* 10 Emotional Tone Presets */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#3A3A44] block">
              Emotional Performance Tone
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {EMOTIONAL_TONES.map((tone) => {
                const active = voSettings.emotionalTone === tone.id;
                return (
                  <button
                    key={tone.id}
                    type="button"
                    onClick={() => updateVoSettings({ emotionalTone: tone.id })}
                    className={`px-2.5 py-2 rounded-lg border text-left text-[11px] transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23] font-semibold'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] hover:border-[#891A23] text-[#3A3A44]'
                    }`}
                  >
                    {tone.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sliders: Emotion Intensity, Stability/Similarity (ElevenLabs), Speed, Pitch, Gap */}
          <div className="space-y-3.5 pt-1 border-t border-[#E2E2E6]">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#3A3A44]">Emotion Intensity</span>
                <span className="font-mono text-[#891A23] tabular-nums">
                  {Math.round(voSettings.emotionIntensity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={voSettings.emotionIntensity}
                onChange={(e) =>
                  updateVoSettings({ emotionIntensity: Number(e.target.value) })
                }
                className="w-full accent-[#C6202F] cursor-pointer"
              />
            </div>

            {(activeProvider === 'elevenlabs' ||
              (activeProvider === 'clone' && activeCloneProfile?.method === 'elevenlabs')) && (
              <>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#3A3A44]">Stability (ElevenLabs)</span>
                    <span className="font-mono text-[#891A23] tabular-nums">
                      {Math.round((voSettings.elevenLabsStability ?? 0.5) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={voSettings.elevenLabsStability ?? 0.5}
                    onChange={(e) =>
                      updateVoSettings({
                        elevenLabsStability: Number(e.target.value),
                      })
                    }
                    className="w-full accent-[#C6202F] cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#3A3A44]">Similarity Boost</span>
                    <span className="font-mono text-[#891A23] tabular-nums">
                      {Math.round((voSettings.elevenLabsSimilarityBoost ?? 0.75) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={voSettings.elevenLabsSimilarityBoost ?? 0.75}
                    onChange={(e) =>
                      updateVoSettings({
                        elevenLabsSimilarityBoost: Number(e.target.value),
                      })
                    }
                    className="w-full accent-[#C6202F] cursor-pointer"
                  />
                </div>
              </>
            )}

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#3A3A44]">Speaking Speed</span>
                <span className="font-mono text-[#891A23] tabular-nums">
                  {voSettings.speed.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.65}
                max={1.45}
                step={0.05}
                value={voSettings.speed}
                onChange={(e) => updateVoSettings({ speed: Number(e.target.value) })}
                className="w-full accent-[#C6202F] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#3A3A44]">Vocal Pitch</span>
                <span className="font-mono text-[#891A23] tabular-nums">
                  {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st
                </span>
              </div>
              <input
                type="range"
                min={-5}
                max={5}
                step={0.5}
                value={pitchSemitones}
                onChange={(e) =>
                  updateVoSettings({
                    pitch: semitonesToPitchRatio(Number(e.target.value)),
                  })
                }
                className="w-full accent-[#C6202F] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#3A3A44]">Gap Between Lines</span>
                <span className="font-mono text-[#891A23] tabular-nums">
                  {voSettings.pauseAfter.toFixed(2)}s
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={2.0}
                step={0.05}
                value={voSettings.pauseAfter}
                onChange={(e) =>
                  updateVoSettings({ pauseAfter: Number(e.target.value) })
                }
                className="w-full accent-[#C6202F] cursor-pointer"
              />
            </div>
          </div>

          {/* Language, Director Prompt, DSP Toggle, Single Voice Mode */}
          <div className="space-y-3 pt-2 border-t border-[#E2E2E6]">
            <div>
              <label className="text-xs font-medium text-[#3A3A44] block mb-1">
                Voice Accent / Language
              </label>
              <select
                value={voSettings.language}
                onChange={(e) => updateVoSettings({ language: e.target.value })}
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>

            {activeProvider === 'gemini' && (
              <div>
                <label className="text-xs font-medium text-[#3A3A44] block mb-1">
                  Director Acting Note (Optional)
                </label>
                <textarea
                  rows={2}
                  value={voSettings.customStylePrompt || ''}
                  onChange={(e) =>
                    updateVoSettings({ customStylePrompt: e.target.value })
                  }
                  placeholder="e.g. Close-mic documentary warmth, subtle smile on the product name..."
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
            )}

            <label className="flex items-center justify-between text-xs text-[#3A3A44] cursor-pointer py-1">
              <span>Studio DSP Polish (EQ &amp; Compression)</span>
              <input
                type="checkbox"
                checked={voSettings.enhanceWithDSP}
                onChange={(e) =>
                  updateVoSettings({ enhanceWithDSP: e.target.checked })
                }
                className="accent-[#C6202F] w-4 h-4 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between text-xs text-[#3A3A44] cursor-pointer py-1">
              <span>Single Cast Voice Across All Lines</span>
              <input
                type="checkbox"
                checked={voSettings.singleVoiceMode}
                onChange={(e) =>
                  updateVoSettings({ singleVoiceMode: e.target.checked })
                }
                className="accent-[#C6202F] w-4 h-4 cursor-pointer"
              />
            </label>

            {project.voScript.length > 0 && (
              <button
                type="button"
                onClick={handleApplySettingsToAllLines}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg transition-colors cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5 text-[#C6202F]" />
                Apply voice &amp; tone to all lines
              </button>
            )}
          </div>
        </aside>

        {/* RIGHT COLUMN: Master Waveform Timeline + Script Cue Cards */}
        <div className="space-y-5 min-w-0">
          {/* Interactive Waveform Timeline Player */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#111114]">
                  Master Voiceover Timeline
                </h2>
                <p className="text-xs text-[#5A5A66] mt-0.5">
                  {readyAudioLines.length} of {project.voScript.length} lines rendered · VO
                  runtime{' '}
                  <span className="font-mono text-[#24242B] tabular-nums">
                    {totalDuration.toFixed(1)}s
                  </span>{' '}
                  vs Target{' '}
                  <span className="font-mono text-[#24242B] tabular-nums">
                    {totalTargetSeconds}s
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!masterPlayBufferRef.current || isDecodingAudio}
                  onClick={handleTogglePlay}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
                >
                  {isDecodingAudio ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {isPlaying ? 'Pause' : 'Play Master VO'}
                </button>

                <button
                  type="button"
                  disabled={!isPlaying && currentTime === 0}
                  onClick={() => {
                    stopPlayback();
                    setCurrentTime(0);
                    playOffsetRef.current = 0;
                  }}
                  className="p-2 text-[#3A3A44] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] disabled:opacity-40 rounded-lg cursor-pointer"
                  aria-label="Stop playback"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  className="p-2 text-[#3A3A44] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? (
                    <VolumeX className="w-3.5 h-3.5 text-[#C6202F]" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    setIsMuted(false);
                    setVolume(Number(e.target.value));
                  }}
                  className="w-20 accent-[#C6202F] cursor-pointer"
                  aria-label="Master volume"
                />

                <span className="font-mono text-xs text-[#3A3A44] tabular-nums pl-1">
                  {currentTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
                </span>
              </div>
            </div>

            {/* Canvas Waveform (Click to seek) */}
            <div className="space-y-2">
              <canvas
                ref={canvasRef}
                width={900}
                height={76}
                onClick={(e) => {
                  if (!masterPlayBufferRef.current || totalDuration <= 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width)
                  );
                  startPlaybackFrom(ratio * totalDuration);
                }}
                className="w-full h-[76px] rounded-lg border border-[#E2E2E6] cursor-pointer block"
              />

              {/* Per-Cue Segment Strip */}
              {processedBuffers.length > 0 && totalDuration > 0 && (
                <div className="flex w-full h-6 rounded-md overflow-hidden border border-[#E2E2E6] bg-[#F6F6F7]">
                  {processedBuffers.map((seg, idx) => {
                    const widthPct = Math.max(
                      4,
                      ((seg.endSec - seg.startSec) / totalDuration) * 100
                    );
                    const color =
                      TIMELINE_SEGMENT_COLORS[idx % TIMELINE_SEGMENT_COLORS.length];
                    const isSegActive = activePlayingLineId === seg.line.id;
                    return (
                      <button
                        key={seg.line.id}
                        type="button"
                        style={{ width: `${widthPct}%`, borderBottomColor: color }}
                        onClick={() => startPlaybackFrom(seg.startSec)}
                        title={`${seg.line.shotId}: ${seg.line.line}`}
                        className={`px-1.5 text-[10px] font-mono truncate border-b-2 border-r border-[#E2E2E6] text-left cursor-pointer transition-colors ${
                          isSegActive
                            ? 'bg-[#FADEE1] text-[#6E141C] font-bold'
                            : 'bg-white text-[#3A3A44] hover:bg-[#EFEFF2]'
                        }`}
                      >
                        {seg.line.shotId}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Empty State */}
          {project.voScript.length === 0 ? (
            <div className="bg-white border border-dashed border-[#E2E2E6] rounded-xl p-10 text-center space-y-3">
              <Mic2 className="w-8 h-8 text-[#C6202F] mx-auto" />
              <h3 className="text-base font-semibold text-[#111114]">
                No Voiceover Script Written Yet
              </h3>
              <p className="text-xs text-[#5A5A66] max-w-md mx-auto leading-relaxed">
                Click <strong className="text-[#24242B]">Write VO script (Gemini)</strong>{' '}
                to draft a timed script from a prompt,{' '}
                <strong className="text-[#24242B]">Paste / Upload script</strong> to bring
                in your own copy, or add lines manually.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={isWritingScript}
                  onClick={() => setScriptModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Write VO script (Gemini)
                </button>
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-[#891A23]" />
                  Paste / Upload script
                </button>
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add line manually
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {project.voScript.map((line, index) => {
                const lineSec = Number(line.durationSec ?? 4);
                const targetWords = Math.max(3, Math.round(lineSec * 2.5));
                const actualWords = countWords(line.line);
                const isOverBudget = actualWords > targetWords + 2;
                const isGeneratingThis = generatingLineId === line.id;
                const isPlayingThis = activePlayingLineId === line.id;
                const lineProvider: VoiceProvider = line.provider || activeProvider;
                const lineVoiceCatalog =
                  lineProvider === 'clone'
                    ? cloneVoicePresets
                    : lineProvider === 'elevenlabs'
                      ? elevenLabsCatalog
                      : ALL_GEMINI_VOICE_PRESETS;

                return (
                  <div
                    key={line.id}
                    className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                      isPlayingThis ? 'border-[#C6202F]' : 'border-[#E2E2E6]'
                    }`}
                  >
                    <div className="px-4 py-2.5 bg-[#FBFBFC] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-[#6E6E7A] font-mono">
                          #{String(index + 1).padStart(2, '0')}
                        </span>

                        <input
                          aria-label="Cue label"
                          type="text"
                          value={line.shotId}
                          onChange={(e) =>
                            updateVoLine(line.id, { shotId: e.target.value })
                          }
                          className="w-16 bg-[#F6F6F7] border border-[#E2E2E6] rounded px-2 py-1 font-mono font-bold text-[#C6202F] text-xs focus:outline-none focus:border-[#C6202F]"
                        />

                        <div className="inline-flex items-center gap-1 bg-[#F6F6F7] border border-[#E2E2E6] rounded px-2 py-1 text-xs">
                          <input
                            aria-label="Target cue seconds"
                            type="number"
                            min={1}
                            max={60}
                            value={lineSec}
                            onChange={(e) => {
                              const nextSec = Math.max(
                                1,
                                Number(e.target.value) || 4
                              );
                              updateVoLine(line.id, {
                                durationSec: nextSec,
                                targetWords: Math.max(3, Math.round(nextSec * 2.5)),
                              });
                            }}
                            className="w-10 bg-transparent font-mono text-[#111114] focus:outline-none"
                          />
                          <span className="text-[#6E6E7A] font-mono">s</span>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[11px] tabular-nums ${
                            isOverBudget
                              ? 'bg-rose-50 text-[#891A23] border border-rose-300'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                          }`}
                        >
                          {actualWords} / ~{targetWords} words ({lineSec}s)
                        </span>

                        {line.audioUrl && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[11px] font-medium">
                            Audio ready
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {line.audioUrl && (
                          <button
                            type="button"
                            onClick={() => void handlePlaySingleLine(line)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#111114] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                          >
                            <Play className="w-3 h-3 text-[#C6202F]" />
                            Play
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isGeneratingThis || isGeneratingAll || !line.line.trim()}
                          onClick={() => void handleGenerateSingleLine(line)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
                        >
                          {isGeneratingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Mic2 className="w-3.5 h-3.5" />
                          )}
                          {isGeneratingThis
                            ? 'Rendering...'
                            : line.audioUrl
                              ? 'Regenerate audio'
                              : 'Generate audio'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveLine(line.id)}
                          className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] rounded-lg cursor-pointer"
                          aria-label="Delete VO line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Speaker
                          </label>
                          <input
                            type="text"
                            value={line.speaker}
                            onChange={(e) =>
                              updateVoLine(line.id, { speaker: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Delivery Direction (Plain English)
                          </label>
                          <input
                            type="text"
                            value={line.direction}
                            onChange={(e) =>
                              updateVoLine(line.id, { direction: e.target.value })
                            }
                            placeholder="e.g. warm, unhurried, quiet confidence"
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Line Emotion Tone
                          </label>
                          <select
                            value={line.emotionalTone || voSettings.emotionalTone}
                            onChange={(e) =>
                              updateVoLine(line.id, { emotionalTone: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                          >
                            {EMOTIONAL_TONES.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] text-[#5A5A66]">
                            Spoken Voiceover Line
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                updateVoLine(line.id, {
                                  line: `${line.line.trimEnd()}... `,
                                })
                              }
                              className="px-2 py-0.5 text-[10px] text-[#3A3A44] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded cursor-pointer"
                            >
                              + Breath pause (...)
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateVoLine(line.id, {
                                  line: `${line.line.trimEnd()} — `,
                                })
                              }
                              className="px-2 py-0.5 text-[10px] text-[#3A3A44] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded cursor-pointer"
                            >
                              + Emphasis beat (—)
                            </button>
                          </div>
                        </div>
                        <textarea
                          rows={2}
                          value={line.line}
                          onChange={(e) =>
                            updateVoLine(line.id, { line: e.target.value })
                          }
                          placeholder="Write spoken line timed to ~2.5 words/sec..."
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F] leading-relaxed"
                        />
                      </div>

                      {!voSettings.singleVoiceMode && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                          <div>
                            <label className="text-[11px] text-[#5A5A66] block mb-1">
                              Line Engine
                            </label>
                            <select
                              value={lineProvider}
                              onChange={(e) => {
                                const nextProv = e.target.value as VoiceProvider;
                                updateVoLine(line.id, {
                                  provider: nextProv,
                                  voiceName:
                                    nextProv === 'clone'
                                      ? clonedVoices[0]?.id || ''
                                      : nextProv === 'elevenlabs'
                                        ? CORE_ELEVENLABS_VOICES[0].id
                                        : CORE_GEMINI_VOICES[0].id,
                                  ttsModel:
                                    nextProv === 'clone'
                                      ? clonedVoices[0]?.method === 'chatterbox'
                                        ? 'chatterbox_zero_shot'
                                        : 'elevenlabs_ivc'
                                      : nextProv === 'elevenlabs'
                                        ? 'eleven_v3'
                                        : 'gemini-3.8-flash-lite-tts',
                                });
                              }}
                              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                            >
                              <option value="gemini">Gemini 3.8 TTS</option>
                              <option value="elevenlabs">ElevenLabs</option>
                              <option value="clone">Cloned Voice ({clonedVoices.length})</option>
                            </select>
                          </div>

                          <div>
                            <label className="text-[11px] text-[#5A5A66] block mb-1">
                              Line Cast Voice
                            </label>
                            <select
                              value={line.voiceName || lineVoiceCatalog[0]?.id || ''}
                              onChange={(e) =>
                                updateVoLine(line.id, { voiceName: e.target.value })
                              }
                              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                            >
                              {lineVoiceCatalog.length === 0 ? (
                                <option value="">No cloned voice yet</option>
                              ) : (
                                lineVoiceCatalog.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.displayName} ({v.gender})
                                  </option>
                                ))
                              )}
                            </select>
                          </div>

                          <div>
                            <label className="text-[11px] text-[#5A5A66] block mb-1">
                              Pause After Line (seconds)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={3}
                              step={0.05}
                              value={line.pauseAfter ?? voSettings.pauseAfter}
                              onChange={(e) =>
                                updateVoLine(line.id, {
                                  pauseAfter: Number(e.target.value) || 0,
                                })
                              }
                              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={handleAddLine}
                className="w-full py-2.5 border border-dashed border-[#E2E2E6] hover:border-[#C6202F]/60 rounded-xl text-xs font-medium text-[#3A3A44] hover:text-[#891A23] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add VO line
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Write VO Script (Gemini) Modal */}
      {scriptModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleRunGenerateScript(e)}
            className="bg-white border border-[#E2E2E6] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#C6202F]" />
                <h3 className="text-base font-bold text-[#111114]">
                  Write Voiceover Script (Gemini)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setScriptModalOpen(false)}
                className="text-xs text-[#5A5A66] hover:text-[#24242B] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[#3A3A44] font-medium block mb-1">
                    Brand / Script Title
                  </label>
                  <input
                    type="text"
                    value={briefBrand}
                    onChange={(e) => setBriefBrand(e.target.value)}
                    placeholder="e.g. Kinetix Core Patch"
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
                <div>
                  <label className="text-[#3A3A44] font-medium block mb-1">
                    Primary Speaker
                  </label>
                  <input
                    type="text"
                    value={briefSpeaker}
                    onChange={(e) => setBriefSpeaker(e.target.value)}
                    placeholder="e.g. Narrator, Founder"
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[#3A3A44] font-medium block mb-1">
                  Script Topic / Creative Prompt
                </label>
                <textarea
                  rows={3}
                  value={briefPrompt}
                  onChange={(e) => setBriefPrompt(e.target.value)}
                  placeholder="Describe what the spot is about, key points to mention, product benefits, and call to action..."
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[#3A3A44] font-medium block mb-1">
                    Target Runtime (s)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={briefDurationSec}
                    onChange={(e) =>
                      setBriefDurationSec(Math.max(5, Number(e.target.value) || 30))
                    }
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
                <div>
                  <label className="text-[#3A3A44] font-medium block mb-1">
                    Number of Cues
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={briefLineCount}
                    onChange={(e) =>
                      setBriefLineCount(Math.max(1, Number(e.target.value) || 5))
                    }
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[#3A3A44] font-medium block mb-1">
                    Target Audience
                  </label>
                  <input
                    type="text"
                    value={briefAudience}
                    onChange={(e) => setBriefAudience(e.target.value)}
                    placeholder="e.g. Runners, founders"
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[#3A3A44] font-medium block mb-1">
                  Tone &amp; Delivery Style
                </label>
                <input
                  type="text"
                  value={briefToneNote}
                  onChange={(e) => setBriefToneNote(e.target.value)}
                  placeholder="e.g. Disciplined, grounded, conversational warmth"
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E2E6]">
              <button
                type="button"
                onClick={() => setScriptModalOpen(false)}
                className="px-3.5 py-2 text-xs text-[#3A3A44] hover:text-[#111114] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isWritingScript}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
              >
                {isWritingScript ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {isWritingScript ? 'Writing Script...' : 'Generate Script'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Paste / Upload Script Modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleRunImportScript(e)}
            className="bg-white border border-[#E2E2E6] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#C6202F]" />
                <h3 className="text-base font-bold text-[#111114]">
                  Paste or Upload Script
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="text-xs text-[#5A5A66] hover:text-[#24242B] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#5A5A66]">
                  Paste plain lines, paragraphs, <code>Speaker: Line</code>, or upload a file.
                </span>
                <input
                  ref={scriptFileInputRef}
                  type="file"
                  accept=".txt,.md,.srt,.vtt,.csv,.json,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleScriptFileSelect(file);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => scriptFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#111114] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#C6202F]" />
                  {importFilename ? `Loaded: ${importFilename}` : 'Upload .txt / .srt / .pdf'}
                </button>
              </div>

              {importPdfBase64 ? (
                <div className="p-3 rounded-lg bg-[#FAF6F7] border border-[#E2C2C6] text-xs text-[#6E141C] flex items-center justify-between">
                  <span>PDF ready to extract: <strong>{importFilename}</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      setImportPdfBase64(null);
                      setImportFilename(null);
                    }}
                    className="underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <textarea
                  rows={7}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`Example:\nNarrator: Every breakthrough begins twenty minutes before anyone else notices.\n\n(warmly) Built for quiet precision when every second counts.`}
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F] leading-relaxed"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[#3A3A44] font-medium block mb-1">
                    Default Speaker
                  </label>
                  <input
                    type="text"
                    value={importSpeaker}
                    onChange={(e) => setImportSpeaker(e.target.value)}
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
                <div>
                  <label className="text-[#3A3A44] font-medium block mb-1">
                    Import Mode
                  </label>
                  <select
                    value={importReplaceExisting ? 'replace' : 'append'}
                    onChange={(e) =>
                      setImportReplaceExisting(e.target.value === 'replace')
                    }
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  >
                    <option value="replace">Replace current script</option>
                    <option value="append">Append to current script</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center justify-between text-[#3A3A44] cursor-pointer pt-1">
                <span>Auto-direct cues &amp; tone with Gemini (preserves wording)</span>
                <input
                  type="checkbox"
                  checked={importAiEnhance}
                  onChange={(e) => setImportAiEnhance(e.target.checked)}
                  className="accent-[#C6202F] w-4 h-4 cursor-pointer"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E2E6]">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="px-3.5 py-2 text-xs text-[#3A3A44] hover:text-[#111114] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isImportingScript || (!importText.trim() && !importPdfBase64)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
              >
                {isImportingScript ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {isImportingScript ? 'Importing...' : 'Load Script into Studio'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Export Audio Modal */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E2E6] rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111114]">
                Export Voiceover Audio
              </h3>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="text-xs text-[#5A5A66] hover:text-[#24242B] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-[#3A3A44] font-medium block mb-1.5">
                  Deliverable Package
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExportMode('master')}
                    className={`p-3 rounded-lg border text-left cursor-pointer ${
                      exportMode === 'master'
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44]'
                    }`}
                  >
                    <div className="font-semibold">Single Master Track</div>
                    <div className="text-[11px] text-[#5A5A66] mt-0.5">
                      Combined with timed pauses
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportMode('stems')}
                    className={`p-3 rounded-lg border text-left cursor-pointer ${
                      exportMode === 'stems'
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44]'
                    }`}
                  >
                    <div className="font-semibold">Individual Stems (.ZIP)</div>
                    <div className="text-[11px] text-[#5A5A66] mt-0.5">
                      One file per cue + tracklist
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[#3A3A44] font-medium block mb-1.5">
                  Audio Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExportFormat('wav')}
                    className={`py-2 px-3 rounded-lg border font-medium cursor-pointer ${
                      exportFormat === 'wav'
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44]'
                    }`}
                  >
                    WAV (Uncompressed)
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportFormat('mp3')}
                    className={`py-2 px-3 rounded-lg border font-medium cursor-pointer ${
                      exportFormat === 'mp3'
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44]'
                    }`}
                  >
                    MP3 (Compressed)
                  </button>
                </div>
              </div>

              {exportFormat === 'mp3' && (
                <div>
                  <label className="text-[#3A3A44] font-medium block mb-1.5">
                    MP3 Bitrate
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {([128, 192, 320] as const).map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setExportBitrate(rate)}
                        className={`py-1.5 rounded-lg border font-mono cursor-pointer ${
                          exportBitrate === rate
                            ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                            : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44]'
                        }`}
                      >
                        {rate} kbps
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center justify-between text-[#3A3A44] cursor-pointer pt-1">
                <span>Broadcast Peak Normalization (-1 dB)</span>
                <input
                  type="checkbox"
                  checked={exportNormalize}
                  onChange={(e) => setExportNormalize(e.target.checked)}
                  className="accent-[#C6202F] w-4 h-4 cursor-pointer"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E2E6]">
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="px-3.5 py-2 text-xs text-[#3A3A44] hover:text-[#111114] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void handleRunExport()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Download {exportMode === 'stems' ? 'ZIP' : exportFormat.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Cloning Studio Modal */}
      <VoiceCloneModal
        isOpen={voiceCloneModalOpen}
        onClose={() => setVoiceCloneModalOpen(false)}
        existingClones={clonedVoices}
        elevenLabsConfigured={elevenLabsConfigured}
        falConfigured={falConfigured}
        onCreateClone={async (payload) => {
          const res = await createClonedVoiceApi(payload);
          setClonedVoices(res.clones);
          return res.clone;
        }}
        onDeleteClone={async (id) => {
          const next = await deleteClonedVoiceApi(id);
          setClonedVoices(next);
        }}
        onSelectClone={(clone) => {
          updateVoSettings({
            provider: 'clone',
            voiceName: clone.id,
            clonedVoiceId: clone.id,
            ttsModel:
              clone.method === 'chatterbox'
                ? 'chatterbox_zero_shot'
                : 'elevenlabs_ivc',
          });
          setStatusNote(`Activated cloned voice "${clone.name}".`);
        }}
      />
    </div>
  );
};
