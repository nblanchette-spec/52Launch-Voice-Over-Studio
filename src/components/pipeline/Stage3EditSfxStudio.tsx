import React, { useMemo, useRef, useState } from 'react';
import {
  Download,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
  Zap,
} from 'lucide-react';
import type {
  EditSfxCategory,
  EditSfxCue,
  EditSfxEngineId,
  EditSfxStageData,
  PipelineProject,
  UploadedVideoMeta,
} from '../../types/pipeline';
import {
  DEFAULT_EDIT_SFX_STAGE,
  EDIT_SFX_CATEGORIES,
  EDIT_SFX_ENGINES,
  QUICK_EDIT_SFX_PRESETS,
} from '../../utils/voPresets';
import { uploadVideoAssetForStage } from '../../utils/videoUtils';
import { exportCueTimelineAudioMix } from '../../utils/voAudioEngine';
import { parseJsonResponse } from '../../utils/safeFetch';
import {
  SyncedTimelineCueItem,
  SyncedVideoCuePlayer,
} from './SyncedVideoCuePlayer';

interface Stage3EditSfxStudioProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onProjectUpdated: (updated: PipelineProject) => void;
  reusableVideos: Array<{ stageLabel: string; video: UploadedVideoMeta }>;
  falConfigured?: boolean;
  elevenLabsConfigured?: boolean;
}

const EDIT_SFX_COLORS = [
  '#891A23',
  '#F59E0B',
  '#6366F1',
  '#0EA5E9',
  '#EC4899',
  '#10B981',
];

const EDITING_STYLE_PRESETS = [
  'Modern sleek commercial cut with crisp air swooshes & subtle UI pops',
  'High-energy athletic / trailer edit with risers, speed-ramp whooshes & sub hits',
  'Minimalist product showcase with clean glass clicks & soft transitions',
  'Kinetic motion graphics / digital glitch cut with synth zaps & stingers',
];

