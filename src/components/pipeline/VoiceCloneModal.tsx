import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Mic2, Square, Trash2, Upload, X } from 'lucide-react';
import type { ClonedVoiceProfile } from '../../types/pipeline';
import { VOICE_CLONE_MODELS } from '../../utils/voPresets';

interface VoiceCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingClones: ClonedVoiceProfile[];
  elevenLabsConfigured: boolean;
  falConfigured: boolean;
  onCreateClone: (payload: {
    name: string;
    description?: string;
    removeBackgroundNoise?: boolean;
    preferredMethod?: 'elevenlabs' | 'chatterbox';
    samples: Array<{ filename: string; dataUrl: string }>;
  }) => Promise<ClonedVoiceProfile>;
  onDeleteClone: (id: string) => Promise<void>;
  onSelectClone: (clone: ClonedVoiceProfile) => void;
}

export const VoiceCloneModal: React.FC<VoiceCloneModalProps> = ({
  isOpen,
  onClose,
  existingClones,
  elevenLabsConfigured,
  falConfigured,
  onCreateClone,
  onDeleteClone,
  onSelectClone,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preferredMethod, setPreferredMethod] = useState<'elevenlabs' | 'chatterbox'>(
    elevenLabsConfigured ? 'elevenlabs' : 'chatterbox'
  );
  const [removeBackgroundNoise, setRemoveBackgroundNoise] = useState(true);
  const [samples, setSamples] = useState<
    Array<{ id: string; filename: string; dataUrl: string; sizeKb: number }>
  >([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      setIsRecording(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    const next: typeof samples = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|webm)$/i.test(file.name)) {
        setErrorMsg(`Unsupported file "${file.name}". Upload MP3, WAV, M4A, OGG, or WebM audio.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(`Failed reading ${file.name}`));
        reader.readAsDataURL(file);
      });
      next.push({
        id: `smp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        filename: file.name,
        dataUrl,
        sizeKb: Math.round(file.size / 1024),
      });
    }
    setSamples((prev) => [...prev, ...next].slice(0, 5));
  };

  const startMicRecording = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          setSamples((prev) => [
            ...prev,
            {
              id: `rec-${Date.now()}`,
              filename: `mic-sample-${prev.length + 1}.webm`,
              dataUrl,
              sizeKb: Math.max(1, Math.round(blob.size / 1024)),
            },
          ]);
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      recordTimerRef.current = setInterval(() => {
        setRecordingSec((s) => s + 1);
      }, 1000);
    } catch {
      setErrorMsg('Microphone permission is needed to record a sample directly.');
    }
  };

  const stopMicRecording = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Enter a name for the cloned voice.');
      return;
    }
    if (samples.length === 0) {
      setErrorMsg('Upload or record at least one clean voice sample (5-30 seconds).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const created = await onCreateClone({
        name: name.trim(),
        description: description.trim(),
        removeBackgroundNoise,
        preferredMethod,
        samples: samples.map((s) => ({ filename: s.filename, dataUrl: s.dataUrl })),
      });
      setName('');
      setDescription('');
      setSamples([]);
      onSelectClone(created);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Voice cloning failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#E2E2E6] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E2E6] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#C6202F]/10 text-[#C6202F] flex items-center justify-center">
              <Mic2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111114]">
                Voice Cloning Studio
              </h2>
              <p className="text-[11px] text-[#5A5A66]">
                Clone any narrator or talent voice from a 10–30 second clean audio sample.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#6E6E7A] hover:text-[#111114] rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {errorMsg && (
            <div className="bg-[#C6202F]/10 border border-[#C6202F]/30 text-[#C6202F] text-xs px-3.5 py-2.5 rounded-lg">
              {errorMsg}
            </div>
          )}

          {/* Existing Cloned Voices */}
          {existingClones.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A66]">
                Your Cloned Voices ({existingClones.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {existingClones.map((clone) => (
                  <div
                    key={clone.id}
                    className="flex items-center justify-between gap-2 p-2.5 bg-[#FAFBFD] border border-[#E2E2E6] rounded-lg"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectClone(clone);
                        onClose();
                      }}
                      className="text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="text-xs font-bold text-[#111114] truncate">
                        {clone.name}
                      </div>
                      <div className="text-[10px] font-mono text-[#6E6E7A]">
                        {clone.method === 'elevenlabs'
                          ? `ElevenLabs ID: ${clone.elevenLabsVoiceId?.slice(0, 10)}...`
                          : 'Zero-Shot Chatterbox Clone'}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteClone(clone.id)}
                      className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                      title="Delete cloned voice"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Create New Clone Form */}
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A66]">
              Create New Cloned Voice
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {VOICE_CLONE_MODELS.map((m) => {
                const methodKey = m.id === 'elevenlabs_ivc' ? 'elevenlabs' : 'chatterbox';
                const disabled =
                  (methodKey === 'elevenlabs' && !elevenLabsConfigured) ||
                  (methodKey === 'chatterbox' && !falConfigured);
                const selected = preferredMethod === methodKey;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPreferredMethod(methodKey)}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      selected
                        ? 'border-[#C6202F] bg-[#C6202F]/5'
                        : 'border-[#E2E2E6] bg-white hover:border-[#891A23]'
                    } disabled:opacity-45 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#111114]">{m.label}</span>
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#111114] text-white">
                        {m.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5A5A66] mt-1 leading-snug">
                      {m.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#5A5A66] mb-1">
                  Voice Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Founder Studio Voice"
                  className="w-full px-3 py-2 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg focus:outline-none focus:border-[#C6202F]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#5A5A66] mb-1">
                  Character / Notes
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Warm baritone, clean booth mic"
                  className="w-full px-3 py-2 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg focus:outline-none focus:border-[#C6202F]"
                />
              </div>
            </div>

            {/* Audio Samples Capture */}
            <div className="border border-dashed border-[#D0D0D8] rounded-xl p-4 bg-[#FAFBFD] space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm"
                className="hidden"
                onChange={(e) => void handleFilesSelected(e.target.files)}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#111114]">
                    Reference Audio Samples ({samples.length}/5)
                  </div>
                  <p className="text-[11px] text-[#5A5A66]">
                    10–45 seconds of clean, dry solo speech yields the closest clone.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[#D8D8DF] hover:border-[#891A23] rounded-lg cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload Audio
                  </button>
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={stopMicRecording}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#C6202F] text-white rounded-lg cursor-pointer animate-pulse"
                    >
                      <Square className="w-3 h-3" />
                      Stop ({recordingSec}s)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startMicRecording()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#111114] text-white hover:bg-[#24242B] rounded-lg cursor-pointer"
                    >
                      <Mic className="w-3.5 h-3.5 text-[#C6202F]" />
                      Record Mic
                    </button>
                  )}
                </div>
              </div>

              {samples.length > 0 && (
                <div className="space-y-1.5">
                  {samples.map((smp) => (
                    <div
                      key={smp.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-[#E2E2E6] rounded-lg text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{smp.filename}</span>
                        <span className="text-[10px] font-mono text-[#6E6E7A]">
                          {smp.sizeKb} KB
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <audio src={smp.dataUrl} controls className="h-7 w-40" />
                        <button
                          type="button"
                          onClick={() =>
                            setSamples((prev) => prev.filter((item) => item.id !== smp.id))
                          }
                          className="p-1 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {preferredMethod === 'elevenlabs' && (
                <label className="inline-flex items-center gap-2 text-xs text-[#3A3A44] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeBackgroundNoise}
                    onChange={(e) => setRemoveBackgroundNoise(e.target.checked)}
                    className="accent-[#C6202F]"
                  />
                  Enable automatic background noise cleanup on samples
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-[#5A5A66] hover:text-[#111114] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || (!elevenLabsConfigured && !falConfigured)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mic2 className="w-3.5 h-3.5" />
                )}
                Clone &amp; Activate Voice
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
