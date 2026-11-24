import React, { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Download,
  Loader2,
  Music,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  EmotionalBeat,
  MusicEngineId,
  MusicStageData,
  PipelineProject,
  UploadedVideoMeta,
} from '../../types/pipeline';
import {
  DEFAULT_MUSIC_STAGE,
  EMOTIONAL_BEAT_PRESETS,
  INSTRUMENTATION_PALETTE,
  MUSIC_ENGINES,
  MUSIC_GENRE_PRESETS,
  MUSIC_KEYS,
} from '../../utils/voPresets';
import { uploadVideoAssetForStage } from '../../utils/videoUtils';
import { exportAudioUrlAsFormat } from '../../utils/voAudioEngine';
import { parseJsonResponse } from '../../utils/safeFetch';
import {
  SyncedTimelineCueItem,
  SyncedVideoCuePlayer,
} from './SyncedVideoCuePlayer';

interface Stage4MusicStudioProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onProjectUpdated: (updated: PipelineProject) => void;
  reusableVideos: Array<{ stageLabel: string; video: UploadedVideoMeta }>;
  falConfigured?: boolean;
  elevenLabsConfigured?: boolean;
}

const BEAT_COLORS = [
  '#891A23',
  '#C6202F',
  '#D97706',
  '#059669',
  '#2563EB',
  '#7C3AED',
];