export const Stage3EditSfxStudio: React.FC<Stage3EditSfxStudioProps> = ({
  project,
  onUpdateProject,
  onProjectUpdated,
  reusableVideos,
  falConfigured = true,
  elevenLabsConfigured = true,
}) => {
  const editSfx: EditSfxStageData = useMemo(
    () => ({
      ...DEFAULT_EDIT_SFX_STAGE,
      ...(project.editSfx || {}),
    }),
    [project.editSfx]
  );

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [generatingCueId, setGeneratingCueId] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
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

  const saveEditSfxPatch = (patch: Partial<EditSfxStageData>) => {
    void onUpdateProject({
      ...project,
      editSfx: {
        ...editSfx,
        ...patch,
      },
    });
  };

  const handleUploadVideo = async (file: File) => {
    setUploadError(null);
    setErrorMsg(null);
    setIsUploadingVideo(true);
    try {
      const meta = await uploadVideoAssetForStage(project.id, file, 'sfx-vid');
      await onUpdateProject({
        ...project,
        editSfx: {
          ...editSfx,
          video: meta,
        },
      });
      setStatusNote(
        `Loaded "${meta.filename}" (${meta.durationSec.toFixed(1)}s). Click "Analyze Cuts & Transitions" to map swooshes, hits & UI SFX.`
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
      editSfx: {
        ...editSfx,
        video,
      },
    });
    setStatusNote(`Attached "${video.filename}" to Edit SFX Studio.`);
  };

  const handleAnalyzeEdits = async () => {
    if (!editSfx.video) {
      setErrorMsg('Drop or select a video first.');
      return;
    }
    setErrorMsg(null);
    setStatusNote(null);
    setIsAnalyzing(true);
    try {
      const resp = await fetch('/api/pipeline/sfx-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          editingStyle: editSfx.editingStyle,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
        resp,
        'Could not analyze video transitions.'
      );
      if (!resp.ok) throw new Error(data.error || 'Could not analyze video transitions.');
      onProjectUpdated(data.project);
      const count = data.project.editSfx?.cues.length || 0;
      setStatusNote(
        `Mapped ${count} editorial & graphical SFX cue${count === 1 ? '' : 's'} onto your edit timeline.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Edit SFX analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const synthesizeSingleCue = async (cue: EditSfxCue): Promise<PipelineProject> => {
    setGeneratingCueId(cue.id);
    const resp = await fetch('/api/pipeline/sfx-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        cueId: cue.id,
        sfxPrompt: cue.sfxPrompt,
        durationSec: cue.durationSec,
        promptInfluence: cue.promptInfluence,
        engine: editSfx.engine || 'elevenlabs_sfx',
      }),
    });
    const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
      resp,
      `Could not generate ${cue.cueNumber}.`
    );
    if (!resp.ok) throw new Error(data.error || `Could not generate ${cue.cueNumber}.`);
    onProjectUpdated(data.project);
    return data.project;
  };

  const handleGenerateCue = async (cue: EditSfxCue) => {
    if (!cue.sfxPrompt.trim()) {
      setErrorMsg('Enter an editorial SFX prompt first.');
      return;
    }
    setErrorMsg(null);
    setStatusNote(null);
    try {
      await synthesizeSingleCue(cue);
      setStatusNote(`Edit SFX ${cue.cueNumber} generated and armed on the timeline.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Edit SFX generation failed.');
    } finally {
      setGeneratingCueId(null);
    }
  };

  const handleGenerateAllCues = async () => {
    const active = editSfx.cues.filter((c) => !c.muted && c.sfxPrompt.trim().length > 0);
    if (active.length === 0) return;
    setErrorMsg(null);
    setIsGeneratingAll(true);
    try {
      for (let i = 0; i < active.length; i++) {
        const cue = active[i];
        setStatusNote(`Designing edit SFX ${i + 1}/${active.length} (${cue.cueNumber})...`);
        await synthesizeSingleCue(cue);
      }
      setStatusNote(
        `Generated ${active.length} editorial transition SFX cues. Hit Play Sync Preview to check timing.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Batch Edit SFX generation stopped.');
    } finally {
      setGeneratingCueId(null);
      setIsGeneratingAll(false);
    }
  };

  const handleQuickAddPreset = (preset: (typeof QUICK_EDIT_SFX_PRESETS)[number]) => {
    const nextNum = editSfx.cues.length + 1;
    const newCue: EditSfxCue = {
      id: `sfx-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      cueNumber: `E${String(nextNum).padStart(2, '0')}`,
      startTimeSec: Number(playheadSec.toFixed(1)),
      durationSec: preset.durationSec,
      category: preset.category,
      editEvent: `${preset.label} transition @ ${playheadSec.toFixed(1)}s`,
      sfxPrompt: preset.prompt,
      promptInfluence: 0.65,
      gain: 1.0,
      muted: false,
      audioUrl: null,
    };
    saveEditSfxPatch({ cues: [...editSfx.cues, newCue] });
    setStatusNote(`Inserted "${preset.label}" at ${playheadSec.toFixed(1)}s.`);
  };

  const updateCue = (cueId: string, patch: Partial<EditSfxCue>) => {
    saveEditSfxPatch({
      cues: editSfx.cues.map((c) => (c.id === cueId ? { ...c, ...patch } : c)),
    });
  };

  const removeCue = (cueId: string) => {
    saveEditSfxPatch({
      cues: editSfx.cues.filter((c) => c.id !== cueId),
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
    () => editSfx.cues.filter((c) => Boolean(c.audioUrl) && !c.muted),
    [editSfx.cues]
  );

  const timelineItems: SyncedTimelineCueItem[] = useMemo(
    () =>
      editSfx.cues.map((c, idx) => ({
        id: c.id,
        label: c.cueNumber,
        title: `${c.category}: ${c.editEvent}`,
        startTimeSec: c.startTimeSec,
        durationSec: c.durationSec,
        gain: c.gain,
        muted: c.muted,
        audioUrl: c.audioUrl,
        color: EDIT_SFX_COLORS[idx % EDIT_SFX_COLORS.length],
      })),
    [editSfx.cues]
  );

  const handleRunExport = async () => {
    if (readyCues.length === 0) return;
    setIsExporting(true);
    setErrorMsg(null);
    try {
      await exportCueTimelineAudioMix({
        projectName: `${project.client}-${project.product.name}`,
        stageSlug: 'edit-sfx',
        stageTitle: 'Editorial & Graphical Transition SFX',
        totalDurationSec: editSfx.video?.durationSec || 15,
        cues: readyCues.map((c) => ({
          cueNumber: c.cueNumber,
          label: c.category,
          prompt: c.sfxPrompt,
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
          ? `Downloaded synced Edit SFX Master ${exportFormat.toUpperCase()}.`
          : `Downloaded Edit SFX Stems (.zip).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Edit SFX export failed.');
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
            Stage 3 · Editorial &amp; Graphical Transition SFX
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Swoosh, Cut &amp; Motion Graphics SFX Studio
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Drop an edited video to detect camera whip pans, title reveals, speed ramps, and hard cuts — or stamp transition SFX presets straight onto any playhead timestamp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!editSfx.video || isAnalyzing}
            onClick={() => void handleAnalyzeEdits()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
          >
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#C6202F]" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#C6202F]" />
            )}
            {isAnalyzing
              ? 'Analyzing Edit Cuts...'
              : editSfx.cues.length > 0
                ? 'Re-Analyze Cuts & Transitions'
                : 'Analyze Cuts & Transitions'}
          </button>

          <button
            type="button"
            disabled={
              isGeneratingAll ||
              Boolean(generatingCueId) ||
              editSfx.cues.filter((c) => !c.muted && c.sfxPrompt.trim()).length === 0
            }
            onClick={() => void handleGenerateAllCues()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
          >
            {isGeneratingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            {isGeneratingAll
              ? 'Designing SFX...'
              : `Generate All Edit SFX (${editSfx.cues.filter((c) => !c.muted).length})`}
          </button>

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
          Add <strong>ELEVENLABS_API_KEY</strong> or <strong>FAL_KEY</strong> in Settings &gt; Secrets to synthesize editorial SFX audio.
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
        {/* LEFT COLUMN: Video Player + Editing Style + Quick Stamp Bar */}
        <div className="space-y-4">
          <SyncedVideoCuePlayer
            video={editSfx.video}
            cues={timelineItems}
            isUploadingVideo={isUploadingVideo}
            uploadError={uploadError}
            stageLabel="Edit SFX"
            dropzoneHint="Drop your edited timeline video here. Gemini spots visual cuts, whip pans, text pops, and logo animations for transition sound design."
            reusableVideos={reusableVideos}
            onUploadFile={(file) => void handleUploadVideo(file)}
            onReuseVideo={handleReuseVideo}
            onTimeUpdate={setPlayheadSec}
            seekRequestSec={seekRequest}
          />

          {/* Edit SFX Engine Selector */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111114]">
                Edit SFX Synthesis Model
              </span>
              <span className="text-[10px] font-mono text-[#6E6E7A]">
                Transitions &amp; Graphical SFX
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {EDIT_SFX_ENGINES.map((eng) => {
                const selected = (editSfx.engine || 'elevenlabs_sfx') === eng.id;
                return (
                  <button
                    key={eng.id}
                    type="button"
                    onClick={() =>
                      saveEditSfxPatch({ engine: eng.id as EditSfxEngineId })
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

          <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#111114]">
                Editorial Sound Design Direction
              </label>
              <span className="text-[10px] font-mono text-[#6E6E7A]">
                Playhead: {playheadSec.toFixed(1)}s
              </span>
            </div>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) saveEditSfxPatch({ editingStyle: e.target.value });
              }}
              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#3A3A44]"
            >
              <option value="">Choose an editing aesthetic preset...</option>
              {EDITING_STYLE_PRESETS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <textarea
              rows={2}
              value={editSfx.editingStyle || ''}
              onChange={(e) => saveEditSfxPatch({ editingStyle: e.target.value })}
              placeholder="Describe transition sound style (e.g. Modern sleek swooshes, metallic hits, subtle SaaS UI clicks)..."
              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
            />

            {editSfx.analysisSummary && (
              <div className="p-3 rounded-lg bg-[#FAFBFD] border border-[#E2E2E6] text-xs text-[#3A3A44] leading-relaxed">
                <span className="font-bold text-[#111114]">Edit Pacing Notes: </span>
                {editSfx.analysisSummary}
              </div>
            )}
          </div>

          {/* Quick-Add Graphical SFX Stamp Bar */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111114]">
                Quick-Stamp SFX @ {playheadSec.toFixed(1)}s
              </span>
              <span className="text-[10px] text-[#6E6E7A]">
                Instant insert at playhead
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_EDIT_SFX_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleQuickAddPreset(preset)}
                  className="flex items-center justify-between gap-2 px-3 py-2 bg-[#F6F6F7] hover:bg-[#FDF2F3] border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg text-left text-xs font-medium text-[#111114] transition-colors cursor-pointer"
                >
                  <span className="truncate">{preset.label}</span>
                  <Plus className="w-3.5 h-3.5 text-[#C6202F] shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Edit SFX Cue Sheet */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#111114]">
                Transition &amp; Graphical SFX Cues ({editSfx.cues.length})
              </h2>
              <p className="text-xs text-[#5A5A66]">
                Fine-tune exact placement, duration, and synthesis prompts for every cut and motion graphic.
              </p>
            </div>
          </div>

          {editSfx.cues.length === 0 ? (
            <div className="bg-white border border-dashed border-[#D8D8DF] rounded-xl p-10 text-center space-y-3">
              <Zap className="w-8 h-8 text-[#C6202F]/60 mx-auto" />
              <div className="text-sm font-bold text-[#111114]">
                No edit SFX cues added yet
              </div>
              <p className="text-xs text-[#5A5A66] max-w-md mx-auto">
                Click <strong>Analyze Cuts &amp; Transitions</strong> after dropping a video, or use any Quick-Stamp preset button on the left to drop swooshes, risers, hits, or UI pops right onto the timeline.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {editSfx.cues.map((cue, idx) => {
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
                          style={{
                            backgroundColor: EDIT_SFX_COLORS[idx % EDIT_SFX_COLORS.length],
                          }}
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
                              category: e.target.value as EditSfxCategory,
                            })
                          }
                          className="bg-[#F6F6F7] border border-[#E2E2E6] rounded px-2 py-1 text-xs font-medium text-[#111114]"
                        >
                          {EDIT_SFX_CATEGORIES.map((cat) => (
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
                          title={cue.muted ? 'Unmute SFX' : 'Mute SFX'}
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
                          disabled={isGen || isGeneratingAll || !cue.sfxPrompt.trim()}
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
                            max={15}
                            step={0.1}
                            value={cue.durationSec}
                            onChange={(e) =>
                              updateCue(cue.id, {
                                durationSec: Math.max(
                                  0.5,
                                  Math.min(15, Number(e.target.value) || 1.0)
                                ),
                              })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Visual Edit / Transition Event
                          </label>
                          <input
                            type="text"
                            value={cue.editEvent}
                            onChange={(e) =>
                              updateCue(cue.id, { editEvent: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs"
                          />
                        </div>
                      </div>

                      <div className="text-xs">
                        <label className="text-[11px] text-[#5A5A66] block mb-1">
                          Sound Design Prompt
                        </label>
                        <textarea
                          rows={2}
                          value={cue.sfxPrompt}
                          onChange={(e) =>
                            updateCue(cue.id, { sfxPrompt: e.target.value })
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
                              {Math.round((cue.promptInfluence ?? 0.6) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.1}
                            max={1.0}
                            step={0.05}
                            value={cue.promptInfluence ?? 0.6}
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
                Export Edit SFX Package
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
                    Placed at exact edit timestamps
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
                    One file per SFX + cue-sheet.txt
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
