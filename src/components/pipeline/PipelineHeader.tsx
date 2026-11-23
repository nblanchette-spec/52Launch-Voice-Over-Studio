import React, { useRef } from 'react';
import {
  ChevronDown,
  Download,
  Upload,
  Plus,
  Cpu,
  Trash2,
} from 'lucide-react';
import {
  PipelineProject,
  ProjectSummary,
} from '../../types/pipeline';
import type { LlmRoutingMode } from '../../utils/llmClient';

interface PipelineHeaderProps {
  projects: ProjectSummary[];
  activeProject: PipelineProject | null;
  onSelectProject: (id: string) => void;
  onStartNewProject: () => void;
  onDeleteProject: (id: string) => void;
  onDownloadBackup: () => void;
  onImportBackup: (file: File) => void;
  llmMode?: LlmRoutingMode;
  falConfigured?: boolean;
  geminiConfigured?: boolean;
  onChangeLlmMode?: (mode: LlmRoutingMode) => void;
}

export const PipelineHeader: React.FC<PipelineHeaderProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onStartNewProject,
  onDeleteProject,
  onDownloadBackup,
  onImportBackup,
  llmMode = 'auto',
  falConfigured = false,
  geminiConfigured = false,
  onChangeLlmMode,
}) => {
  const importInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E2E2E6]">
      {/* Thin 52Launch Red #5 top brand rule */}
      <div className="h-[3px] w-full bg-gradient-to-r from-[#C6202F] via-[#891A23] to-[#C6202F]" />

      {/* Top Row: 52Launch Wordmark, Script Session Selector, Primary Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src="/brand/wordmark-color.png"
              alt="fifty-two launch"
              className="h-6 w-auto object-contain"
            />
            <span
              className="hidden sm:inline-block h-4 w-[1.5px] bg-[#891A23]/40"
              aria-hidden="true"
            />
            <span className="hidden sm:inline-block text-xs font-semibold tracking-tight text-[#5A5A66] whitespace-nowrap font-display">
              Voice Over Studio
            </span>
          </div>

          <span className="text-[#D0D0D6]" aria-hidden="true">
            /
          </span>

          {/* Script Session Picker */}
          <div className="relative flex items-center">
            <select
              aria-label="Choose script session"
              value={activeProject?.id || ''}
              onChange={(e) => {
                if (e.target.value) {
                  onSelectProject(e.target.value);
                }
              }}
              className="appearance-none bg-[#F6F6F7] border border-[#D8D8DF] hover:border-[#891A23] text-[#111114] text-sm font-medium rounded-md pl-3 pr-8 py-1.5 focus:outline-none focus:border-[#C6202F] cursor-pointer max-w-[280px] truncate transition-colors"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.client} — {p.productName}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-[#5A5A66] pointer-events-none absolute right-2.5" />
          </div>

          <button
            type="button"
            onClick={onStartNewProject}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            New script
          </button>

          {activeProject && projects.length > 1 && (
            <button
              type="button"
              onClick={() => onDeleteProject(activeProject.id)}
              title="Delete current script session"
              className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] bg-white border border-[#D8D8DF] hover:border-[#C6202F] rounded-md transition-colors cursor-pointer"
              aria-label="Delete current script session"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onChangeLlmMode && (
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-md"
              title="Choose how script writing & translation routes between Google Gemini Direct and Gemini via Fal"
            >
              <Cpu className="w-3.5 h-3.5 text-[#891A23] shrink-0" />
              <span className="text-[11px] font-medium text-[#5A5A66] hidden md:inline">
                AI Engine:
              </span>
              <select
                aria-label="AI Engine routing mode"
                value={llmMode}
                onChange={(e) => onChangeLlmMode(e.target.value as LlmRoutingMode)}
                className="bg-transparent text-xs font-semibold text-[#111114] focus:outline-none cursor-pointer pr-1"
              >
                <option value="auto">
                  Auto (Gemini{falConfigured ? ' + Fal Backup' : ''})
                </option>
                <option value="fal_gemini" disabled={!falConfigured}>
                  Gemini via Fal{falConfigured ? '' : ' (Not configured)'}
                </option>
                <option value="google_direct" disabled={!geminiConfigured}>
                  Gemini Direct{geminiConfigured ? '' : ' (Not configured)'}
                </option>
              </select>
            </div>
          )}

          <input
            ref={importInputRef}
            type="file"
            accept=".52launch-backup,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onImportBackup(file);
                e.target.value = '';
              }
            }}
          />

          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3A3A44] bg-white border border-[#D8D8DF] hover:border-[#891A23] hover:text-[#111114] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import backup
          </button>

          {activeProject && (
            <button
              type="button"
              onClick={onDownloadBackup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3A3A44] bg-white border border-[#D8D8DF] hover:border-[#891A23] hover:text-[#111114] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Backup
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
