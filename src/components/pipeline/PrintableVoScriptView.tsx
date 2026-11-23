import React, { useState } from 'react';
import { ArrowLeft, Download, Loader2, Mic2, Printer } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PipelineProject } from '../../types/pipeline';

interface PrintableVoScriptViewProps {
  project: PipelineProject;
  onBack: () => void;
}

function sanitizePdfText(value: string, fallback = '—'): string {
  const cleaned = (value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, ' -- ')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .trim();
  return cleaned || fallback;
}

export const PrintableVoScriptView: React.FC<PrintableVoScriptViewProps> = ({
  project,
  onBack,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);

  const totalEstSec = project.voScript.reduce(
    (sum, line) => sum + (Number(line.durationSec) || 0),
    0
  );
  const renderedCount = project.voScript.filter((v) => Boolean(v.audioUrl)).length;

  const handleDownloadPdf = () => {
    setIsDownloading(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 16;
      const contentW = pageW - margin * 2;
      let y = 18;

      // Top red accent bar
      doc.setFillColor(198, 32, 47);
      doc.rect(0, 0, pageW, 3, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(198, 32, 47);
      doc.text('52LAUNCH VOICE OVER STUDIO', margin, y);
      y += 6;

      doc.setFontSize(18);
      doc.setTextColor(17, 17, 20);
      doc.text(
        sanitizePdfText(`${project.client} - ${project.product.name}`),
        margin,
        y
      );
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(90, 90, 102);
      const settings = project.voSettings;
      const metaLine = [
        `Engine: ${settings?.provider === 'elevenlabs' ? 'ElevenLabs' : 'Gemini TTS'} (${settings?.ttsModel || 'default'})`,
        `Voice: ${settings?.voiceName || 'Default'}`,
        `Tone: ${settings?.emotionalTone || 'Natural'}`,
        `Lines: ${project.voScript.length} (~${totalEstSec}s)`,
        `Exported: ${new Date().toLocaleDateString()}`,
      ].join('  |  ');
      doc.text(sanitizePdfText(metaLine), margin, y);
      y += 8;

      doc.setDrawColor(226, 226, 230);
      doc.line(margin, y, pageW - margin, y);
      y += 7;

      for (const line of project.voScript) {
        const spoken = `"${sanitizePdfText(line.line, '(Empty line)')}"`;
        const wrappedSpoken = doc.splitTextToSize(spoken, contentW - 10);
        const dirLine = sanitizePdfText(
          `${line.direction || 'Standard delivery'}${line.audioTags ? ` | ${line.audioTags}` : ''}`
        );
        const wrappedDir = doc.splitTextToSize(dirLine, contentW - 10);
        const cardH = 14 + wrappedSpoken.length * 4.6 + wrappedDir.length * 4 + 4;

        if (y + cardH > pageH - 16) {
          doc.addPage();
          y = 18;
        }

        doc.setFillColor(250, 250, 252);
        doc.setDrawColor(226, 226, 230);
        doc.roundedRect(margin, y, contentW, cardH, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(198, 32, 47);
        doc.text(
          sanitizePdfText(`${line.shotId}  |  ${line.speaker}`),
          margin + 5,
          y + 6.5
        );

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(90, 90, 102);
        doc.text(
          sanitizePdfText(
            `${line.emotionalTone || settings?.emotionalTone || ''} · ${line.durationSec || 4}s`
          ),
          pageW - margin - 5,
          y + 6.5,
          { align: 'right' }
        );

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(17, 17, 20);
        doc.text(wrappedSpoken, margin + 5, y + 12.5);

        const dirY = y + 12.5 + wrappedSpoken.length * 4.6 + 1;
        doc.setFontSize(8.2);
        doc.setTextColor(90, 90, 102);
        doc.text(wrappedDir, margin + 5, dirY);

        y += cardH + 4;
      }

      const slug =
        `${project.client}-${project.product.name}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'vo-script';
      doc.save(`${slug}-vo-script.pdf`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="max-w-[980px] mx-auto px-6 py-7 space-y-6">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E2E2E6]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to VO Studio
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Download VO Script PDF
          </button>
        </div>
      </div>

      {/* Document Card */}
      <div className="bg-white border border-[#E2E2E6] rounded-xl p-8 space-y-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2E2E6] pb-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#C6202F]">
              52Launch Voice Over Studio · Script Sheet
            </div>
            <h1 className="text-2xl font-bold text-[#111114] mt-1">
              {project.client} — {project.product.name}
            </h1>
            {project.product.description && (
              <p className="text-xs text-[#5A5A66] mt-1">
                {project.product.description}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-[#5A5A66] font-mono">
            <div>{project.voScript.length} Cues · ~{totalEstSec}s</div>
            <div>{renderedCount} / {project.voScript.length} Audio Ready</div>
            <div>{new Date().toLocaleDateString()}</div>
          </div>
        </div>

        {project.voSettings && (
          <div className="border border-[#E2C2C6] bg-[#FAF6F7] rounded-md p-4 flex flex-wrap items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-[#891A23]">
              <Mic2 className="w-4 h-4" />
              {project.voSettings.provider === 'elevenlabs' ? 'ElevenLabs' : 'Gemini TTS'}:{' '}
              {project.voSettings.voiceName}
            </span>
            <span>
              Model: <strong>{project.voSettings.ttsModel}</strong>
            </span>
            <span>
              Tone: <strong>{project.voSettings.emotionalTone}</strong>
            </span>
            <span>
              Speed: <strong>{project.voSettings.speed}x</strong>
            </span>
            <span>
              Language: <strong>{project.voSettings.language}</strong>
            </span>
          </div>
        )}

        {project.voScript.length === 0 ? (
          <p className="text-xs text-[#5A5A66] italic">
            Voiceover script has not been written yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-[#E2E2E6]">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-[#111114] text-white text-[10px] uppercase font-bold tracking-wider">
                  <th className="py-2 px-3">Cue</th>
                  <th className="py-2 px-3">Speaker</th>
                  <th className="py-2 px-3">Spoken Script Line</th>
                  <th className="py-2 px-3">Delivery &amp; Tone</th>
                  <th className="py-2 px-3">Est</th>
                  <th className="py-2 px-3">Audio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E2E6]">
                {project.voScript.map((line, idx) => (
                  <tr
                    key={line.id}
                    className={idx % 2 === 1 ? 'bg-[#FAFBFD]' : 'bg-white'}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-[#891A23]">
                      {line.shotId}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-[#111114]">
                      {line.speaker}
                    </td>
                    <td className="py-2.5 px-3 text-[#111114]">
                      &ldquo;{line.line}&rdquo;
                    </td>
                    <td className="py-2.5 px-3 text-[#5A5A66]">
                      {line.direction}
                      {line.emotionalTone ? ` · ${line.emotionalTone}` : ''}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                      {line.durationSec ? `${line.durationSec}s` : '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {line.audioUrl ? 'Synthesized' : 'Draft'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