export const Stage4MusicStudio: React.FC<Stage4MusicStudioProps> = ({
  project,
  onUpdateProject,
  onProjectUpdated,
  reusableVideos,
  falConfigured = true,
  elevenLabsConfigured = true,
}) => {
  const music: MusicStageData = useMemo(
    () => ({
      ...DEFAULT_MUSIC_STAGE,
      ...(project.music || {}),
    }),
    [project.music]
  );

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isExportingFormat, setIsExportingFormat] = useState<'wav' | 'mp3' | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{
    timeSec: number;
    nonce: number;
  } | null>(null);

  const saveMusicPatch = (patch: Partial<MusicStageData>) => {
    void onUpdateProject({
      ...project,
      music: {
        ...music,
        ...patch,
      },
    });
  };

  const handleUploadVideo = async (file: File) => {
    setUploadError(null);
    setErrorMsg(null);
    setIsUploadingVideo(true);
    try {
      const meta = await uploadVideoAssetForStage(project.id, file, 'music-vid');
      await onUpdateProject({
        ...project,
        music: {
          ...music,
          video: meta,
        },
      });
      setStatusNote(
        `Loaded "${meta.filename}" (${meta.durationSec.toFixed(1)}s). Click "Analyze Video Emotional Arc" or customize beats directly.`
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Video upload failed.');
    } finally {
      setIsUploadingVideo(false);
    }
  };

  const handleReuseVideo = (video: UploadedVideoMeta) => {
    setErrorMsg(null);
    void onUpdateProject({
      ...project,
      music: {
        ...music,
        video,
      },
    });
    setStatusNote(`Attached "${video.filename}" to Music Composition Studio.`);
  };

  const handleAnalyzeVideoArc = async () => {
    if (!music.video) {
      setErrorMsg('Drop or select a video first to auto-map its emotional arc.');
      return;
    }
    setErrorMsg(null);
    setStatusNote(null);
    setIsAnalyzing(true);
    try {
      const resp = await fetch('/api/pipeline/music-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          customDirection: music.customDirection,
          preferredGenre: music.genre,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
        resp,
        'Could not analyze video emotional arc.'
      );
      if (!resp.ok) throw new Error(data.error || 'Could not analyze video emotional arc.');
      onProjectUpdated(data.project);
      const count = data.project.music?.beats.length || 0;
      setStatusNote(
        `Mapped ${count} emotional beats, tempo (${data.project.music?.bpm} BPM), and key (${data.project.music?.musicalKey}) from your video.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Emotional arc analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleComposeScore = async () => {
    if (music.beats.length === 0) {
      setErrorMsg('Add at least one emotional beat before composing.');
      return;
    }
    setErrorMsg(null);
    const activeMeta = MUSIC_ENGINES.find((m) => m.id === music.engine);
    setStatusNote(
      `Composing multi-section score with ${activeMeta?.label || music.engine} (15-45s)...`
    );
    setIsComposing(true);
    try {
      const resp = await fetch('/api/pipeline/music-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          engine: music.engine,
          genre: music.genre,
          bpm: music.bpm,
          musicalKey: music.musicalKey,
          forceInstrumental: music.forceInstrumental,
          instrumentationPalette: music.instrumentationPalette,
          negativeStyles: music.negativeStyles,
          customDirection: music.customDirection,
          beats: music.beats,
        }),
      });
      const data = await parseJsonResponse<{
        project: PipelineProject;
        masterAudioUrl: string;
        error?: string;
      }>(resp, 'Could not compose music score.');
      if (!resp.ok) throw new Error(data.error || 'Could not compose music score.');
      onProjectUpdated(data.project);
      setStatusNote('Master score composed and synced to your video monitor.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Music composition failed.');
    } finally {
      setIsComposing(false);
    }
  };

  const handleAddBeat = () => {
    const lastBeat = music.beats[music.beats.length - 1];
    const startSec = lastBeat
      ? Number(lastBeat.startTimeSec) + Number(lastBeat.durationSec)
      : 0;
    const newBeat: EmotionalBeat = {
      id: `beat-${Date.now()}`,
      label: `Beat ${music.beats.length + 1}`,
      startTimeSec: startSec,
      durationSec: 6,
      emotion: 'Euphoric & Uplifting',
      energy: 7,
      instrumentation: music.instrumentationPalette.slice(0, 3).join(', ') || 'Strings, Warm Synth Pad',
      tempoFeel: 'Steady cinematic groove',
    };
    saveMusicPatch({ beats: [...music.beats, newBeat] });
  };

  const handleAutoSpaceContiguous = () => {
    let cursor = 0;
    const spaced = music.beats.map((b) => {
      const dur = Math.max(3, Math.round(b.durationSec || 5));
      const updated = { ...b, startTimeSec: cursor, durationSec: dur };
      cursor += dur;
      return updated;
    });
    saveMusicPatch({ beats: spaced });
    setStatusNote('Aligned emotional beats contiguously with zero overlaps.');
  };

  const updateBeat = (beatId: string, patch: Partial<EmotionalBeat>) => {
    saveMusicPatch({
      beats: music.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b)),
    });
  };

  const removeBeat = (beatId: string) => {
    saveMusicPatch({
      beats: music.beats.filter((b) => b.id !== beatId),
    });
  };

  const toggleInstrument = (inst: string) => {
    const exists = music.instrumentationPalette.includes(inst);
    const next = exists
      ? music.instrumentationPalette.filter((x) => x !== inst)
      : [...music.instrumentationPalette, inst];
    saveMusicPatch({ instrumentationPalette: next });
  };

  const handleDownloadScore = async (format: 'wav' | 'mp3') => {
    if (!music.masterAudioUrl) return;
    setIsExportingFormat(format);
    setErrorMsg(null);
    try {
      const slug =
        `${project.client}-${project.product.name}-score`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-') || 'score';
      await exportAudioUrlAsFormat({
        audioUrl: music.masterAudioUrl,
        filenameBase: slug,
        format,
        bitrate: 320,
        normalize: true,
      });
      setStatusNote(`Downloaded master score as ${format.toUpperCase()}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Score download failed.');
    } finally {
      setIsExportingFormat(null);
    }
  };

  const totalScoreDurationSec = useMemo(() => {
    const beatsEnd = music.beats.reduce(
      (max, b) => Math.max(max, (Number(b.startTimeSec) || 0) + (Number(b.durationSec) || 0)),
      0
    );
    return Math.max(music.video?.durationSec || 0, beatsEnd, 15);
  }, [music.beats, music.video?.durationSec]);

  const timelineItems: SyncedTimelineCueItem[] = useMemo(
    () =>
      music.beats.map((b, idx) => ({
        id: b.id,
        label: `${b.label} (${b.energy}/10)`,
        title: `${b.emotion} — ${b.instrumentation}`,
        startTimeSec: b.startTimeSec,
        durationSec: b.durationSec,
        audioUrl: music.masterAudioUrl ? '__beat_marker__' : undefined,
        color: BEAT_COLORS[idx % BEAT_COLORS.length],
      })),
    [music.beats, music.masterAudioUrl]
  );

  // Build SVG points for the Emotional Energy Curve
  const energyCurveSvg = useMemo(() => {
    const width = 600;
    const height = 100;
    if (music.beats.length === 0) {
      return { width, height, linePoints: '', areaPoints: '', nodes: [] as Array<{ id: string; x: number; y: number; label: string; energy: number; startTimeSec: number }> };
    }
    const nodes = music.beats.map((b) => {
      const centerT = b.startTimeSec + b.durationSec * 0.5;
      const x = Math.max(12, Math.min(width - 12, (centerT / totalScoreDurationSec) * width));
      const y = height - 14 - ((Math.max(1, Math.min(10, b.energy)) - 1) / 9) * (height - 28);
      return {
        id: b.id,
        x,
        y,
        label: b.label,
        energy: b.energy,
        startTimeSec: b.startTimeSec,
      };
    });
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const linePoints = [
      `0,${first.y}`,
      ...nodes.map((n) => `${n.x.toFixed(1)},${n.y.toFixed(1)}`),
      `${width},${last.y}`,
    ].join(' ');
    const areaPoints = `0,${height} ${linePoints} ${width},${height}`;
    return { width, height, linePoints, areaPoints, nodes };
  }, [music.beats, totalScoreDurationSec]);

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
        <div>
          <div className="text-xs font-medium text-[#C6202F]">
            Stage 4 · Music Orchestration &amp; Emotional Scoring
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Narrative Score &amp; Emotional Beats Composer
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Drop a video to analyze narrative pacing and mood shifts — then sculpt custom emotional beats, energy arcs, BPM, key, and orchestration before composing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!music.video || isAnalyzing}
            onClick={() => void handleAnalyzeVideoArc()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
          >
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#C6202F]" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#C6202F]" />
            )}
            {isAnalyzing ? 'Mapping Arc...' : 'Analyze Video Emotional Arc'}
          </button>

          <button
            type="button"
            disabled={isComposing || music.beats.length === 0}
            onClick={() => void handleComposeScore()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
          >
            {isComposing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Music className="w-3.5 h-3.5" />
            )}
            {isComposing ? 'Composing Score...' : 'Compose Master Score'}
          </button>

          {music.masterAudioUrl && (
            <>
              <button
                type="button"
                disabled={isExportingFormat !== null}
                onClick={() => void handleDownloadScore('wav')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
              >
                {isExportingFormat === 'wav' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                WAV
              </button>
              <button
                type="button"
                disabled={isExportingFormat !== null}
                onClick={() => void handleDownloadScore('mp3')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
              >
                {isExportingFormat === 'mp3' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                MP3
              </button>
            </>
          )}
        </div>
      </div>

      {!elevenLabsConfigured && !falConfigured && (
        <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900">
          Add <strong>ELEVENLABS_API_KEY</strong> or <strong>FAL_KEY</strong> in Settings &gt; Secrets to compose music tracks.
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

      <div className="grid grid-cols-1 xl:grid-cols-[440px_1fr] gap-6 items-start">
        {/* LEFT COLUMN: Video + Global Orchestration Settings + Takes */}
        <div className="space-y-4">
          <SyncedVideoCuePlayer
            video={music.video}
            cues={timelineItems}
            masterTrackUrl={music.masterAudioUrl}
            isUploadingVideo={isUploadingVideo}
            uploadError={uploadError}
            stageLabel="Music Score"
            dropzoneHint="Drop a video to extract scene shifts and emotional arc, or compose directly from custom beats below."
            reusableVideos={reusableVideos}
            onUploadFile={(file) => void handleUploadVideo(file)}
            onReuseVideo={handleReuseVideo}
            onTimeUpdate={setPlayheadSec}
            seekRequestSec={seekRequest}
          />

          {/* Global Orchestration Controls */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-[#C6202F]" />
                <h2 className="text-sm font-bold text-[#111114]">
                  Orchestration &amp; Engine
                </h2>
              </div>
              <span className="text-[11px] font-mono text-[#891A23]">
                {totalScoreDurationSec.toFixed(0)}s runtime
              </span>
            </div>

            {/* Composition Engine Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MUSIC_ENGINES.map((eng) => {
                const selected = music.engine === eng.id;
                return (
                  <button
                    key={eng.id}
                    type="button"
                    onClick={() =>
                      saveMusicPatch({ engine: eng.id as MusicEngineId })
                    }
                    className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold">{eng.label}</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#111114] text-white">
                        {eng.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#5A5A66] mt-1 leading-snug">
                      {eng.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {music.engine === 'sonilo_music' && (
              <div className="p-2.5 rounded-lg bg-[#FAFBFD] border border-[#E2E2E6] text-[11px] text-[#3A3A44]">
                {music.video
                  ? 'Video attached: Sonilo v1.1 will compose picture-locked music directly from your video frames.'
                  : 'Tip: Upload a video above so Sonilo v1.1 can compose picture-locked music directly to footage (uses Text-to-Music otherwise).'}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-[#5A5A66] block mb-1">
                  Musical Genre / Aesthetic
                </label>
                <div className="flex gap-2">
                  <select
                    value={
                      MUSIC_GENRE_PRESETS.includes(music.genre)
                        ? music.genre
                        : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) saveMusicPatch({ genre: e.target.value });
                    }}
                    className="w-1/2 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                  >
                    <option value="">Presets...</option>
                    {MUSIC_GENRE_PRESETS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={music.genre}
                    onChange={(e) => saveMusicPatch({ genre: e.target.value })}
                    className="w-1/2 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[11px] font-medium text-[#5A5A66]">
                    Tempo (BPM)
                  </span>
                  <span className="font-mono text-[#891A23] font-bold">
                    {music.bpm} BPM
                  </span>
                </div>
                <input
                  type="range"
                  min={55}
                  max={180}
                  step={1}
                  value={music.bpm}
                  onChange={(e) =>
                    saveMusicPatch({ bpm: Number(e.target.value) || 112 })
                  }
                  className="w-full accent-[#C6202F] cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#5A5A66] block mb-1">
                  Musical Key
                </label>
                <select
                  value={music.musicalKey}
                  onChange={(e) => saveMusicPatch({ musicalKey: e.target.value })}
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                >
                  {MUSIC_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Instrumentation Palette Chips */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[#5A5A66] block">
                Core Instrumentation Palette ({music.instrumentationPalette.length})
              </label>
              <div className="flex flex-wrap gap-1.5">
                {INSTRUMENTATION_PALETTE.map((inst) => {
                  const active = music.instrumentationPalette.includes(inst);
                  return (
                    <button
                      key={inst}
                      type="button"
                      onClick={() => toggleInstrument(inst)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#C6202F] border-[#AD1A27] text-white font-medium'
                          : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                      }`}
                    >
                      {active && <Check className="w-3 h-3" />}
                      {inst}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5 text-xs pt-1 border-t border-[#E2E2E6]">
              <label className="flex items-center justify-between text-[#3A3A44] cursor-pointer">
                <span className="font-medium">Purely Instrumental Score (No Vocals)</span>
                <input
                  type="checkbox"
                  checked={music.forceInstrumental}
                  onChange={(e) =>
                    saveMusicPatch({ forceInstrumental: e.target.checked })
                  }
                  className="accent-[#C6202F] w-4 h-4 cursor-pointer"
                />
              </label>

              <div>
                <label className="text-[11px] font-medium text-[#5A5A66] block mb-1">
                  Composer Notes / Narrative Context
                </label>
                <textarea
                  rows={2}
                  value={music.customDirection}
                  onChange={(e) =>
                    saveMusicPatch({ customDirection: e.target.value })
                  }
                  placeholder="e.g. Leave midrange clarity for voiceover, crescendo into the final logo sting..."
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#5A5A66] block mb-1">
                  Negative Styles (Exclude)
                </label>
                <input
                  type="text"
                  value={music.negativeStyles}
                  onChange={(e) =>
                    saveMusicPatch({ negativeStyles: e.target.value })
                  }
                  placeholder="e.g. heavy metal distortion, cheesy 80s saxophone, harsh vocals"
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            {music.analysisSummary && (
              <div className="p-3 rounded-lg bg-[#FAFBFD] border border-[#E2E2E6] text-xs text-[#3A3A44] leading-relaxed">
                <span className="font-bold text-[#111114]">AI Scoring Brief: </span>
                {music.analysisSummary}
              </div>
            )}
          </div>

          {/* Score Takes History */}
          {music.takes.length > 0 && (
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-2.5">
              <div className="text-xs font-bold text-[#111114]">
                Composed Score Takes ({music.takes.length})
              </div>
              <div className="space-y-2">
                {music.takes.map((take, idx) => {
                  const isActive = music.masterAudioUrl === take.audioUrl;
                  return (
                    <div
                      key={take.id}
                      className={`p-2.5 rounded-lg border text-xs space-y-2 ${
                        isActive
                          ? 'bg-[#FDF4F5] border-[#C6202F]'
                          : 'bg-[#FAFBFD] border-[#E2E2E6]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#111114] truncate">
                            Take #{music.takes.length - idx} · {take.promptSummary}
                          </div>
                          <div className="text-[10px] font-mono text-[#6E6E7A]">
                            {take.engine} · {take.durationSec.toFixed(1)}s
                          </div>
                        </div>
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() =>
                              saveMusicPatch({ masterAudioUrl: take.audioUrl })
                            }
                            className="px-2.5 py-1 text-[11px] font-semibold bg-[#111114] text-white rounded cursor-pointer shrink-0"
                          >
                            Load to Sync
                          </button>
                        )}
                      </div>
                      <audio src={take.audioUrl} controls className="w-full h-8" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Emotional Energy Arc Curve + Customizable Beats Editor */}
        <div className="space-y-4">
          {/* Interactive Energy Curve Visualizer */}
          <div className="bg-[#111114] text-white border border-[#24242B] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#C6202F]" />
                <span className="text-xs font-bold">
                  Emotional Energy Arc ({music.beats.length} Beats)
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#9C9CA8]">
                Click any node to preview that scene timestamp
              </span>
            </div>

            <div className="w-full overflow-hidden rounded-lg bg-[#0A0A0D] border border-[#26262F] p-2">
              <svg
                viewBox={`0 0 ${energyCurveSvg.width} ${energyCurveSvg.height}`}
                className="w-full h-28 overflow-visible"
              >
                <defs>
                  <linearGradient id="scoreArcFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C6202F" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#C6202F" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {/* Horizontal intensity reference lines */}
                {[25, 50, 75].map((yPos) => (
                  <line
                    key={yPos}
                    x1={0}
                    y1={yPos}
                    x2={energyCurveSvg.width}
                    y2={yPos}
                    stroke="#22222B"
                    strokeDasharray="3 4"
                  />
                ))}
                {energyCurveSvg.areaPoints && (
                  <polygon points={energyCurveSvg.areaPoints} fill="url(#scoreArcFill)" />
                )}
                {energyCurveSvg.linePoints && (
                  <polyline
                    points={energyCurveSvg.linePoints}
                    fill="none"
                    stroke="#C6202F"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                )}
                {/* Playhead line */}
                <line
                  x1={(playheadSec / totalScoreDurationSec) * energyCurveSvg.width}
                  y1={0}
                  x2={(playheadSec / totalScoreDurationSec) * energyCurveSvg.width}
                  y2={energyCurveSvg.height}
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                  strokeOpacity="0.8"
                />
                {energyCurveSvg.nodes.map((node, idx) => (
                  <g
                    key={node.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setSeekRequest({
                        timeSec: node.startTimeSec,
                        nonce: Date.now(),
                      })
                    }
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={5.5}
                      fill={BEAT_COLORS[idx % BEAT_COLORS.length]}
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />
                    <text
                      x={node.x}
                      y={node.y - 9}
                      textAnchor="middle"
                      fill="#E5E5EF"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {node.label.slice(0, 12)} ({node.energy})
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          {/* Emotional Beats Header + Helpers */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#111114]">
                Customizable Emotional Beats
              </h2>
              <p className="text-xs text-[#5A5A66]">
                Sculpt how the composition shifts in emotion, dynamic energy (1–10), instrumentation, and feel across each section.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {music.beats.length > 1 && (
                <button
                  type="button"
                  onClick={handleAutoSpaceContiguous}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#3A3A44] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                >
                  <Wand2 className="w-3 h-3 text-[#891A23]" />
                  Align Contiguous
                </button>
              )}
              <button
                type="button"
                onClick={handleAddBeat}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#111114] hover:bg-[#24242B] rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#C6202F]" />
                Add Emotional Beat
              </button>
            </div>
          </div>

          {/* Beat Cards */}
          <div className="space-y-3">
            {music.beats.map((beat, idx) => (
              <div
                key={beat.id}
                className="bg-white border border-[#E2E2E6] rounded-xl overflow-hidden"
              >
                <div className="px-4 py-2.5 bg-[#FBFBFC] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      style={{
                        backgroundColor: BEAT_COLORS[idx % BEAT_COLORS.length],
                      }}
                      className="px-2 py-0.5 rounded font-mono font-bold text-white text-[11px]"
                    >
                      B{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={beat.label}
                      onChange={(e) =>
                        updateBeat(beat.id, { label: e.target.value })
                      }
                      className="bg-[#F6F6F7] border border-[#E2E2E6] rounded px-2.5 py-1 font-bold text-[#111114] text-xs w-40"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setSeekRequest({
                          timeSec: beat.startTimeSec,
                          nonce: Date.now(),
                        })
                      }
                      className="px-2 py-0.5 rounded bg-[#111114] text-white font-mono text-[11px] hover:bg-[#C6202F] cursor-pointer transition-colors"
                    >
                      {beat.startTimeSec}s – {beat.startTimeSec + beat.durationSec}s
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-[#FDF4F5] border border-[#EABAC0] text-[#891A23] font-mono text-[11px] font-bold">
                      Energy {beat.energy}/10
                    </span>
                    {music.beats.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBeat(beat.id)}
                        className="p-1 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                        title="Remove emotional beat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] text-[#5A5A66] block mb-1">
                        Start (s)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={beat.startTimeSec}
                        onChange={(e) =>
                          updateBeat(beat.id, {
                            startTimeSec: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#5A5A66] block mb-1">
                        Duration (min 3s)
                      </label>
                      <input
                        type="number"
                        min={3}
                        max={120}
                        value={beat.durationSec}
                        onChange={(e) =>
                          updateBeat(beat.id, {
                            durationSec: Math.max(3, Number(e.target.value) || 3),
                          })
                        }
                        className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[11px] text-[#5A5A66] block mb-1">
                        Emotional Character
                      </label>
                      <select
                        value={beat.emotion}
                        onChange={(e) =>
                          updateBeat(beat.id, { emotion: e.target.value })
                        }
                        className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5"
                      >
                        {EMOTIONAL_BEAT_PRESETS.map((em) => (
                          <option key={em} value={em}>
                            {em}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[11px] text-[#5A5A66]">
                        Emotional Energy / Dynamic Density
                      </span>
                      <span className="font-mono text-[#891A23] font-semibold">
                        {beat.energy} / 10
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={beat.energy}
                      onChange={(e) =>
                        updateBeat(beat.id, { energy: Number(e.target.value) })
                      }
                      className="w-full accent-[#C6202F] cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-[#5A5A66] block mb-1">
                        Section Instrumentation &amp; Arrangement
                      </label>
                      <input
                        type="text"
                        value={beat.instrumentation}
                        onChange={(e) =>
                          updateBeat(beat.id, { instrumentation: e.target.value })
                        }
                        placeholder="e.g. Solo felt piano, soft sub bass, legato cello swell"
                        className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#5A5A66] block mb-1">
                        Rhythmic Feel / Pacing
                      </label>
                      <input
                        type="text"
                        value={beat.tempoFeel || ''}
                        onChange={(e) =>
                          updateBeat(beat.id, { tempoFeel: e.target.value })
                        }
                        placeholder="e.g. Sparse half-time, driving 16th-note pulse"
                        className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                  </div>

                  {!music.forceInstrumental && (
                    <div>
                      <label className="text-[11px] text-[#5A5A66] block mb-1">
                        Optional Vocal / Lyric Phrase for this Beat
                      </label>
                      <input
                        type="text"
                        value={beat.lyricsLine || ''}
                        onChange={(e) =>
                          updateBeat(beat.id, { lyricsLine: e.target.value })
                        }
                        placeholder="Sung hook or ethereal vocalise phrase for this section..."
                        className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
