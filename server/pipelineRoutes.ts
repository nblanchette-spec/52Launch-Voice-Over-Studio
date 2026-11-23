import { Router } from 'express';
import path from 'path';
import { Type } from '@google/genai';
import {
  deleteProject,
  exportProjectBackupBundle,
  getProject,
  getProjectAssetsDir,
  importProjectBackupBundle,
  isSupportedAssetFilename,
  listProjects,
  saveBufferAsset,
  saveDataUrlAsset,
  saveProject,
} from './projectStore.ts';
import type {
  ElevenLabsTtsModel,
  GeminiTtsModel,
  PipelineProject,
  ScriptBriefConfig,
  VoiceProvider,
  VoScriptLine,
  VoStudioSettings,
} from '../src/types/pipeline.ts';
import {
  DEFAULT_VO_SETTINGS,
  EMOTIONAL_TONES,
} from '../src/utils/voPresets.ts';
import {
  synthesizeWithGeminiTTS,
  VALID_GEMINI_VOICES,
} from './voxcraftTts.ts';
import {
  listElevenLabsVoices,
  synthesizeWithElevenLabsTTS,
  VALID_ELEVENLABS_MODELS,
} from './elevenLabsTts.ts';
import {
  extractReadableTextFromPdfBuffer,
  formatLlmError,
  generateJsonWithGeminiOrFal,
  getGeminiClient,
  getLlmStatus,
  type LlmRoutingMode,
  setLlmMode,
} from './llmHelpers.ts';

function parseRawScriptDeterministic(params: {
  rawText: string;
  defaultSpeaker: string;
  settings: VoStudioSettings;
}): VoScriptLine[] {
  const { rawText, defaultSpeaker, settings } = params;
  const cleaned = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!cleaned) return [];

  // Strip SRT/VTT sequence numbers and timestamp lines if user uploads subtitles
  const linesWithoutSrt = cleaned
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^WEBVTT$/i.test(t)) return false;
      if (/^\d+$/.test(t)) return false;
      if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(t)) {
        return false;
      }
      return true;
    })
    .join('\n');

  // Prefer paragraph blocks if double newlines exist, otherwise individual non-empty lines
  const rawBlocks = /\n\s*\n/.test(linesWithoutSrt)
    ? linesWithoutSrt
        .split(/\n\s*\n+/)
        .map((b) => b.replace(/\n+/g, ' ').trim())
        .filter(Boolean)
    : linesWithoutSrt
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

  return rawBlocks.map((block, idx) => {
    let speaker = defaultSpeaker || 'Narrator';
    let spokenText = block;
    let direction = 'warm, clear studio delivery';

    // Match optional cue/speaker prefix like "[C01] Narrator: Hello..." or "Narrator: Hello..."
    const speakerMatch = block.match(
      /^(?:\[[^\]]+\]\s*)?([A-Za-z][A-Za-z0-9 ._-]{1,28}):\s+(.+)$/
    );
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      spokenText = speakerMatch[2].trim();
    }

    // Match optional parenthetical stage direction at start, e.g. "(warmly) Hello..."
    const dirMatch = spokenText.match(/^\(([^)]{2,60})\)\s+(.+)$/);
    if (dirMatch) {
      direction = dirMatch[1].trim();
      spokenText = dirMatch[2].trim();
    }

    const words = spokenText.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(2, Math.round(words / 2.5));
    const cueId = `C${String(idx + 1).padStart(2, '0')}`;

    return {
      id: `vo-${Date.now()}-${idx}`,
      shotId: cueId,
      speaker,
      direction,
      line: spokenText,
      audioTags: 'clear studio delivery',
      emotionalTone: settings.emotionalTone,
      emotionIntensity: settings.emotionIntensity,
      provider: settings.provider,
      voiceName: settings.voiceName,
      ttsModel: settings.ttsModel,
      speed: settings.speed,
      pitch: settings.pitch,
      language: settings.language,
      pauseAfter: settings.pauseAfter,
      audioUrl: null,
      durationSec,
      targetWords: Math.max(3, Math.round(durationSec * 2.5)),
    };
  });
}

