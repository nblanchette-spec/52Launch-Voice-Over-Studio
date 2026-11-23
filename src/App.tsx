import React, { useEffect, useState } from 'react';
import { Loader2, Mic2, Plus, X } from 'lucide-react';
import { PipelineProject, ProjectSummary } from './types/pipeline';
import { PipelineHeader } from './components/pipeline/PipelineHeader';
import { Step8VoStudio } from './components/pipeline/Step8VoStudio';
import { PrintableVoScriptView } from './components/pipeline/PrintableVoScriptView';
import {
  getLlmRoutingStatus,
  LlmRoutingMode,
  LlmRoutingStatus,
  setLlmRoutingMode,
} from './utils/llmClient';
import { parseJsonResponse } from './utils/safeFetch';

export default function App() {
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<PipelineProject | null>(null);
  const [showPrintable, setShowPrintable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmRoutingStatus | null>(null);

  // New script session modal state
  const [newScriptModalOpen, setNewScriptModalOpen] = useState(false);
  const [newClient, setNewClient] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete confirmation modal state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const fetchSummaries = async (): Promise<ProjectSummary[]> => {
    const resp = await fetch('/api/projects');
    const data = await parseJsonResponse<{ projects?: ProjectSummary[]; error?: string }>(
      resp,
      'Could not load scripts.'
    );
    if (!resp.ok) throw new Error(data.error || 'Could not load scripts.');
    const list: ProjectSummary[] = data.projects || [];
    setProjectSummaries(list);
    return list;
  };

  const loadProjectById = async (id: string) => {
    const resp = await fetch(`/api/projects/${id}`);
    const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
      resp,
      'Could not load script.'
    );
    if (!resp.ok) throw new Error(data.error || 'Could not load script.');
    setActiveProject(data.project);
    setShowPrintable(false);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await fetchSummaries();
        if (mounted && list.length > 0) {
          await loadProjectById(list[0].id);
        }
      } catch (err) {
        if (mounted) {
          showNotice(err instanceof Error ? err.message : 'Could not load saved scripts.');
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    void getLlmRoutingStatus()
      .then((status) => {
        if (mounted) setLlmStatus(status);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const handleChangeLlmMode = async (mode: LlmRoutingMode) => {
    try {
      const updated = await setLlmRoutingMode(mode);
      setLlmStatus(updated);
      const label =
        mode === 'fal_gemini'
          ? 'Gemini via Fal'
          : mode === 'google_direct'
            ? 'Gemini Direct'
            : 'Auto (Gemini + Fal Backup)';
      showNotice(`AI Engine switched to ${label}.`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Could not switch AI Engine mode.');
    }
  };

  const handleUpdateProject = async (updated: PipelineProject) => {
    setActiveProject(updated);
    const resp = await fetch(`/api/projects/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: updated }),
    });
    const data = await parseJsonResponse<{ project?: PipelineProject; error?: string }>(
      resp,
      'Could not save script.'
    );
    if (!resp.ok) {
      showNotice(data.error || 'Could not save script changes.');
      return;
    }
    const saved = data.project || updated;
    setActiveProject(saved);
    setProjectSummaries((prev) =>
      prev.map((s) =>
        s.id === saved.id
          ? {
              ...s,
              client: saved.client,
              productName: saved.product.name,
              updatedAt: saved.updatedAt,
              voReadyCount: saved.voScript.filter((v) => Boolean(v.audioUrl)).length,
              totalVoCount: saved.voScript.length,
            }
          : s
      )
    );
  };

  const handleProjectUpdated = (updated: PipelineProject) => {
    setActiveProject(updated);
    setProjectSummaries((prev) =>
      prev.map((s) =>
        s.id === updated.id
          ? {
              ...s,
              client: updated.client,
              productName: updated.product.name,
              updatedAt: updated.updatedAt,
              voReadyCount: updated.voScript.filter((v) => Boolean(v.audioUrl)).length,
              totalVoCount: updated.voScript.length,
            }
          : s
      )
    );
  };

  const handleOpenNewScriptModal = () => {
    setNewClient('');
    setNewTitle('');
    setNewDescription('');
    setCreateError(null);
    setNewScriptModalOpen(true);
  };

  const handleCreateScript = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      setCreateError('Please enter a script title.');
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const resp = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: newClient.trim() || '52Launch',
          product: {
            name: title,
            description: newDescription.trim(),
          },
          voSettings: activeProject?.voSettings,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
        resp,
        'Could not create script.'
      );
      if (!resp.ok) throw new Error(data.error || 'Could not create script.');

      setActiveProject(data.project);
      setShowPrintable(false);
      setNewScriptModalOpen(false);
      await fetchSummaries();
      showNotice(`Created "${data.project.product.name}".`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create script.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      const resp = await fetch(`/api/projects/${deleteTargetId}`, {
        method: 'DELETE',
      });
      const data = await parseJsonResponse<{ error?: string }>(
        resp,
        'Could not delete script.'
      ).catch(() => ({ error: 'Could not delete script.' }));
      if (!resp.ok) {
        showNotice(data.error || 'Could not delete script.');
        return;
      }

      const remaining = await fetchSummaries();
      if (activeProject?.id === deleteTargetId) {
        if (remaining.length > 0) {
          await loadProjectById(remaining[0].id);
        } else {
          setActiveProject(null);
        }
      }
      setDeleteTargetId(null);
      showNotice('Script session removed.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadBackup = () => {
    if (!activeProject) return;
    window.location.href = `/api/projects/${activeProject.id}/backup`;
    showNotice('Downloading script backup...');
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const resp = await fetch('/api/projects/import-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
        resp,
        'Could not import script backup.'
      );
      if (!resp.ok) throw new Error(data.error || 'Could not import script backup.');
      await fetchSummaries();
      await loadProjectById(data.project.id);
      showNotice(`Imported "${data.project.product.name}".`);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'That file is not a valid script backup.'
      );
    }
  };

  const targetSummary = deleteTargetId
    ? projectSummaries.find((p) => p.id === deleteTargetId)
    : null;

  return (
    <div className="min-h-screen bg-[#F6F6F7] text-[#111114] flex flex-col">
      <PipelineHeader
        projects={projectSummaries}
        activeProject={activeProject}
        onSelectProject={(id) => {
          void loadProjectById(id).catch((err) =>
            showNotice(err instanceof Error ? err.message : 'Could not load script.')
          );
        }}
        onStartNewProject={handleOpenNewScriptModal}
        onDeleteProject={(id) => setDeleteTargetId(id)}
        onDownloadBackup={handleDownloadBackup}
        onImportBackup={(f) => void handleImportBackup(f)}
        llmMode={llmStatus?.mode}
        falConfigured={llmStatus?.falConfigured}
        geminiConfigured={llmStatus?.geminiConfigured}
        onChangeLlmMode={(mode) => void handleChangeLlmMode(mode)}
      />

      {notice && (
        <div className="no-print fixed bottom-5 right-5 z-50 bg-[#111114] border border-[#C6202F] text-xs text-white px-4 py-2.5 brand-corner-sm shadow-xl">
          {notice}
        </div>
      )}

      <main className="flex-1 min-w-0 overflow-y-auto print-only-full">
        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2.5 text-sm text-[#5A5A66]">
            <Loader2 className="w-5 h-5 animate-spin text-[#C6202F]" />
            Loading Voice Over Studio...
          </div>
        ) : !activeProject ? (
          <div className="max-w-lg mx-auto my-20 bg-white border border-[#E2E2E6] rounded-xl p-8 text-center space-y-4 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-[#C6202F]/10 text-[#C6202F] flex items-center justify-center mx-auto">
              <Mic2 className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-[#111114]">
              Create your first voiceover script
            </h1>
            <p className="text-xs text-[#5A5A66] leading-relaxed">
              Write a fresh script with Gemini, paste or upload your own copy, and audition or render voices with Gemini TTS and ElevenLabs.
            </p>
            <button
              type="button"
              onClick={handleOpenNewScriptModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New script
            </button>
          </div>
        ) : showPrintable ? (
          <PrintableVoScriptView
            project={activeProject}
            onBack={() => setShowPrintable(false)}
          />
        ) : (
          <Step8VoStudio
            project={activeProject}
            onUpdateProject={handleUpdateProject}
            onProjectUpdated={handleProjectUpdated}
            onPreviewPdf={() => setShowPrintable(true)}
          />
        )}
      </main>

      {/* New Script Modal */}
      {newScriptModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E2E6] rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E2E6]">
              <div>
                <h2 className="text-base font-bold text-[#111114]">New Script Session</h2>
                <p className="text-[11px] text-[#5A5A66]">
                  Start a standalone script for Gemini &amp; ElevenLabs voiceover.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewScriptModalOpen(false)}
                className="p-1.5 text-[#6E6E7A] hover:text-[#111114] rounded-md cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateScript(e)} className="p-5 space-y-4">
              {createError && (
                <div className="bg-[#C6202F]/10 border border-[#C6202F]/30 text-[#C6202F] text-xs px-3 py-2 rounded-lg">
                  {createError}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5A5A66] mb-1">
                  Script Title *
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Q4 Brand Anthem 30s"
                  className="w-full px-3 py-2 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg focus:outline-none focus:border-[#C6202F]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5A5A66] mb-1">
                  Client / Brand
                </label>
                <input
                  type="text"
                  value={newClient}
                  onChange={(e) => setNewClient(e.target.value)}
                  placeholder="e.g. 52Launch (optional)"
                  className="w-full px-3 py-2 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg focus:outline-none focus:border-[#C6202F]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5A5A66] mb-1">
                  Context / Notes
                </label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Optional summary or creative direction..."
                  className="w-full px-3 py-2 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg focus:outline-none focus:border-[#C6202F] resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewScriptModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-[#5A5A66] hover:text-[#111114] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
                >
                  {isCreating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Create Script
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E2E2E6] rounded-xl w-full max-w-sm shadow-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-[#111114]">Delete Script Session?</h2>
            <p className="text-xs text-[#5A5A66] leading-relaxed">
              This will permanently remove{' '}
              <strong className="text-[#111114]">
                {targetSummary
                  ? `${targetSummary.client} — ${targetSummary.productName}`
                  : 'this script session'}
              </strong>{' '}
              and its synthesized audio files.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteTargetId(null)}
                className="px-3.5 py-2 text-xs font-medium text-[#5A5A66] hover:text-[#111114] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
