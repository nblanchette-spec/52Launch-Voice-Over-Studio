import React, { useMemo, useRef, useState } from 'react';
import {
  Download,
  Film,
  Footprints,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import type {
  FoleyBedEngineId,
  FoleyCategory,
  FoleyCue,
  FoleyCueEngineId,
  FoleyStageData,
  PipelineProject,
  UploadedVideoMeta,
} from '../../types/pipeline';
import {
  DEFAULT_FOLEY_STAGE,
  FOLEY_BED_ENGINES,
  FOLEY_CATEGORIES,
  FOLEY_CUE_ENGINES,
} from '../../utils/voPresets';
import { uploadVideoAssetForStage } from '../../utils/videoUtils';
import { exportCueTimelineAudioMix } from '../../utils/voAudioEngine';
import { parseJsonResponse } from '../../utils/safeFetch';
import {
  SyncedTimelineCueItem,
  SyncedVideoCuePlayer,
} from './SyncedVideoCuePlayer';

interface Stage2FoleyStudioProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onProjectUpdated: (updated: PipelineProject) => void;
  reusableVideos: Array<{ stageLabel: string; video: UploadedVideoMeta }>;
  falConfigured?: boolean;
  elevenLabsConfigured?: boolean;
}

const FOLEY_COLORS = [
  '#C6202F',
  '#10B981',
  '#F59E0B',
  '#38BDF8',
  '#8B5CF6',
  '#EC4899',
];