export function createPipelineRouter(): Router {
  const router = Router();

  // List all saved VO projects/scripts
  router.get('/projects', async (_req, res) => {
    try {
      const summaries = await listProjects();
      res.json({ projects: summaries });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not list scripts.',
      });
    }
  });

  // Get single full project
  router.get('/projects/:id', async (req, res) => {
    try {
      const project = await getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: 'Script project not found.' });
      }
      res.json({ project });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not load script project.',
      });
    }
  });

  // AI Routing Status & Mode Control
  router.get('/pipeline/llm-status', (_req, res) => {
    res.json(getLlmStatus());
  });

  router.post('/pipeline/llm-mode', (req, res) => {
    const mode = req.body?.mode as LlmRoutingMode | undefined;
    if (mode !== 'auto' && mode !== 'fal_gemini' && mode !== 'google_direct') {
      return res.status(400).json({ error: 'Invalid AI routing mode.' });
    }
    setLlmMode(mode);
    res.json(getLlmStatus());
  });

  // List curated + live ElevenLabs voices (if ELEVENLABS_API_KEY is set)
  router.get('/pipeline/elevenlabs-voices', async (_req, res) => {
    try {
      const result = await listElevenLabsVoices();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error ? err.message : 'Could not load ElevenLabs voices.',
      });
    }
  });

  // Create new standalone VO script project
  router.post('/projects', async (req, res) => {
    try {
      const { client, product, scriptBrief, voSettings } = req.body as {
        client?: string;
        product?: { name?: string; description?: string };
        scriptBrief?: ScriptBriefConfig;
        voSettings?: Partial<VoStudioSettings>;
      };

      const projectName = String(product?.name || 'Untitled Voiceover').trim();
      const clientName = String(client || '52Launch').trim();

      const slug = projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
      const id = `${slug || 'vo-script'}-${Date.now().toString(36)}`;
      const now = new Date().toISOString();

      const project: PipelineProject = {
        id,
        createdAt: now,
        updatedAt: now,
        client: clientName,
        product: {
          name: projectName,
          description: String(product?.description || '').trim(),
        },
        scriptBrief,
        voSettings: {
          ...DEFAULT_VO_SETTINGS,
          ...(voSettings || {}),
        },
        voScript: [],
        voHasGenerated: false,
        voManuallyEdited: false,
        generationLog: [],
      };

      const saved = await saveProject(project);
      res.json({ project: saved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not create script project.',
      });
    }
  });

  // Update full project state
  router.put('/projects/:id', async (req, res) => {
    try {
      const existing = await getProject(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const incoming = req.body.project as PipelineProject;
      if (!incoming) {
        return res.status(400).json({ error: 'Missing project payload.' });
      }
      const saved = await saveProject({ ...incoming, id: req.params.id });
      res.json({ project: saved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not save project.',
      });
    }
  });

  // Delete project
  router.delete('/projects/:id', async (req, res) => {
    try {
      await deleteProject(req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not delete project.',
      });
    }
  });

  // Upload asset
  router.post('/projects/:id/assets', async (req, res) => {
    try {
      const { dataUrl, prefix } = req.body;
      if (!dataUrl) {
        return res.status(400).json({ error: 'Missing asset data.' });
      }
      const saved = await saveDataUrlAsset(
        req.params.id,
        dataUrl,
        typeof prefix === 'string' && prefix.trim() ? prefix : 'vo'
      );
      res.json(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not upload asset.';
      const isClientError =
        msg.includes('Unsupported') || msg.includes('Invalid file upload format');
      res.status(isClientError ? 400 : 500).json({ error: msg });
    }
  });

  // Serve project asset (WAV / MP3 / etc.)
  router.get('/projects/:id/assets/:filename', (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    if (safeFilename !== req.params.filename || !isSupportedAssetFilename(safeFilename)) {
      return res.status(400).json({ error: 'Unsupported asset filename.' });
    }
    const fullPath = path.join(getProjectAssetsDir(req.params.id), safeFilename);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(fullPath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Asset not found.' });
      }
    });
  });

  // Download portable project backup
  router.get('/projects/:id/backup', async (req, res) => {
    try {
      const bundle = await exportProjectBackupBundle(req.params.id);
      const safeSlug = bundle.project.id || 'vo-script';
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeSlug}.52launch-backup"`
      );
      res.send(JSON.stringify(bundle, null, 2));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not export backup.',
      });
    }
  });

  // Import project backup
  router.post('/projects/import-backup', async (req, res) => {
    try {
      const imported = await importProjectBackupBundle(req.body);
      res.json({ project: imported });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Could not import project backup.',
      });
    }
  });

  // Standalone VO Script Generator (Gemini Direct or Gemini via Fal)
  router.post('/pipeline/vo-script', async (req, res) => {
    try {
      const {
        projectId,
        topicPrompt,
        productOrBrand,
        targetAudience,
        speakerName,
        targetDurationSec,
        lineCount,
        toneNote,
        language,
      } = req.body as {
        projectId: string;
        topicPrompt?: string;
        productOrBrand?: string;
        targetAudience?: string;
        speakerName?: string;
        targetDurationSec?: number;
        lineCount?: number;
        toneNote?: string;
        language?: string;
      };

      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Script project not found.' });
      }

      const activeSettings: VoStudioSettings = {
        ...DEFAULT_VO_SETTINGS,
        ...(project.voSettings || {}),
      };

      const brief: ScriptBriefConfig = {
        topicPrompt:
          topicPrompt?.trim() ||
          project.scriptBrief?.topicPrompt ||
          project.product.description ||
          `Commercial voiceover script for ${project.product.name}`,
        productOrBrand:
          productOrBrand?.trim() ||
          project.scriptBrief?.productOrBrand ||
          project.product.name ||
          project.client,
        targetAudience:
          targetAudience?.trim() ||
          project.scriptBrief?.targetAudience ||
          'General commercial audience',
        speakerName:
          speakerName?.trim() ||
          project.scriptBrief?.speakerName ||
          'Narrator',
        targetDurationSec: Math.max(
          5,
          Math.min(300, Number(targetDurationSec || project.scriptBrief?.targetDurationSec || 30))
        ),
        lineCount: Math.max(
          1,
          Math.min(20, Number(lineCount || project.scriptBrief?.lineCount || 5))
        ),
        toneNote:
          toneNote?.trim() ||
          project.scriptBrief?.toneNote ||
          activeSettings.emotionalTone,
      };

      const targetLang = language || activeSettings.language || 'en-US';
      const toneList = EMOTIONAL_TONES.map((t) => `"${t.id}"`).join(', ');

      const prompt = `You are a Commercial Voiceover Director & Copywriter at 52Launch.
Write a timed, performance-ready Voiceover Script with ${brief.lineCount} distinct cue lines totaling approximately ${brief.targetDurationSec} seconds (~2.5 spoken words per second).

PROJECT BRIEF:
- Brand / Product / Title: ${brief.productOrBrand}
- Topic / Creative Prompt: ${brief.topicPrompt}
- Target Audience: ${brief.targetAudience}
- Primary Speaker: ${brief.speakerName}
- Tone & Delivery Goal: ${brief.toneNote}
- Target Language: ${targetLang}

STRICT RULES:
1. Return exactly ${brief.lineCount} lines with cue IDs "C01", "C02", etc.
2. Respect the ~2.5 words per second pacing budget for each cue's "durationSec" so the spoken line fits naturally.
3. Use natural contractions, conversational cadence, and clean punctuation (commas, em-dashes, ellipses) for natural breathing.
4. Build a clear emotional arc across the script rather than making every line sound identical.
5. For every line, provide plain-English vocal direction in "direction", and performance tags in "audioTags".
6. Pick "emotionalTone" strictly from this exact list: ${toneList}.
7. Set "emotionIntensity" between 0.35 and 0.95, "durationSec" as an integer seconds estimate, and "pauseAfter" between 0.15 and 0.8.`;

      const llmResult = await generateJsonWithGeminiOrFal<
        Array<Partial<VoScriptLine> & { durationSec?: number }>
      >({
        prompt,
        thinkingLow: true,
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              shotId: { type: Type.STRING },
              speaker: { type: Type.STRING },
              direction: { type: Type.STRING },
              line: { type: Type.STRING },
              audioTags: { type: Type.STRING },
              emotionalTone: { type: Type.STRING },
              emotionIntensity: { type: Type.NUMBER },
              pauseAfter: { type: Type.NUMBER },
              durationSec: { type: Type.NUMBER },
            },
            required: [
              'shotId',
              'speaker',
              'direction',
              'line',
              'audioTags',
              'emotionalTone',
              'emotionIntensity',
              'pauseAfter',
              'durationSec',
            ],
          },
        },
        jsonSchemaHint: `[{ "shotId": "C01", "speaker": "Narrator", "direction": "string", "line": "string", "audioTags": "string", "emotionalTone": "Warm & Friendly", "emotionIntensity": 0.8, "pauseAfter": 0.35, "durationSec": 5 }]`,
      });

      const parsed = llmResult.data;
      const voScript: VoScriptLine[] = (Array.isArray(parsed) ? parsed : [])
        .filter((item) => Boolean(item.line && String(item.line).trim()))
        .map((item, idx) => {
          const spoken = String(item.line || '').trim();
          const words = spoken.split(/\s+/).filter(Boolean).length;
          const durationSec = Math.max(
            2,
            Math.round(Number(item.durationSec) || words / 2.5)
          );
          return {
            id: `vo-${Date.now()}-${idx}`,
            shotId: String(item.shotId || `C${String(idx + 1).padStart(2, '0')}`),
            speaker: String(item.speaker || brief.speakerName || 'Narrator').trim(),
            direction: String(item.direction || '').trim(),
            line: spoken,
            audioTags: String(item.audioTags || '').trim(),
            emotionalTone: String(item.emotionalTone || activeSettings.emotionalTone),
            emotionIntensity: Math.max(
              0.1,
              Math.min(1.0, Number(item.emotionIntensity) || 0.8)
            ),
            provider: activeSettings.provider,
            voiceName: activeSettings.voiceName,
            ttsModel: activeSettings.ttsModel,
            speed: activeSettings.speed,
            pitch: activeSettings.pitch,
            language: targetLang,
            pauseAfter: Math.max(0.1, Math.min(2.0, Number(item.pauseAfter) || 0.35)),
            audioUrl: null,
            durationSec,
            targetWords: Math.max(3, Math.round(durationSec * 2.5)),
          };
        });

      const nextProject: PipelineProject = {
        ...project,
        product: {
          ...project.product,
          name: brief.productOrBrand || project.product.name,
        },
        scriptBrief: brief,
        voScript,
        voHasGenerated: true,
        voManuallyEdited: false,
        voSettings: activeSettings,
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'VO Script',
            model: llmResult.modelUsed,
            prompt: `Wrote ${voScript.length} timed VO lines for ${brief.productOrBrand}`,
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({ project: saved });
    } catch (err) {
      res.status(500).json({
        error: formatLlmError(err, 'Could not generate VO script.'),
      });
    }
  });

  // Paste or Upload a Script (.txt, .md, .srt, .vtt, .csv, .pdf)
  router.post('/pipeline/vo-import-script', async (req, res) => {
    try {
      const {
        projectId,
        rawText,
        pdfBase64,
        filename,
        useAiEnhance,
        defaultSpeaker,
        replaceExisting,
      } = req.body as {
        projectId: string;
        rawText?: string;
        pdfBase64?: string;
        filename?: string;
        useAiEnhance?: boolean;
        defaultSpeaker?: string;
        replaceExisting?: boolean;
      };

      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Script project not found.' });
      }

      let extractedText = (rawText || '').trim();
      if (!extractedText && pdfBase64) {
        const cleanB64 = pdfBase64.replace(/^data:[^,]*;base64,/, '');
        const buf = Buffer.from(cleanB64, 'base64');
        extractedText = extractReadableTextFromPdfBuffer(buf, 30000);
      }

      if (!extractedText) {
        return res
          .status(400)
          .json({ error: 'Paste a script or upload a readable text/PDF script file.' });
      }

      const activeSettings: VoStudioSettings = {
        ...DEFAULT_VO_SETTINGS,
        ...(project.voSettings || {}),
      };
      const speakerFallback = defaultSpeaker?.trim() || 'Narrator';

      let importedLines: VoScriptLine[] = [];
      let modelUsed = 'Direct Parser';

      if (useAiEnhance) {
        const toneList = EMOTIONAL_TONES.map((t) => `"${t.id}"`).join(', ');
        const prompt = `You are a Voiceover Script Supervisor.
Convert the pasted/uploaded script below into clean, studio-ready VO cue lines WITHOUT rewriting or altering the spoken words unless fixing obvious formatting/timestamp clutter (like SRT timecodes).
Split naturally by speaker change or paragraph/sentence beat.
For each cue:
- shotId: "C01", "C02", ...
- speaker: speaker name if labeled in the script, otherwise "${speakerFallback}"
- direction: brief plain-English vocal delivery direction
- line: the exact spoken text
- audioTags: concise vocal note
- emotionalTone: strictly one of ${toneList}
- emotionIntensity: 0.35 to 0.95
- pauseAfter: 0.2 to 0.8 seconds
- durationSec: integer estimate (~wordCount / 2.5, min 2)

RAW SCRIPT (${filename || 'pasted text'}):
${extractedText.slice(0, 24000)}`;

        const llmResult = await generateJsonWithGeminiOrFal<
          Array<Partial<VoScriptLine> & { durationSec?: number }>
        >({
          prompt,
          thinkingLow: true,
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                shotId: { type: Type.STRING },
                speaker: { type: Type.STRING },
                direction: { type: Type.STRING },
                line: { type: Type.STRING },
                audioTags: { type: Type.STRING },
                emotionalTone: { type: Type.STRING },
                emotionIntensity: { type: Type.NUMBER },
                pauseAfter: { type: Type.NUMBER },
                durationSec: { type: Type.NUMBER },
              },
              required: [
                'shotId',
                'speaker',
                'direction',
                'line',
                'audioTags',
                'emotionalTone',
                'emotionIntensity',
                'pauseAfter',
                'durationSec',
              ],
            },
          },
          jsonSchemaHint: `[{ "shotId": "C01", "speaker": "Narrator", "direction": "string", "line": "string", "audioTags": "string", "emotionalTone": "Warm & Friendly", "emotionIntensity": 0.8, "pauseAfter": 0.35, "durationSec": 5 }]`,
        });

        modelUsed = llmResult.modelUsed;
        importedLines = (Array.isArray(llmResult.data) ? llmResult.data : [])
          .filter((item) => Boolean(item.line && String(item.line).trim()))
          .map((item, idx) => {
            const spoken = String(item.line || '').trim();
            const words = spoken.split(/\s+/).filter(Boolean).length;
            const durationSec = Math.max(
              2,
              Math.round(Number(item.durationSec) || words / 2.5)
            );
            return {
              id: `vo-${Date.now()}-${idx}`,
              shotId: String(item.shotId || `C${String(idx + 1).padStart(2, '0')}`),
              speaker: String(item.speaker || speakerFallback).trim(),
              direction: String(item.direction || 'clear studio delivery').trim(),
              line: spoken,
              audioTags: String(item.audioTags || 'clear studio delivery').trim(),
              emotionalTone: String(item.emotionalTone || activeSettings.emotionalTone),
              emotionIntensity: Math.max(
                0.1,
                Math.min(1.0, Number(item.emotionIntensity) || 0.8)
              ),
              provider: activeSettings.provider,
              voiceName: activeSettings.voiceName,
              ttsModel: activeSettings.ttsModel,
              speed: activeSettings.speed,
              pitch: activeSettings.pitch,
              language: activeSettings.language,
              pauseAfter: Math.max(
                0.1,
                Math.min(2.0, Number(item.pauseAfter) || activeSettings.pauseAfter)
              ),
              audioUrl: null,
              durationSec,
              targetWords: Math.max(3, Math.round(durationSec * 2.5)),
            };
          });
      } else {
        importedLines = parseRawScriptDeterministic({
          rawText: extractedText,
          defaultSpeaker: speakerFallback,
          settings: activeSettings,
        });
      }

      if (importedLines.length === 0) {
        return res
          .status(400)
          .json({ error: 'No spoken lines could be extracted from the provided script.' });
      }

      const finalLines =
        replaceExisting === false
          ? [...project.voScript, ...importedLines].map((item, idx) => ({
              ...item,
              shotId: item.shotId || `C${String(idx + 1).padStart(2, '0')}`,
            }))
          : importedLines;

      const nextProject: PipelineProject = {
        ...project,
        voScript: finalLines,
        voHasGenerated: true,
        voManuallyEdited: true,
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Import Script',
            model: modelUsed,
            prompt: `Imported ${importedLines.length} lines${filename ? ` from ${filename}` : ''}`,
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({ project: saved, importedCount: importedLines.length });
    } catch (err) {
      res.status(500).json({
        error: formatLlmError(err, 'Could not import script.'),
      });
    }
  });

  // Audition a Gemini or ElevenLabs voice (no project mutation)
  router.post('/pipeline/vo-audition', async (req, res) => {
    try {
      const {
        text,
        provider = 'gemini',
        voiceName,
        emotionalTone,
        emotionIntensity,
        ttsModel,
        language,
        stylePrompt,
        speed,
        elevenLabsStability,
        elevenLabsSimilarityBoost,
        elevenLabsStyle,
      } = req.body as {
        text?: string;
        provider?: VoiceProvider;
        voiceName?: string;
        emotionalTone?: string;
        emotionIntensity?: number;
        ttsModel?: string;
        language?: string;
        stylePrompt?: string;
        speed?: number;
        elevenLabsStability?: number;
        elevenLabsSimilarityBoost?: number;
        elevenLabsStyle?: number;
      };

      const sampleText =
        (text && text.trim()) ||
        'Designed for quiet precision when every second counts.';

      if (provider === 'elevenlabs') {
        const elModel: ElevenLabsTtsModel = VALID_ELEVENLABS_MODELS.includes(
          ttsModel as ElevenLabsTtsModel
        )
          ? (ttsModel as ElevenLabsTtsModel)
          : 'eleven_v3';
        const tts = await synthesizeWithElevenLabsTTS({
          text: sampleText,
          voice: voiceName,
          model: elModel,
          emotionalTone,
          emotionIntensity,
          speed,
          language,
          stability: elevenLabsStability,
          similarityBoost: elevenLabsSimilarityBoost,
          style: elevenLabsStyle,
        });

        return res.json({
          audioBase64: tts.audioBase64,
          mimeType: tts.mimeType,
          voice: tts.voice,
          model: tts.model,
          provider: 'elevenlabs',
          styleDirective: tts.styleDirective,
        });
      }

      const geminiModel: GeminiTtsModel =
        ttsModel === 'gemini-3.8-flash-tts'
          ? 'gemini-3.8-flash-tts'
          : 'gemini-3.8-flash-lite-tts';

      const ai = getGeminiClient();
      const tts = await synthesizeWithGeminiTTS(ai, {
        text: sampleText,
        voice: voiceName,
        model: geminiModel,
        emotionalTone,
        emotionIntensity,
        language,
        stylePrompt,
      });

      res.json({
        audioBase64: tts.audioBase64,
        mimeType: tts.mimeType,
        voice: tts.voice,
        model: tts.model,
        provider: 'gemini',
        styleDirective: tts.styleDirective,
      });
    } catch (err) {
      res.status(500).json({
        error: formatLlmError(
          err,
          'Could not audition voice. Verify GEMINI_API_KEY, ELEVENLABS_API_KEY, or FAL_KEY in the server environment variables.'
        ),
      });
    }
  });

  // Synthesize and persist Gemini or ElevenLabs audio for a VO line
  router.post('/pipeline/vo-generate', async (req, res) => {
    try {
      const {
        projectId,
        lineId,
        line,
        direction,
        speaker,
        audioTags,
        emotionalTone,
        emotionIntensity,
        provider,
        voiceName,
        speed,
        pitch,
        language,
        pauseAfter,
        ttsModel,
        stylePrompt,
        skipPitchText,
        skipSpeedText,
        elevenLabsStability,
        elevenLabsSimilarityBoost,
        elevenLabsStyle,
        voSettings,
      } = req.body as {
        projectId: string;
        lineId: string;
        line?: string;
        direction?: string;
        speaker?: string;
        audioTags?: string;
        emotionalTone?: string;
        emotionIntensity?: number;
        provider?: VoiceProvider;
        voiceName?: string;
        speed?: number;
        pitch?: number;
        language?: string;
        pauseAfter?: number;
        ttsModel?: string;
        stylePrompt?: string;
        skipPitchText?: boolean;
        skipSpeedText?: boolean;
        elevenLabsStability?: number;
        elevenLabsSimilarityBoost?: number;
        elevenLabsStyle?: number;
        voSettings?: VoStudioSettings;
      };

      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      const targetLine = project.voScript.find((v) => v.id === lineId);
      if (!targetLine) {
        return res.status(404).json({ error: 'VO line not found.' });
      }

      const spokenText = (line ?? targetLine.line).trim();
      if (!spokenText) {
        return res
          .status(400)
          .json({ error: 'Enter spoken VO text before generating audio.' });
      }

      const activeProvider: VoiceProvider =
        provider ||
        targetLine.provider ||
        project.voSettings?.provider ||
        'gemini';

      const activeTone =
        emotionalTone ||
        targetLine.emotionalTone ||
        project.voSettings?.emotionalTone ||
        'Warm & Friendly';
      const activeIntensity =
        emotionIntensity ??
        targetLine.emotionIntensity ??
        project.voSettings?.emotionIntensity ??
        0.85;
      const activeSpeed =
        speed ?? targetLine.speed ?? project.voSettings?.speed ?? 1.0;
      const activePitch =
        pitch ?? targetLine.pitch ?? project.voSettings?.pitch ?? 1.0;
      const activeLanguage =
        language ||
        targetLine.language ||
        project.voSettings?.language ||
        'en-US';
      const activeDirection = (direction ?? targetLine.direction ?? '').trim();
      const activePauseAfter = pauseAfter ?? targetLine.pauseAfter ?? 0.35;

      let audioBuffer: Buffer;
      let audioBase64: string;
      let mimeType: string;
      let assetExt: 'wav' | 'mp3';
      let resolvedVoice: string;
      let resolvedModel: string;
      let styleDirective: string;

      if (activeProvider === 'elevenlabs') {
        const elVoice =
          voiceName ||
          targetLine.voiceName ||
          project.voSettings?.elevenLabsVoiceId ||
          project.voSettings?.voiceName ||
          '21m00Tcm4TlvDq8ikWAM';
        const requestedModel =
          ttsModel || targetLine.ttsModel || project.voSettings?.ttsModel;
        const elModel: ElevenLabsTtsModel = VALID_ELEVENLABS_MODELS.includes(
          requestedModel as ElevenLabsTtsModel
        )
          ? (requestedModel as ElevenLabsTtsModel)
          : 'eleven_v3';

        const tts = await synthesizeWithElevenLabsTTS({
          text: spokenText,
          voice: elVoice,
          model: elModel,
          emotionalTone: activeTone,
          emotionIntensity: activeIntensity,
          speed: activeSpeed,
          language: activeLanguage,
          stability: elevenLabsStability ?? project.voSettings?.elevenLabsStability,
          similarityBoost:
            elevenLabsSimilarityBoost ??
            project.voSettings?.elevenLabsSimilarityBoost,
          style: elevenLabsStyle ?? project.voSettings?.elevenLabsStyle,
          skipSpeedText,
        });

        audioBuffer = tts.audioBuffer;
        audioBase64 = tts.audioBase64;
        mimeType = tts.mimeType;
        assetExt = tts.ext;
        resolvedVoice = elVoice;
        resolvedModel = tts.model;
        styleDirective = tts.styleDirective;
      } else {
        const activeVoice =
          voiceName ||
          targetLine.voiceName ||
          project.voSettings?.voiceName ||
          'Kore';
        const safeVoice = (VALID_GEMINI_VOICES as readonly string[]).includes(
          activeVoice
        )
          ? activeVoice
          : 'Kore';
        const requestedModel =
          ttsModel || targetLine.ttsModel || project.voSettings?.ttsModel;
        const geminiModel: GeminiTtsModel =
          requestedModel === 'gemini-3.8-flash-tts'
            ? 'gemini-3.8-flash-tts'
            : 'gemini-3.8-flash-lite-tts';

        const ai = getGeminiClient();
        const tts = await synthesizeWithGeminiTTS(ai, {
          text: spokenText,
          voice: safeVoice,
          model: geminiModel,
          direction: activeDirection,
          emotionalTone: activeTone,
          emotionIntensity: activeIntensity,
          stylePrompt: stylePrompt ?? project.voSettings?.customStylePrompt,
          speed: activeSpeed,
          pitch: activePitch,
          language: activeLanguage,
          skipPitchText,
          skipSpeedText,
        });

        audioBuffer = tts.wavBuffer;
        audioBase64 = tts.audioBase64;
        mimeType = tts.mimeType;
        assetExt = 'wav';
        resolvedVoice = tts.voice;
        resolvedModel = tts.model;
        styleDirective = tts.styleDirective;
      }

      const savedAsset = await saveBufferAsset(
        project.id,
        audioBuffer,
        `vo-${targetLine.shotId.toLowerCase()}`,
        assetExt
      );

      const nextLines = project.voScript.map((v) =>
        v.id === lineId
          ? {
              ...v,
              line: spokenText,
              direction: activeDirection,
              speaker: speaker ?? v.speaker,
              audioTags: audioTags ?? v.audioTags,
              emotionalTone: activeTone,
              emotionIntensity: activeIntensity,
              provider: activeProvider,
              voiceName: resolvedVoice,
              ttsModel: resolvedModel as VoScriptLine['ttsModel'],
              speed: activeSpeed,
              pitch: activePitch,
              language: activeLanguage,
              pauseAfter: activePauseAfter,
              audioUrl: savedAsset.url,
            }
          : v
      );

      const nextProject: PipelineProject = {
        ...project,
        voScript: nextLines,
        voSettings: voSettings || project.voSettings,
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'VO Audio',
            shotId: targetLine.shotId,
            model: resolvedModel,
            prompt: `${resolvedVoice} (${activeTone}): ${spokenText}`,
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({
        project: saved,
        audioUrl: savedAsset.url,
        audioBase64,
        mimeType,
        model: resolvedModel,
        provider: activeProvider,
        styleDirective,
      });
    } catch (err) {
      res.status(500).json({
        error: formatLlmError(err, 'Could not generate voiceover audio.'),
      });
    }
  });

  // Translate VO Script into target language while keeping pacing
  router.post('/pipeline/vo-translate', async (req, res) => {
    try {
      const { projectId, targetLanguage, targetLanguageName } = req.body as {
        projectId: string;
        targetLanguage: string;
        targetLanguageName?: string;
      };
      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      if (project.voScript.length === 0) {
        return res
          .status(400)
          .json({ error: 'Write or add VO lines before translating.' });
      }

      const langLabel = targetLanguageName || targetLanguage;
      const linesInput = project.voScript.map((v) => ({
        id: v.id,
        shotId: v.shotId,
        durationSec: v.durationSec ?? 4,
        speaker: v.speaker,
        direction: v.direction,
        line: v.line,
      }));

      const prompt = `Translate this commercial voiceover script for "${project.product.name}" naturally into ${langLabel} (${targetLanguage}).
Keep the brand and product name "${project.product.name}" intact unless standard localization applies.
Keep spoken line length tight so each line still reads comfortably inside its durationSec (~2.5 words/sec).
Also translate "direction" and "speaker" naturally into ${langLabel}, and return the exact same "id" for each item.

LINES TO TRANSLATE:
${JSON.stringify(linesInput)}`;

      const llmResult = await generateJsonWithGeminiOrFal<
        Array<{ id: string; speaker: string; direction: string; line: string }>
      >({
        prompt,
        thinkingLow: true,
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              speaker: { type: Type.STRING },
              direction: { type: Type.STRING },
              line: { type: Type.STRING },
            },
            required: ['id', 'speaker', 'direction', 'line'],
          },
        },
        jsonSchemaHint: `[{ "id": "string", "speaker": "string", "direction": "string", "line": "string" }]`,
      });

      const translated = Array.isArray(llmResult.data) ? llmResult.data : [];
      const translatedMap = new Map(translated.map((t) => [t.id, t]));

      const nextLines = project.voScript.map((v) => {
        const hit = translatedMap.get(v.id);
        if (!hit) return { ...v, language: targetLanguage, audioUrl: null };
        return {
          ...v,
          speaker: hit.speaker || v.speaker,
          direction: hit.direction || v.direction,
          line: hit.line || v.line,
          language: targetLanguage,
          audioUrl: null,
        };
      });

      const nextSettings: VoStudioSettings = {
        ...DEFAULT_VO_SETTINGS,
        ...(project.voSettings || {}),
        language: targetLanguage,
      };

      const nextProject: PipelineProject = {
        ...project,
        voScript: nextLines,
        voSettings: nextSettings,
        voManuallyEdited: true,
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'VO Translate',
            model: llmResult.modelUsed,
            prompt: `Translated ${nextLines.length} VO lines to ${langLabel}`,
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({ project: saved });
    } catch (err) {
      res.status(500).json({
        error: formatLlmError(err, 'Could not translate VO script.'),
      });
    }
  });

  return router;
}
