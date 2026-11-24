import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { UploadedVideoMeta } from '../../types/pipeline';
import { getAudioContext, urlToAudioBuffer } from '../../utils/voAudioEngine';

export interface SyncedTimelineCueItem {
  id: string;
  label: string;
  title: string;
  startTimeSec: number;
  durationSec: number;
  gain?: number;
  muted?: boolean;
  audioUrl?: string | null;
  color?: string;
}

interface SyncedVideoCuePlayerProps {
  video: UploadedVideoMeta | null;
  cues?: SyncedTimelineCueItem[];
  masterTrackUrl?: string | null;
  isUploadingVideo?: boolean;
  uploadError?: string | null;
  stageLabel: string;
  dropzoneHint: string;
  reusableVideos?: Array<{ stageLabel: string; video: UploadedVideoMeta }>;
  onUploadFile: (file: File) => void;
  onReuseVideo?: (video: UploadedVideoMeta) => void;
  onTimeUpdate?: (timeSec: number) => void;
  seekRequestSec?: { timeSec: number; nonce: number } | null;
}

function formatTimecode(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export const SyncedVideoCuePlayer: React.FC<SyncedVideoCuePlayerProps> = ({
  video,
  cues = [],
  masterTrackUrl,
  isUploadingVideo = false,
  uploadError = null,
  stageLabel,
  dropzoneHint,
  reusableVideos = [],
  onUploadFile,
  onReuseVideo,
  onTimeUpdate,
  seekRequestSec,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const activeNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const triggeredCuesRef = useRef<Set<string>>(new Set());
  const masterSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastCheckTimeRef = useRef<number>(0);

  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [muteOriginalVideo, setMuteOriginalVideo] = useState(true);
  const [previewMixVolume, setPreviewMixVolume] = useState(1.0);
  const [decodingCount, setDecodingCount] = useState(0);

  const durationSec = Math.max(1, Number(video?.durationSec) || 15);

  const stopAllCueAudio = () => {
    for (const node of activeNodesRef.current) {
      try {
        node.stop();
      } catch {
        // Ignore already stopped
      }
    }
    activeNodesRef.current.clear();
    if (masterSourceRef.current) {
      try {
        masterSourceRef.current.stop();
      } catch {
        // Ignore
      }
      masterSourceRef.current = null;
    }
    triggeredCuesRef.current.clear();
  };

  // Preload AudioBuffers for ready cues & master track
  useEffect(() => {
    const urls = new Set<string>();
    for (const c of cues) {
      if (c.audioUrl) urls.add(c.audioUrl);
    }
    if (masterTrackUrl) urls.add(masterTrackUrl);

    const missing = Array.from(urls).filter((u) => !bufferCacheRef.current.has(u));
    if (missing.length === 0) return;

    let cancelled = false;
    setDecodingCount((c) => c + missing.length);
    const ctx = getAudioContext();

    void Promise.all(
      missing.map(async (url) => {
        try {
          const buf = await urlToAudioBuffer(url, ctx);
          if (!cancelled) {
            bufferCacheRef.current.set(url, buf);
          }
        } catch {
          // Ignore individual fetch/decode failures cleanly
        } finally {
          if (!cancelled) {
            setDecodingCount((c) => Math.max(0, c - 1));
          }
        }
      })
    );

    return () => {
      cancelled = true;
    };
  }, [cues, masterTrackUrl]);

  useEffect(() => {
    return () => {
      stopAllCueAudio();
    };
  }, [video?.assetUrl]);

  const startMasterAtTime = (t: number) => {
    if (!masterTrackUrl) return;
    const buf = bufferCacheRef.current.get(masterTrackUrl);
    if (!buf) return;
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') void ctx.resume();

    if (masterSourceRef.current) {
      try {
        masterSourceRef.current.stop();
      } catch {
        // Ignore
      }
      masterSourceRef.current = null;
    }

    if (t >= buf.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = previewMixVolume;
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0, Math.max(0, t));
    masterSourceRef.current = src;
  };

  const triggerCueAtVideoTime = (cue: SyncedTimelineCueItem, videoTimeSec: number) => {
    if (cue.muted || !cue.audioUrl) return;
    const buf = bufferCacheRef.current.get(cue.audioUrl);
    if (!buf) return;
    const offset = Math.max(0, videoTimeSec - cue.startTimeSec);
    if (offset >= buf.duration) return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') void ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gainNode = ctx.createGain();
    gainNode.gain.value = (cue.gain ?? 1) * previewMixVolume;
    src.connect(gainNode);
    gainNode.connect(ctx.destination);
    src.onended = () => {
      activeNodesRef.current.delete(src);
    };
    activeNodesRef.current.add(src);
    src.start(0, offset);
  };

  // Sync audio playback frame-accurately while video plays
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;

    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const t = v.currentTime;
      setCurrentTime(t);
      onTimeUpdate?.(t);

      // Detect loop wrap or backward jump
      if (t + 0.15 < lastCheckTimeRef.current) {
        stopAllCueAudio();
        startMasterAtTime(t);
      }

      for (const cue of cues) {
        if (cue.muted || !cue.audioUrl) continue;
        if (triggeredCuesRef.current.has(cue.id)) continue;
        const cueBuf = bufferCacheRef.current.get(cue.audioUrl);
        const maxLen = cueBuf ? cueBuf.duration : cue.durationSec;
        if (t >= cue.startTimeSec && t < cue.startTimeSec + Math.max(0.25, maxLen)) {
          triggeredCuesRef.current.add(cue.id);
          triggerCueAtVideoTime(cue, t);
        }
      }

      lastCheckTimeRef.current = t;
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, cues, previewMixVolume, masterTrackUrl]);

  // Handle external seek requests (e.g. clicking a cue card or beat)
  useEffect(() => {
    if (!seekRequestSec || !videoRef.current) return;
    const target = Math.max(0, Math.min(durationSec - 0.05, seekRequestSec.timeSec));
    videoRef.current.currentTime = target;
    setCurrentTime(target);
    onTimeUpdate?.(target);
    lastCheckTimeRef.current = target;
    stopAllCueAudio();
    if (!videoRef.current.paused) {
      startMasterAtTime(target);
    }
  }, [seekRequestSec?.nonce]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') void ctx.resume();

    if (v.paused) {
      stopAllCueAudio();
      lastCheckTimeRef.current = v.currentTime;
      startMasterAtTime(v.currentTime);
      void v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      stopAllCueAudio();
      setIsPlaying(false);
    }
  };

  const handleSeek = (targetSec: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(durationSec, targetSec));
    v.currentTime = clamped;
    setCurrentTime(clamped);
    onTimeUpdate?.(clamped);
    lastCheckTimeRef.current = clamped;
    stopAllCueAudio();
    if (!v.paused) {
      startMasterAtTime(clamped);
    }
  };

  const readyCuesCount = useMemo(
    () => cues.filter((c) => Boolean(c.audioUrl)).length,
    [cues]
  );

  const handleDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      onUploadFile(file);
    }
  };

  return (
    <div className="bg-[#111114] text-white border border-[#24242B] rounded-xl overflow-hidden shadow-sm">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onUploadFile(f);
            e.target.value = '';
          }
        }}
      />

      {!video ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDropFiles}
          className={`p-8 text-center transition-colors border-2 border-dashed m-4 rounded-xl ${
            isDragging
              ? 'border-[#C6202F] bg-[#C6202F]/10'
              : 'border-[#33333D] bg-[#18181E]'
          }`}
        >
          {isUploadingVideo ? (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#C6202F]" />
              <div className="text-sm font-semibold">
                Uploading &amp; extracting visual keyframes...
              </div>
              <p className="text-xs text-[#9C9CA8]">
                Preparing video for {stageLabel}
              </p>
            </div>
          ) : (
            <div className="py-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#C6202F]/15 text-[#F87171] flex items-center justify-center mx-auto">
                <Film className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  Drop a video for {stageLabel}
                </h3>
                <p className="text-xs text-[#9C9CA8] mt-1 max-w-md mx-auto leading-relaxed">
                  {dropzoneHint}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#C6202F] hover:bg-[#AD1A27] text-white rounded-lg cursor-pointer transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Select Video (.mp4 / .mov / .webm)
                </button>
                {onReuseVideo &&
                  reusableVideos.map((rv) => (
                    <button
                      key={`${rv.stageLabel}-${rv.video.assetUrl}`}
                      type="button"
                      onClick={() => onReuseVideo(rv.video)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#22222B] hover:bg-[#2C2C37] text-[#E2E2EC] border border-[#383844] rounded-lg cursor-pointer transition-colors"
                    >
                      <Film className="w-3.5 h-3.5 text-[#F87171]" />
                      Use {rv.stageLabel} Video ({rv.video.filename})
                    </button>
                  ))}
              </div>
              {uploadError && (
                <div className="text-xs text-[#F87171] bg-[#C6202F]/15 border border-[#C6202F]/40 rounded-lg px-3 py-2 max-w-md mx-auto">
                  {uploadError}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Video Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#17171C] border-b border-[#24242B]">
            <div className="flex items-center gap-2.5 min-w-0">
              <Film className="w-4 h-4 text-[#C6202F] shrink-0" />
              <span className="text-xs font-semibold truncate max-w-[240px]">
                {video.filename}
              </span>
              <span className="text-[11px] font-mono text-[#9C9CA8]">
                {durationSec.toFixed(1)}s · {video.width || '—'}×{video.height || '—'}
              </span>
              {decodingCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] text-[#F59E0B] font-mono">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Buffering audio...
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMuteOriginalVideo((m) => !m)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer ${
                  muteOriginalVideo
                    ? 'bg-[#22222B] border-[#383846] text-[#C8C8D4]'
                    : 'bg-[#10B981]/15 border-[#10B981]/40 text-[#34D399]'
                }`}
                title="Toggle original video audio vs muted so you can hear AI audio clearly"
              >
                {muteOriginalVideo ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                Orig Audio: {muteOriginalVideo ? 'Muted' : 'On'}
              </button>
              <button
                type="button"
                disabled={isUploadingVideo}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-[#22222B] hover:bg-[#2C2C37] border border-[#383846] rounded-md text-[#E2E2EC] cursor-pointer"
              >
                <Upload className="w-3 h-3" />
                Replace Video
              </button>
            </div>
          </div>

          {/* Video Viewport */}
          <div className="relative bg-black flex items-center justify-center max-h-[340px] overflow-hidden">
            <video
              ref={videoRef}
              src={video.assetUrl}
              muted={muteOriginalVideo}
              playsInline
              onClick={togglePlay}
              onEnded={() => {
                stopAllCueAudio();
                setIsPlaying(false);
              }}
              onPause={() => {
                stopAllCueAudio();
                setIsPlaying(false);
              }}
              className="w-full max-h-[340px] object-contain cursor-pointer"
            />
          </div>

          {/* Transport + Visual Multi-Cue Scrubber */}
          <div className="p-3.5 bg-[#15151A] border-t border-[#24242B] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#C6202F] hover:bg-[#AD1A27] text-white rounded-md cursor-pointer"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      Pause Sync
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      Play Sync Preview
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleSeek(0)}
                  className="p-1.5 bg-[#22222B] hover:bg-[#2C2C37] border border-[#383846] rounded-md text-[#C8C8D4] cursor-pointer"
                  title="Jump to start"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-mono tabular-nums text-[#E2E2EC] ml-1">
                  {formatTimecode(currentTime)}{' '}
                  <span className="text-[#787886]">/ {formatTimecode(durationSec)}</span>
                </span>
              </div>

              <div className="flex items-center gap-3">
                {cues.length > 0 && (
                  <span className="text-[11px] font-mono text-[#9C9CA8]">
                    {readyCuesCount}/{cues.length} Cues Armed
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-[#9C9CA8]" />
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={previewMixVolume}
                    onChange={(e) => setPreviewMixVolume(Number(e.target.value))}
                    className="w-20 accent-[#C6202F] cursor-pointer"
                    title="AI Audio Preview Volume"
                  />
                </div>
              </div>
            </div>

            {/* Scrubber Track + Cue Markers */}
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                handleSeek(ratio * durationSec);
              }}
              className="relative h-9 bg-[#0D0D11] border border-[#2C2C36] rounded-lg overflow-hidden cursor-pointer select-none"
            >
              {/* Cue Blocks */}
              {cues.map((cue, idx) => {
                const leftPct = Math.max(0, Math.min(98, (cue.startTimeSec / durationSec) * 100));
                const widthPct = Math.max(
                  2.5,
                  Math.min(100 - leftPct, (cue.durationSec / durationSec) * 100)
                );
                const isReady = Boolean(cue.audioUrl);
                return (
                  <div
                    key={cue.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      handleSeek(cue.startTimeSec);
                    }}
                    title={`${cue.label} @ ${cue.startTimeSec.toFixed(1)}s — ${cue.title}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: cue.muted
                        ? '#2A2A34'
                        : isReady
                          ? cue.color || (idx % 2 === 0 ? '#C6202F' : '#10B981')
                          : '#3E3E4A',
                    }}
                    className={`absolute top-1.5 bottom-1.5 rounded-sm px-1.5 flex items-center text-[10px] font-mono font-bold truncate transition-opacity ${
                      cue.muted ? 'opacity-35 text-[#888]' : 'opacity-90 text-white'
                    }`}
                  >
                    {cue.label}
                  </div>
                );
              })}

              {/* Playhead */}
              <div
                style={{
                  left: `${Math.max(0, Math.min(100, (currentTime / durationSec) * 100))}%`,
                }}
                className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_#fff] pointer-events-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