export const Stage2FoleyStudio: React.FC<Stage2FoleyStudioProps> = ({
  project,
  onUpdateProject,
  onProjectUpdated,
  reusableVideos,
  falConfigured = true,
  elevenLabsConfigured = true,
}) => {
  const foley: FoleyStageData = useMemo(
    () => ({
      ...DEFAULT_FOLEY_STAGE,
      ...(project.foley || {}),
    }),
    [project.foley]
  );

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [generatingCueId, setGeneratingCueId] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isGeneratingBed, setIsGeneratingBed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{
    timeSec: number;
    nonce: number;
  } | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Export modal state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'master' | 'stems'>('master');
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [exportBitrate, setExportBitrate] = useState<128 | 192 | 320>(320);
  const [exportNormalize, setExportNormalize] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const saveFoleyPatch = (patch: Partial<FoleyStageData>) => {
    void onUpdateProject({
      ...project,
      foley: {
        ...foley,
        ...patch,
      },
    });
  };

  const handleUploadVideo = async (file: File) => {
    setUploadError(null);
    setErrorMsg(null);
    setIsUploadingVideo(true);
    try {
      const meta = await uploadVideoAssetForStage(project.id, file, 'foley-vid');
      await onUpdateProject({
        ...project,
        foley: {
          ...foley,
          video: meta,
          syncedBedVideoUrl: null,
          syncedBedAudioUrl: null,
        },
      });
      setStatusNote(
        `Loaded "${meta.filename}" (${meta.durationSec.toFixed(1)}s). Click "Analyze Video for Foley" to detect on-camera sounds.`
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
      foley: {
        ...foley,
        video,
        syncedBedVideoUrl: null,
        syncedBedAudioUrl: null,
      },
    });
    setStatusNote(`Attached "${video.filename}" to Foley SFX Studio.`);
  };

  const handleAnalyzeVideo = async () => {
    if (!foley.video) {
      setErrorMsg('Drop or select a video first.');
      return;
    }
    setErrorMsg(null);
    setStatusNote(null);
    setIsAnalyzing(true);
    try {
      const resp = await fetch('/api/pipeline/foley-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          focusPrompt: foley.focusPrompt,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
        resp,
        'Could not analyze video for foley.'
      );
      if (!resp.ok) throw new Error(data.error || 'Could not analyze video for foley.');
      onProjectUpdated(data.project);
      const count = data.project.foley?.cues.length || 0;
      setStatusNote(
        `Detected ${count} organic on-camera foley cue${count === 1 ? '' : 's'} synchronized to visual action.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Foley video analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const synthesizeSingleCue = async (cue: FoleyCue): Promise<PipelineProject> => {
    setGeneratingCueId(cue.id);
    const resp = await fetch('/api/pipeline/foley-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        cueId: cue.id,
        foleyPrompt: cue.foleyPrompt,
        durationSec: cue.durationSec,
        promptInfluence: cue.promptInfluence,
        engine: foley.cueEngine || 'mirelo_sfx',
      }),
    });
    const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
      resp,
      `Could not synthesize ${cue.cueNumber}.`
    );
    if (!resp.ok) throw new Error(data.error || `Could not synthesize ${cue.cueNumber}.`);
    onProjectUpdated(data.project);
    return data.project;
  };

  const handleGenerateCue = async (cue: FoleyCue) => {
    if (!cue.foleyPrompt.trim()) {
      setErrorMsg('Enter a foley description prompt first.');
      return;
    }
    setErrorMsg(null);
    setStatusNote(null);
    try {
      await synthesizeSingleCue(cue);
      setStatusNote(`Foley cue ${cue.cueNumber} synthesized and armed on the video timeline.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Foley audio synthesis failed.');
    } finally {
      setGeneratingCueId(null);
    }
  };

  const handleGenerateAllCues = async () => {
    const active = foley.cues.filter((c) => !c.muted && c.foleyPrompt.trim().length > 0);
    if (active.length === 0) return;
    setErrorMsg(null);
    setIsGeneratingAll(true);
    try {
      for (let i = 0; i < active.length; i++) {
        const cue = active[i];
        setStatusNote(`Rendering foley cue ${i + 1}/${active.length} (${cue.cueNumber})...`);
        await synthesizeSingleCue(cue);
      }
      setStatusNote(`Rendered ${active.length} organic foley cues. Press Play Sync Preview to audition with picture.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Batch foley generation stopped early.');
    } finally {
      setGeneratingCueId(null);
      setIsGeneratingAll(false);
    }
  };

  const handleGenerateSyncedVideoBed = async () => {
    if (!foley.video) {
      setErrorMsg('Upload a video first.');
      return;
    }
    const activeBedEngine: FoleyBedEngineId = foley.bedEngine || 'mirelo_v2a';
    const bedMeta = FOLEY_BED_ENGINES.find((b) => b.id === activeBedEngine);
    setErrorMsg(null);
    setStatusNote(
      `Synthesizing full synced video foley bed via ${bedMeta?.label || activeBedEngine} (this may take 20-45s)...`
    );
    setIsGeneratingBed(true);
    try {
      const resp = await fetch('/api/pipeline/foley-video-bed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          prompt: foley.focusPrompt || foley.analysisSummary,
          bedEngine: activeBedEngine,
        }),
      });
      const data = await parseJsonResponse<{
        project: PipelineProject;
        mediaType?: 'audio' | 'video';
        syncedBedVideoUrl?: string | null;
        syncedBedAudioUrl?: string | null;
        error?: string;
      }>(resp, 'Could not synthesize full-video foley bed.');
      if (!resp.ok) throw new Error(data.error || 'Could not synthesize full-video foley bed.');
      onProjectUpdated(data.project);
      setStatusNote(
        data.mediaType === 'audio'
          ? `Synced ${bedMeta?.label || 'Mirelo'} foley audio track loaded into Sync Player & ready to download below.`
          : `Synced ${bedMeta?.label || 'Video Foley'} render ready below.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Synced video foley bed failed.');
    } finally {
      setIsGeneratingBed(false);
    }
  };

  const handleAddManualCue = () => {
    const nextNum = foley.cues.length + 1;
    const newCue: FoleyCue = {
      id: `foley-${Date.now()}`,
      cueNumber: `F${String(nextNum).padStart(2, '0')}`,
      startTimeSec: Number(playheadSec.toFixed(1)),
      durationSec: 2.0,
      category: 'Props & Handling',
      surfaceOrMaterial: 'Natural object / room tone',
      visualAction: 'On-screen movement at playhead',
      foleyPrompt:
        'Close organic studio foley recording of subtle hand contact and object movement, dry room acoustic',
      promptInfluence: 0.55,
      gain: 1.0,
      muted: false,
      audioUrl: null,
    };
    saveFoleyPatch({ cues: [...foley.cues, newCue] });
  };

  const updateCue = (cueId: string, patch: Partial<FoleyCue>) => {
    saveFoleyPatch({
      cues: foley.cues.map((c) => (c.id === cueId ? { ...c, ...patch } : c)),
    });
  };

  const removeCue = (cueId: string) => {
    saveFoleyPatch({
      cues: foley.cues.filter((c) => c.id !== cueId),
    });
  };

  const playSoloCue = (audioUrl: string) => {
    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio();
    }
    previewAudioRef.current.src = audioUrl;
    void previewAudioRef.current.play();
  };

  const readyCues = useMemo(
    () => foley.cues.filter((c) => Boolean(c.audioUrl) && !c.muted),
    [foley.cues]
  );

  const timelineItems: SyncedTimelineCueItem[] = useMemo(
    () =>
      foley.cues.map((c, idx) => ({
        id: c.id,
        label: c.cueNumber,
        title: `${c.category}: ${c.visualAction}`,
        startTimeSec: c.startTimeSec,
        durationSec: c.durationSec,
        gain: c.gain,
        muted: c.muted,
        audioUrl: c.audioUrl,
        color: FOLEY_COLORS[idx % FOLEY_COLORS.length],
      })),
    [foley.cues]
  );

  const handleRunExport = async () => {
    if (readyCues.length === 0) return;
    setIsExporting(true);
    setErrorMsg(null);
    try {
      await exportCueTimelineAudioMix({
        projectName: `${project.client}-${project.product.name}`,
        stageSlug: 'foley',
        stageTitle: 'Organic On-Camera Foley SFX',
        totalDurationSec: foley.video?.durationSec || 15,
        cues: readyCues.map((c) => ({
          cueNumber: c.cueNumber,
          label: `${c.category} (${c.surfaceOrMaterial})`,
          prompt: c.foleyPrompt,
          startTimeSec: c.startTimeSec,
          gain: c.gain,
          muted: c.muted,
          audioUrl: c.audioUrl!,
        })),
        format: exportFormat,
        bitrate: exportBitrate,
        normalize: exportNormalize,
        mode: exportMode,
      });
      setExportOpen(false);
      setStatusNote(
        exportMode === 'master'
          ? `Downloaded synced Foley Master ${exportFormat.toUpperCase()}.`
          : `Downloaded Foley Stems (.zip).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Foley export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
        <div>
          <div className="text-xs font-medium text-[#C6202F]">
            Stage 2 · Organic On-Camera Foley SFX
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Visual-Synced Foley Sound Studio
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Drop a video clip to analyze on-camera movement, surfaces, and physical actions — then generate organic foley stems synced to picture.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!foley.video || isAnalyzing}
            onClick={() => void handleAnalyzeVideo()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
          >
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#C6202F]" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#C6202F]" />
            )}
            {isAnalyzing
              ? 'Analyzing Visuals...'
              : foley.cues.length > 0
                ? 'Re-Analyze Video Foley'
                : 'Analyze Video for Foley'}
          </button>

          <button
            type="button"
            disabled={
              isGeneratingAll ||
              Boolean(generatingCueId) ||
              foley.cues.filter((c) => !c.muted && c.foleyPrompt.trim()).length === 0
            }
            onClick={() => void handleGenerateAllCues()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
          >
            {isGeneratingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Footprints className="w-3.5 h-3.5" />
            )}
            {isGeneratingAll
              ? 'Synthesizing Foley...'
              : `Generate All Foley (${foley.cues.filter((c) => !c.muted).length})`}
          </button>

          {falConfigured && foley.video && (
            <button
              type="button"
              disabled={isGeneratingBed}
              onClick={() => void handleGenerateSyncedVideoBed()}
              title="Uses the selected Full-Video Foley Bed engine to score continuous on-camera foley directly from picture"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
            >
              {isGeneratingBed ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
              ) : (
                <Film className="w-3.5 h-3.5 text-[#891A23]" />
              )}
              {isGeneratingBed ? 'Rendering Video Bed...' : 'Full Video Foley Bed'}
            </button>
          )}

          <button
            type="button"
            disabled={readyCues.length === 0}
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export Mix / Stems
          </button>
        </div>
      </div>

      {!elevenLabsConfigured && !falConfigured && (
        <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900">
          Add <strong>ELEVENLABS_API_KEY</strong> or <strong>FAL_KEY</strong> in Settings &gt; Secrets to synthesize foley SFX audio.
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

      <div className="grid grid-cols-1 xl:grid-cols-[480px_1fr] gap-6 items-start">
        {/* LEFT COLUMN: Video Monitor + Foley Direction */}
        <div className="space-y-4">
          <SyncedVideoCuePlayer
            video={foley.video}
            cues={timelineItems}
            masterTrackUrl={foley.syncedBedAudioUrl}
            isUploadingVideo={isUploadingVideo}
            uploadError={uploadError}
            stageLabel="Foley SFX"
            dropzoneHint="Upload an un-mixed video cut. Gemini Vision detects surfaces, footsteps, cloth rustle, and prop interactions frame-by-frame."
            reusableVideos={reusableVideos}
            onUploadFile={(file) => void handleUploadVideo(file)}
            onReuseVideo={handleReuseVideo}
            onTimeUpdate={setPlayheadSec}
            seekRequestSec={seekRequest}
          />

          {/* Foley Engines Selector */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-3.5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#111114]">
                  Individual Foley Cue Model
                </span>
                <span className="text-[10px] font-mono text-[#6E6E7A]">
                  Per-Timestamp Stems
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {FOLEY_CUE_ENGINES.map((eng) => {
                  const selected = (foley.cueEngine || 'mirelo_sfx') === eng.id;
                  return (
                    <button
                      key={eng.id}
                      type="button"
                      onClick={() =>
                        saveFoleyPatch({ cueEngine: eng.id as FoleyCueEngineId })
                      }
                      className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                          : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold">{eng.label}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#111114] text-white">
                          {eng.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#5A5A66] mt-0.5 leading-snug">
                        {eng.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {falConfigured && (
              <div className="space-y-2 pt-3 border-t border-[#E2E2E6]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#111114]">
                    Full-Video Synced Foley Model
                  </span>
                  <span className="text-[10px] font-mono text-[#6E6E7A]">
                    Direct Video-to-Foley
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {FOLEY_BED_ENGINES.map((eng) => {
                    const selected = (foley.bedEngine || 'mirelo_v2a') === eng.id;
                    return (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() =>
                          saveFoleyPatch({ bedEngine: eng.id as FoleyBedEngineId })
                        }
                        className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                            : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-bold truncate">{eng.label}</span>
                          <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-[#111114] text-white shrink-0">
                            {eng.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#5A5A66] mt-0.5 leading-snug line-clamp-2">
                          {eng.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#111114]">
                Foley Surface &amp; Perspective Notes (Optional)
              </label>
              <span className="text-[10px] font-mono text-[#6E6E7A]">
                Playhead: {playheadSec.toFixed(1)}s
              </span>
            </div>
            <textarea
              rows={2}
              value={foley.focusPrompt || ''}
              onChange={(e) => saveFoleyPatch({ focusPrompt: e.target.value })}
              placeholder="e.g. Emphasize wet sneaker grip on track, crisp fabric wind snap, close-mic breath detail..."
              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
            />
            {foley.analysisSummary && (
              <div className="p-3 rounded-lg bg-[#FAFBFD] border border-[#E2E2E6] text-xs text-[#3A3A44] leading-relaxed">
                <span className="font-bold text-[#111114]">Acoustic Breakdown: </span>
                {foley.analysisSummary}
              </div>
            )}
          </div>

          {foley.syncedBedAudioUrl && (
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#111114]">
                  Synced Video-to-Foley Audio Track (Master Sync)
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => saveFoleyPatch({ syncedBedAudioUrl: null })}
                    className="text-[11px] text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                  >
                    Clear
                  </button>
                  <a
                    href={foley.syncedBedAudioUrl}
                    download={`foley-bed-${project.id}.mp3`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#C6202F] hover:underline"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Audio
                  </a>
                </div>
              </div>
              <audio src={foley.syncedBedAudioUrl} controls className="w-full h-8" />
            </div>
          )}

          {foley.syncedBedVideoUrl && (
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#111114]">
                  Synced Full-Video Foley Render
                </span>
                <a
                  href={foley.syncedBedVideoUrl}
                  download={`foley-bed-${project.id}.mp4`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#C6202F] hover:underline"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download MP4
                </a>
              </div>
              <video
                src={foley.syncedBedVideoUrl}
                controls
                playsInline
                className="w-full rounded-lg bg-black max-h-56"
              />
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Organic Foley Cue Timeline List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#111114]">
                Foley Cue Sheet ({foley.cues.length})
              </h2>
              <p className="text-xs text-[#5A5A66]">
                Click any timestamp badge to scrub the video monitor directly to that action.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddManualCue}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-[#C6202F]" />
              Add Foley @ {playheadSec.toFixed(1)}s
            </button>
          </div>

          {foley.cues.length === 0 ? (
            <div className="bg-white border border-dashed border-[#D8D8DF] rounded-xl p-10 text-center space-y-3">
              <Footprints className="w-8 h-8 text-[#C6202F]/60 mx-auto" />
              <div className="text-sm font-bold text-[#111114]">
                No foley cues mapped yet
              </div>
              <p className="text-xs text-[#5A5A66] max-w-md mx-auto">
                Upload a video and click <strong>Analyze Video for Foley</strong> for automatic frame-accurate detection, or add custom foley cues manually at any playhead position.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {foley.cues.map((cue, idx) => {
                const isGen = generatingCueId === cue.id;
                return (
                  <div
                    key={cue.id}
                    className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                      cue.muted ? 'opacity-65 border-[#E2E2E6]' : 'border-[#E2E2E6]'
                    }`}
                  >
                    <div className="px-4 py-2.5 bg-[#FBFBFC] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          style={{ backgroundColor: FOLEY_COLORS[idx % FOLEY_COLORS.length] }}
                          className="px-2 py-0.5 rounded font-mono font-bold text-white text-[11px]"
                        >
                          {cue.cueNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSeekRequest({
                              timeSec: cue.startTimeSec,
                              nonce: Date.now(),
                            })
                          }
                          className="px-2 py-0.5 rounded bg-[#111114] text-white font-mono text-[11px] hover:bg-[#C6202F] cursor-pointer transition-colors"
                          title="Jump video monitor to this timestamp"
                        >
                          @ {cue.startTimeSec.toFixed(1)}s
                        </button>
                        <select
                          value={cue.category}
                          onChange={(e) =>
                            updateCue(cue.id, {
                              category: e.target.value as FoleyCategory,
                            })
                          }
                          className="bg-[#F6F6F7] border border-[#E2E2E6] rounded px-2 py-1 text-xs font-medium text-[#111114]"
                        >
                          {FOLEY_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                        {cue.audioUrl && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[11px] font-medium">
                            Armed
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateCue(cue.id, { muted: !cue.muted })}
                          className="p-1.5 rounded-md bg-[#F6F6F7] border border-[#E2E2E6] text-[#3A3A44] hover:border-[#C6202F] cursor-pointer"
                          title={cue.muted ? 'Unmute cue' : 'Mute cue'}
                        >
                          {cue.muted ? (
                            <VolumeX className="w-3.5 h-3.5 text-[#C6202F]" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {cue.audioUrl && (
                          <button
                            type="button"
                            onClick={() => playSoloCue(cue.audioUrl!)}
                            className="px-2.5 py-1 text-xs font-medium bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] rounded-md cursor-pointer"
                          >
                            Solo
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isGen || isGeneratingAll || !cue.foleyPrompt.trim()}
                          onClick={() => void handleGenerateCue(cue)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-md cursor-pointer"
                        >
                          {isGen ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Wand2 className="w-3 h-3" />
                          )}
                          {isGen ? 'Rendering...' : cue.audioUrl ? 'Regenerate' : 'Generate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCue(cue.id)}
                          className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                          title="Delete cue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Start Time (s)
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={cue.startTimeSec}
                            onChange={(e) =>
                              updateCue(cue.id, {
                                startTimeSec: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Duration (s)
                          </label>
                          <input
                            type="number"
                            min={0.5}
                            max={20}
                            step={0.1}
                            value={cue.durationSec}
                            onChange={(e) =>
                              updateCue(cue.id, {
                                durationSec: Math.max(
                                  0.5,
                                  Math.min(20, Number(e.target.value) || 1.5)
                                ),
                              })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Surface / Physical Material
                          </label>
                          <input
                            type="text"
                            value={cue.surfaceOrMaterial}
                            onChange={(e) =>
                              updateCue(cue.id, { surfaceOrMaterial: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                          />
                        </div>
                      </div>

                      <div className="text-xs">
                        <label className="text-[11px] text-[#5A5A66] block mb-1">
                          Visible Action in Frame
                        </label>
                        <input
                          type="text"
                          value={cue.visualAction}
                          onChange={(e) =>
                            updateCue(cue.id, { visualAction: e.target.value })
                          }
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                        />
                      </div>

                      <div className="text-xs">
                        <label className="text-[11px] text-[#5A5A66] block mb-1">
                          Foley Synthesis Prompt
                        </label>
                        <textarea
                          rows={2}
                          value={cue.foleyPrompt}
                          onChange={(e) =>
                            updateCue(cue.id, { foleyPrompt: e.target.value })
                          }
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs leading-relaxed focus:outline-none focus:border-[#C6202F]"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 text-xs">
                        <div>
                          <div className="flex justify-between mb-1">
                            <span className="text-[11px] text-[#5A5A66]">Mix Gain</span>
                            <span className="text-[11px] font-mono text-[#891A23]">
                              {Math.round((cue.gain ?? 1) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.1}
                            max={1.8}
                            step={0.05}
                            value={cue.gain ?? 1}
                            onChange={(e) =>
                              updateCue(cue.id, { gain: Number(e.target.value) })
                            }
                            className="w-full accent-[#C6202F] cursor-pointer"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between mb-1">
                            <span className="text-[11px] text-[#5A5A66]">
                              Prompt Adherence
                            </span>
                            <span className="text-[11px] font-mono text-[#891A23]">
                              {Math.round((cue.promptInfluence ?? 0.55) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.1}
                            max={1.0}
                            step={0.05}
                            value={cue.promptInfluence ?? 0.55}
                            onChange={(e) =>
                              updateCue(cue.id, {
                                promptInfluence: Number(e.target.value),
                              })
                            }
                            className="w-full accent-[#C6202F] cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Export Modal */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E2E6] rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111114]">
                Export Foley Audio Package
              </h3>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="text-xs text-[#5A5A66] hover:text-[#111114] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 text-xs">
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
                  <div className="font-semibold">Time-Synced Mix</div>
                  <div className="text-[11px] text-[#5A5A66] mt-0.5">
                    Placed at exact video timestamps
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
                    One file per cue + cue-sheet.txt
                  </div>
                </button>
              </div>

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
                  WAV (PCM)
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
                  MP3 ({exportBitrate}k)
                </button>
              </div>

              {exportFormat === 'mp3' && (
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
              )}

              <label className="flex items-center justify-between text-[#3A3A44] cursor-pointer">
                <span>Peak Normalization (-1 dB)</span>
                <input
                  type="checkbox"
                  checked={exportNormalize}
                  onChange={(e) => setExportNormalize(e.target.checked)}
                  className="accent-[#C6202F] w-4 h-4"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E2E6]">
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="px-3.5 py-2 text-xs text-[#3A3A44] cursor-pointer"
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
    </div>
  );
};
