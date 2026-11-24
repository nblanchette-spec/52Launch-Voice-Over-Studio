import express, { Router } from 'express';
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
  resolveProjectAssetPath,
  saveBufferAsset,
  saveDataUrlAsset,
  saveProject,
} from './projectStore.ts';
import type {
  EditSfxCategory,
  EditSfxCue,
  ElevenLabsTtsModel,
  EmotionalBeat,
  FoleyCategory,
  FoleyCue,
  GeminiTtsModel,
  MusicEngineId,
  PipelineProject,
  ScriptBriefConfig,
  VoiceProvider,
  VoScriptLine,
  VoStudioSettings,
} from '../src/types/pipeline.ts';
import {
  DEFAULT_EDIT_SFX_STAGE,
  DEFAULT_FOLEY_STAGE,
  DEFAULT_MUSIC_STAGE,
  DEFAULT_VO_SETTINGS,
  EDIT_SFX_CATEGORIES,
  EMOTIONAL_BEAT_PRESETS,
  EMOTIONAL_TONES,
  FOLEY_CATEGORIES,
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
  createClonedVoice,
  deleteClonedVoice,
  listClonedVoices,
  resolveCloneSamplePath,
  synthesizeWithClonedVoice,
} from './voiceCloneStore.ts';
import {
  generateMusicScore,
  generateSoundEffect,
  generateSyncedFoleyVideoBed,
} from './audioGenHelpers.ts';
import {
  extractReadableTextFromPdfBuffer,
  formatLlmError,
  generateJsonWithGeminiOrFal,
  generateJsonWithVideoOrFrames,
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

  // Upload asset (JSON dataUrl)
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

  // Upload binary video or audio asset directly (avoids base64 size bloat)
  router.post(
    '/projects/:id/upload-media',
    express.raw({
      type: ['video/*', 'audio/*', 'application/octet-stream'],
      limit: '120mb',
    }),
    async (req, res) => {
      try {
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (buffer.length === 0) {
          return res.status(400).json({ error: 'Empty media upload.' });
        }
        const rawFilename = String(req.headers['x-media-filename'] || 'video.mp4');
        const extFromName = path.extname(path.basename(rawFilename)).replace('.', '').toLowerCase();
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        const mimeExtMap: Record<string, string> = {
          'video/mp4': 'mp4',
          'video/quicktime': 'mov',
          'video/webm': 'webm',
          'audio/mpeg': 'mp3',
          'audio/mp3': 'mp3',
          'audio/wav': 'wav',
          'audio/x-wav': 'wav',
          'audio/webm': 'webm',
          'audio/ogg': 'ogg',
          'audio/mp4': 'm4a',
        };
        const ext =
          mimeExtMap[contentType.split(';')[0].trim()] ||
          (['mp4', 'mov', 'webm', 'mp3', 'wav', 'ogg', 'm4a'].includes(extFromName)
            ? extFromName
            : 'mp4');
        const prefix = String(req.headers['x-media-prefix'] || 'video').trim() || 'video';
        const saved = await saveBufferAsset(req.params.id, buffer, prefix, ext);
        res.json(saved);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not save uploaded media.';
        res.status(msg.includes('Unsupported') ? 400 : 500).json({ error: msg });
      }
    }
  );

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

  // --- Voice Cloning Routes (Stage 1) ---
  router.get('/pipeline/voice-clones', async (_req, res) => {
    try {
      const clones = await listClonedVoices();
      res.json({ clones });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not load cloned voices.',
      });
    }
  });

  router.post('/pipeline/voice-clones', async (req, res) => {
    try {
      const { name, description, removeBackgroundNoise, preferredMethod, samples } = req.body as {
        name: string;
        description?: string;
        removeBackgroundNoise?: boolean;
        preferredMethod?: 'elevenlabs' | 'chatterbox';
        samples: Array<{ filename: string; dataUrl: string }>;
      };

      const profile = await createClonedVoice({
        name,
        description,
        removeBackgroundNoise,
        preferredMethod,
        samples,
      });
      const clones = await listClonedVoices();
      res.json({ clone: profile, clones });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Voice cloning failed.',
      });
    }
  });

  router.delete('/pipeline/voice-clones/:id', async (req, res) => {
    try {
      await deleteClonedVoice(req.params.id);
      const clones = await listClonedVoices();
      res.json({ clones });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not delete cloned voice.',
      });
    }
  });

  router.get('/cloned-voices/samples/:filename', (req, res) => {
    const resolved = resolveCloneSamplePath(req.params.filename);
    if (!resolved) {
      return res.status(400).json({ error: 'Invalid clone sample filename.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(resolved, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Sample not found.' });
      }
    });
  });

  // Audition a Gemini, ElevenLabs, or Cloned voice (no project mutation)
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

      if (provider === 'clone') {
        const tts = await synthesizeWithClonedVoice({
          clonedVoiceId: voiceName || '',
          text: sampleText,
          emotionalTone,
          emotionIntensity,
          speed,
          language,
          ttsModel,
          stability: elevenLabsStability,
          similarityBoost: elevenLabsSimilarityBoost,
          style: elevenLabsStyle,
        });

        return res.json({
          audioBase64: tts.audioBase64,
          mimeType: tts.mimeType,
          voice: tts.voice,
          model: tts.model,
          provider: 'clone',
          styleDirective: tts.styleDirective,
        });
      }

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
          'Could not audition voice. Verify GEMINI_API_KEY, ELEVENLABS_API_KEY, or FAL_KEY in Settings > Secrets.'
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

      if (activeProvider === 'clone') {
        const cloneId =
          voiceName ||
          targetLine.voiceName ||
          project.voSettings?.clonedVoiceId ||
          project.voSettings?.voiceName ||
          '';
        const tts = await synthesizeWithClonedVoice({
          clonedVoiceId: cloneId,
          text: spokenText,
          emotionalTone: activeTone,
          emotionIntensity: activeIntensity,
          speed: activeSpeed,
          language: activeLanguage,
          ttsModel: ttsModel || targetLine.ttsModel || project.voSettings?.ttsModel,
          stability: elevenLabsStability ?? project.voSettings?.elevenLabsStability,
          similarityBoost:
            elevenLabsSimilarityBoost ??
            project.voSettings?.elevenLabsSimilarityBoost,
          style: elevenLabsStyle ?? project.voSettings?.elevenLabsStyle,
        });

        audioBuffer = tts.audioBuffer;
        audioBase64 = tts.audioBase64;
        mimeType = tts.mimeType;
        assetExt = tts.ext;
        resolvedVoice = cloneId;
        resolvedModel = tts.model;
        styleDirective = tts.styleDirective;
      } else if (activeProvider === 'elevenlabs') {
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

  // ============================================================================
  // STAGE 2: FOLEY SFX — Visual Video Analysis & Organic On-Camera Audio Foley
  // ============================================================================
  router.post('/pipeline/foley-analyze', async (req, res) => {
    try {
      const { projectId, focusPrompt } = req.body as {
        projectId: string;
        focusPrompt?: string;
      };
      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const video = project.foley?.video;
      if (!video?.assetUrl) {
        return res.status(400).json({ error: 'Upload a video clip in Stage 2 first.' });
      }

      const resolved = resolveProjectAssetPath(project.id, video.assetUrl);
      const durationSec = Math.max(2, Number(video.durationSec) || 15);
      const categoryList = FOLEY_CATEGORIES.map((c) => `"${c}"`).join(', ');

      const prompt = `You are a Hollywood Supervising Foley Artist analyzing visual footage (${durationSec.toFixed(1)} seconds long).
Watch every visual action carefully and identify ONLY organic, physically-grounded ON-CAMERA foley sound cues caused by objects, surfaces, bodies, clothing, or real-world environment acoustics in frame (do NOT invent artificial swooshes, trailer hits, or music — those belong to later stages).
${focusPrompt?.trim() ? `DIRECTOR FOCUS NOTES: ${focusPrompt.trim()}` : ''}

Return a JSON object with:
- analysisSummary: 1-2 sentence overview of the physical acoustic environment and key on-screen surfaces/materials
- cues: array of 4 to 14 chronological foley cues covering the ${durationSec.toFixed(1)}s timeline. For each cue:
  - startTimeSec: exact timestamp in seconds (0 to ${Math.max(0.5, durationSec - 0.5).toFixed(1)})
  - durationSec: realistic duration in seconds (0.6 to 8.0)
  - category: strictly one of ${categoryList}
  - surfaceOrMaterial: physical materials interacting (e.g. "Wet asphalt / rubber running sole", "Ceramic mug / oak table")
  - visualAction: exact visible physical motion causing the sound
  - foleyPrompt: crisp studio foley recording prompt describing distance, microphone perspective, material texture, and organic acoustic decay (no music, dry studio foley)`;

      const llmResult = await generateJsonWithVideoOrFrames<{
        analysisSummary: string;
        cues: Array<Partial<FoleyCue>>;
      }>({
        videoFilePath: resolved?.filePath || null,
        videoMimeType: video.mimeType,
        keyframes: video.keyframes,
        prompt,
        thinkingLow: true,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysisSummary: { type: Type.STRING },
            cues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startTimeSec: { type: Type.NUMBER },
                  durationSec: { type: Type.NUMBER },
                  category: { type: Type.STRING },
                  surfaceOrMaterial: { type: Type.STRING },
                  visualAction: { type: Type.STRING },
                  foleyPrompt: { type: Type.STRING },
                },
                required: [
                  'startTimeSec',
                  'durationSec',
                  'category',
                  'surfaceOrMaterial',
                  'visualAction',
                  'foleyPrompt',
                ],
              },
            },
          },
          required: ['analysisSummary', 'cues'],
        },
        jsonSchemaHint: `{ "analysisSummary": "string", "cues": [{ "startTimeSec": 0.5, "durationSec": 2.0, "category": "Footsteps", "surfaceOrMaterial": "Concrete / Rubber", "visualAction": "Runner lands stride on track", "foleyPrompt": "Close organic foley recording of athletic rubber sneakers landing briskly on outdoor rubberized track, natural subtle air" }] }`,
      });

      const cues: FoleyCue[] = (Array.isArray(llmResult.data?.cues) ? llmResult.data.cues : [])
        .filter((c) => Boolean(c.foleyPrompt && String(c.foleyPrompt).trim()))
        .sort((a, b) => Number(a.startTimeSec || 0) - Number(b.startTimeSec || 0))
        .map((c, idx) => {
          const cat = FOLEY_CATEGORIES.includes(c.category as FoleyCategory)
            ? (c.category as FoleyCategory)
            : 'Props & Handling';
          return {
            id: `foley-${Date.now()}-${idx}`,
            cueNumber: `F${String(idx + 1).padStart(2, '0')}`,
            startTimeSec: Math.max(0, Math.min(durationSec - 0.3, Number(c.startTimeSec) || 0)),
            durationSec: Math.max(0.5, Math.min(12, Number(c.durationSec) || 2.0)),
            category: cat,
            surfaceOrMaterial: String(c.surfaceOrMaterial || 'Natural surface').trim(),
            visualAction: String(c.visualAction || 'On-camera movement').trim(),
            foleyPrompt: String(c.foleyPrompt || '').trim(),
            promptInfluence: 0.55,
            gain: 1.0,
            muted: false,
            audioUrl: null,
          };
        });

      const nextProject: PipelineProject = {
        ...project,
        foley: {
          ...DEFAULT_FOLEY_STAGE,
          ...(project.foley || {}),
          video,
          focusPrompt: focusPrompt ?? project.foley?.focusPrompt,
          analysisSummary: String(llmResult.data?.analysisSummary || '').trim(),
          cues,
          lastAnalyzedAt: new Date().toISOString(),
        },
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Foley Analysis',
            model: llmResult.modelUsed,
            prompt: `Analyzed "${video.filename}" -> ${cues.length} organic foley cues`,
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
        error: formatLlmError(err, 'Could not analyze video for foley.'),
      });
    }
  });

  router.post('/pipeline/foley-generate', async (req, res) => {
    try {
      const { projectId, cueId, foleyPrompt, durationSec, promptInfluence } = req.body as {
        projectId: string;
        cueId: string;
        foleyPrompt?: string;
        durationSec?: number;
        promptInfluence?: number;
      };
      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const cues = project.foley?.cues || [];
      const target = cues.find((c) => c.id === cueId);
      if (!target) {
        return res.status(404).json({ error: 'Foley cue not found.' });
      }

      const finalPrompt = (foleyPrompt ?? target.foleyPrompt).trim();
      const finalDuration = durationSec ?? target.durationSec;
      const finalInfluence = promptInfluence ?? target.promptInfluence;

      const generated = await generateSoundEffect({
        prompt: finalPrompt,
        durationSec: finalDuration,
        promptInfluence: finalInfluence,
      });

      const savedAsset = await saveBufferAsset(
        project.id,
        generated.audioBuffer,
        `foley-${target.cueNumber.toLowerCase()}`,
        generated.ext
      );

      const nextCues = cues.map((c) =>
        c.id === cueId
          ? {
              ...c,
              foleyPrompt: finalPrompt,
              durationSec: finalDuration,
              promptInfluence: finalInfluence,
              audioUrl: savedAsset.url,
              engineUsed: generated.engineUsed,
            }
          : c
      );

      const nextProject: PipelineProject = {
        ...project,
        foley: {
          ...DEFAULT_FOLEY_STAGE,
          ...(project.foley || {}),
          cues: nextCues,
        },
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Foley Audio',
            shotId: target.cueNumber,
            model: generated.engineUsed,
            prompt: finalPrompt,
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({ project: saved, audioUrl: savedAsset.url });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not generate foley audio.',
      });
    }
  });

  router.post('/pipeline/foley-video-bed', async (req, res) => {
    try {
      const { projectId, prompt } = req.body as {
        projectId: string;
        prompt?: string;
      };
      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const video = project.foley?.video;
      if (!video?.assetUrl) {
        return res.status(400).json({ error: 'Upload a video clip in Stage 2 first.' });
      }
      const resolved = resolveProjectAssetPath(project.id, video.assetUrl);
      if (!resolved) {
        return res.status(400).json({ error: 'Uploaded video file could not be located on disk.' });
      }

      const bedPrompt =
        prompt?.trim() ||
        project.foley?.analysisSummary ||
        'Realistic organic on-camera foley audio synced to visible movement and physical materials';

      const generated = await generateSyncedFoleyVideoBed({
        videoFilePath: resolved.filePath,
        videoMimeType: video.mimeType,
        prompt: bedPrompt,
        durationSec: Math.min(30, Math.max(2, Math.round(video.durationSec || 8))),
      });

      const savedAsset = await saveBufferAsset(
        project.id,
        generated.videoBuffer,
        'foley-bed',
        generated.ext
      );

      const nextProject: PipelineProject = {
        ...project,
        foley: {
          ...DEFAULT_FOLEY_STAGE,
          ...(project.foley || {}),
          syncedBedVideoUrl: savedAsset.url,
          syncedBedPrompt: bedPrompt,
        },
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Foley Video Bed',
            model: generated.engineUsed,
            prompt: bedPrompt,
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({ project: saved, syncedBedVideoUrl: savedAsset.url });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not synthesize full-video foley bed.',
      });
    }
  });

  // ============================================================================
  // STAGE 3: EDIT SFX — Transitions, Swooshes & Graphical Sound Design
  // ============================================================================
  router.post('/pipeline/sfx-analyze', async (req, res) => {
    try {
      const { projectId, editingStyle } = req.body as {
        projectId: string;
        editingStyle?: string;
      };
      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const video = project.editSfx?.video;
      if (!video?.assetUrl) {
        return res.status(400).json({ error: 'Upload a video clip in Stage 3 first.' });
      }

      const resolved = resolveProjectAssetPath(project.id, video.assetUrl);
      const durationSec = Math.max(2, Number(video.durationSec) || 15);
      const categoryList = EDIT_SFX_CATEGORIES.map((c) => `"${c}"`).join(', ');

      const prompt = `You are a Senior Sound Designer & Trailer Editor analyzing this ${durationSec.toFixed(1)}-second video edit.
Identify exact timestamps for EDITORIAL & GRAPHICAL sound effects that heighten the cut — such as camera whip pans, hard cuts, speed ramps, motion graphics/titles appearing, UI clicks, light leaks, logo reveals, zoom punches, and energy shifts (do NOT generate footsteps or natural foley here — focus on editorial transition swooshes, risers, hits, pops, glitches, and sub drops).
EDITING STYLE DIRECTION: ${editingStyle?.trim() || 'Modern sleek commercial cut with crisp transitions'}

Return a JSON object with:
- analysisSummary: 1-2 sentence overview of the editing rhythm and visual transition motifs
- cues: array of 4 to 14 chronological editorial SFX cues within 0s-${durationSec.toFixed(1)}s. For each cue:
  - startTimeSec: exact timestamp in seconds (note: place risers ~1-2s BEFORE the hit!)
  - durationSec: realistic duration (0.5 to 4.5s)
  - category: strictly one of ${categoryList}
  - editEvent: what visual cut, camera move, or graphic animation occurs at this timestamp
  - sfxPrompt: detailed sound design synthesis prompt (clean, punchy, studio mastered, dry without music)`;

      const llmResult = await generateJsonWithVideoOrFrames<{
        analysisSummary: string;
        cues: Array<Partial<EditSfxCue>>;
      }>({
        videoFilePath: resolved?.filePath || null,
        videoMimeType: video.mimeType,
        keyframes: video.keyframes,
        prompt,
        thinkingLow: true,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysisSummary: { type: Type.STRING },
            cues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startTimeSec: { type: Type.NUMBER },
                  durationSec: { type: Type.NUMBER },
                  category: { type: Type.STRING },
                  editEvent: { type: Type.STRING },
                  sfxPrompt: { type: Type.STRING },
                },
                required: ['startTimeSec', 'durationSec', 'category', 'editEvent', 'sfxPrompt'],
              },
            },
          },
          required: ['analysisSummary', 'cues'],
        },
        jsonSchemaHint: `{ "analysisSummary": "string", "cues": [{ "startTimeSec": 2.4, "durationSec": 1.0, "category": "Whoosh & Swoosh", "editEvent": "Fast whip pan into product close-up", "sfxPrompt": "Crisp fast aerodynamic camera whip-pan air whoosh transition, dry studio sound design" }] }`,
      });

      const cues: EditSfxCue[] = (Array.isArray(llmResult.data?.cues) ? llmResult.data.cues : [])
        .filter((c) => Boolean(c.sfxPrompt && String(c.sfxPrompt).trim()))
        .sort((a, b) => Number(a.startTimeSec || 0) - Number(b.startTimeSec || 0))
        .map((c, idx) => {
          const cat = EDIT_SFX_CATEGORIES.includes(c.category as EditSfxCategory)
            ? (c.category as EditSfxCategory)
            : 'Whoosh & Swoosh';
          return {
            id: `sfx-${Date.now()}-${idx}`,
            cueNumber: `E${String(idx + 1).padStart(2, '0')}`,
            startTimeSec: Math.max(0, Math.min(durationSec - 0.3, Number(c.startTimeSec) || 0)),
            durationSec: Math.max(0.5, Math.min(8, Number(c.durationSec) || 1.2)),
            category: cat,
            editEvent: String(c.editEvent || 'Visual edit transition').trim(),
            sfxPrompt: String(c.sfxPrompt || '').trim(),
            promptInfluence: 0.6,
            gain: 1.0,
            muted: false,
            audioUrl: null,
          };
        });

      const nextProject: PipelineProject = {
        ...project,
        editSfx: {
          ...DEFAULT_EDIT_SFX_STAGE,
          ...(project.editSfx || {}),
          video,
          editingStyle: editingStyle ?? project.editSfx?.editingStyle,
          analysisSummary: String(llmResult.data?.analysisSummary || '').trim(),
          cues,
          lastAnalyzedAt: new Date().toISOString(),
        },
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Edit SFX Analysis',
            model: llmResult.modelUsed,
            prompt: `Analyzed "${video.filename}" -> ${cues.length} editorial SFX cues`,
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
        error: formatLlmError(err, 'Could not analyze video for editorial SFX.'),
      });
    }
  });

  router.post('/pipeline/sfx-generate', async (req, res) => {
    try {
      const { projectId, cueId, sfxPrompt, durationSec, promptInfluence } = req.body as {
        projectId: string;
        cueId: string;
        sfxPrompt?: string;
        durationSec?: number;
        promptInfluence?: number;
      };
      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const cues = project.editSfx?.cues || [];
      const target = cues.find((c) => c.id === cueId);
      if (!target) {
        return res.status(404).json({ error: 'Edit SFX cue not found.' });
      }

      const finalPrompt = (sfxPrompt ?? target.sfxPrompt).trim();
      const finalDuration = durationSec ?? target.durationSec;
      const finalInfluence = promptInfluence ?? target.promptInfluence;

      const generated = await generateSoundEffect({
        prompt: finalPrompt,
        durationSec: finalDuration,
        promptInfluence: finalInfluence,
      });

      const savedAsset = await saveBufferAsset(
        project.id,
        generated.audioBuffer,
        `sfx-${target.cueNumber.toLowerCase()}`,
        generated.ext
      );

      const nextCues = cues.map((c) =>
        c.id === cueId
          ? {
              ...c,
              sfxPrompt: finalPrompt,
              durationSec: finalDuration,
              promptInfluence: finalInfluence,
              audioUrl: savedAsset.url,
              engineUsed: generated.engineUsed,
            }
          : c
      );

      const nextProject: PipelineProject = {
        ...project,
        editSfx: {
          ...DEFAULT_EDIT_SFX_STAGE,
          ...(project.editSfx || {}),
          cues: nextCues,
        },
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Edit SFX Audio',
            shotId: target.cueNumber,
            model: generated.engineUsed,
            prompt: finalPrompt,
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({ project: saved, audioUrl: savedAsset.url });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not generate editorial SFX.',
      });
    }
  });

  // ============================================================================
  // STAGE 4: MUSIC ORCHESTRATION — Video Analysis & Emotional Beats Composition
  // ============================================================================
  router.post('/pipeline/music-analyze', async (req, res) => {
    try {
      const { projectId, customDirection, preferredGenre } = req.body as {
        projectId: string;
        customDirection?: string;
        preferredGenre?: string;
      };
      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const video = project.music?.video;
      if (!video?.assetUrl) {
        return res.status(400).json({ error: 'Upload a video clip in Stage 4 first.' });
      }

      const resolved = resolveProjectAssetPath(project.id, video.assetUrl);
      const durationSec = Math.max(5, Math.round(Number(video.durationSec) || 30));
      const emotionList = EMOTIONAL_BEAT_PRESETS.map((e) => `"${e}"`).join(', ');

      const prompt = `You are a Film Composer & Music Supervisor scoring this ${durationSec}-second video.
Analyze the visual storytelling, pacing, scene cuts, mood, lighting, and emotional climax moments.
Map the score into 3 to 6 contiguous, chronological EMOTIONAL BEATS spanning the full ${durationSec}s runtime (each beat should be at least 3 seconds long so sections compose smoothly).
${preferredGenre?.trim() ? `PREFERRED GENRE: ${preferredGenre.trim()}` : ''}
${customDirection?.trim() ? `COMPOSER NOTES: ${customDirection.trim()}` : ''}

Return a JSON object with:
- analysisSummary: 1-2 sentence musical scoring direction explaining how the score evolves with the picture
- genre: concise musical genre/style (e.g. "Modern Hybrid Electronic" or "Cinematic Orchestral")
- bpm: integer tempo (60 to 165)
- musicalKey: musical key (e.g. "D Minor", "C Major", "A Minor")
- instrumentationPalette: array of 3-6 core instruments
- beats: array of contiguous emotional beats covering ~${durationSec}s total:
  - label: short section name (e.g. "Cold Open", "Rising Tension", "Hero Climax", "Warm Outro")
  - startTimeSec: start second (contiguous from 0)
  - durationSec: integer duration in seconds (minimum 3)
  - emotion: strictly one of ${emotionList}
  - energy: integer intensity 1 to 10
  - instrumentation: specific arrangement notes for this beat
  - tempoFeel: e.g. "Sparse half-time", "Driving 16ths", "Broad cinematic sustain"`;

      const llmResult = await generateJsonWithVideoOrFrames<{
        analysisSummary: string;
        genre: string;
        bpm: number;
        musicalKey: string;
        instrumentationPalette: string[];
        beats: Array<Partial<EmotionalBeat>>;
      }>({
        videoFilePath: resolved?.filePath || null,
        videoMimeType: video.mimeType,
        keyframes: video.keyframes,
        prompt,
        thinkingLow: true,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysisSummary: { type: Type.STRING },
            genre: { type: Type.STRING },
            bpm: { type: Type.INTEGER },
            musicalKey: { type: Type.STRING },
            instrumentationPalette: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            beats: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  startTimeSec: { type: Type.NUMBER },
                  durationSec: { type: Type.NUMBER },
                  emotion: { type: Type.STRING },
                  energy: { type: Type.INTEGER },
                  instrumentation: { type: Type.STRING },
                  tempoFeel: { type: Type.STRING },
                },
                required: [
                  'label',
                  'startTimeSec',
                  'durationSec',
                  'emotion',
                  'energy',
                  'instrumentation',
                ],
              },
            },
          },
          required: [
            'analysisSummary',
            'genre',
            'bpm',
            'musicalKey',
            'instrumentationPalette',
            'beats',
          ],
        },
        jsonSchemaHint: `{ "analysisSummary": "string", "genre": "Modern Hybrid Electronic", "bpm": 114, "musicalKey": "D Minor", "instrumentationPalette": ["Felt Piano", "Strings"], "beats": [{ "label": "Cold Open", "startTimeSec": 0, "durationSec": 8, "emotion": "Intimate & Minimal", "energy": 3, "instrumentation": "Felt piano and subtle sub pad", "tempoFeel": "Half-time" }] }`,
      });

      let cursor = 0;
      const beats: EmotionalBeat[] = (Array.isArray(llmResult.data?.beats) ? llmResult.data.beats : [])
        .filter((b) => Boolean(b.label || b.emotion))
        .map((b, idx) => {
          const beatDur = Math.max(3, Math.round(Number(b.durationSec) || 6));
          const start = typeof b.startTimeSec === 'number' ? Math.max(0, Math.round(b.startTimeSec)) : cursor;
          cursor = start + beatDur;
          return {
            id: `beat-${Date.now()}-${idx}`,
            label: String(b.label || `Beat ${idx + 1}`).trim(),
            startTimeSec: start,
            durationSec: beatDur,
            emotion: EMOTIONAL_BEAT_PRESETS.includes(String(b.emotion))
              ? String(b.emotion)
              : 'Suspenseful & Rising',
            energy: Math.max(1, Math.min(10, Math.round(Number(b.energy) || 5))),
            instrumentation: String(b.instrumentation || 'Strings and subtle synth pad').trim(),
            tempoFeel: String(b.tempoFeel || 'Steady cinematic pulse').trim(),
          };
        });

      const nextProject: PipelineProject = {
        ...project,
        music: {
          ...DEFAULT_MUSIC_STAGE,
          ...(project.music || {}),
          video,
          analysisSummary: String(llmResult.data?.analysisSummary || '').trim(),
          genre: String(llmResult.data?.genre || preferredGenre || 'Modern Hybrid Electronic').trim(),
          bpm: Math.max(55, Math.min(180, Math.round(Number(llmResult.data?.bpm) || 112))),
          musicalKey: String(llmResult.data?.musicalKey || 'D Minor').trim(),
          instrumentationPalette:
            Array.isArray(llmResult.data?.instrumentationPalette) &&
            llmResult.data.instrumentationPalette.length > 0
              ? llmResult.data.instrumentationPalette.slice(0, 8)
              : DEFAULT_MUSIC_STAGE.instrumentationPalette,
          customDirection: customDirection ?? project.music?.customDirection ?? '',
          beats: beats.length > 0 ? beats : DEFAULT_MUSIC_STAGE.beats,
          lastAnalyzedAt: new Date().toISOString(),
        },
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Music Arc Analysis',
            model: llmResult.modelUsed,
            prompt: `Mapped ${beats.length} emotional beats for "${video.filename}"`,
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
        error: formatLlmError(err, 'Could not analyze video emotional arc.'),
      });
    }
  });

  router.post('/pipeline/music-generate', async (req, res) => {
    try {
      const {
        projectId,
        engine,
        genre,
        bpm,
        musicalKey,
        forceInstrumental,
        instrumentationPalette,
        negativeStyles,
        customDirection,
        beats,
      } = req.body as {
        projectId: string;
        engine?: MusicEngineId;
        genre?: string;
        bpm?: number;
        musicalKey?: string;
        forceInstrumental?: boolean;
        instrumentationPalette?: string[];
        negativeStyles?: string;
        customDirection?: string;
        beats?: EmotionalBeat[];
      };

      const project = await getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      const musicState = {
        ...DEFAULT_MUSIC_STAGE,
        ...(project.music || {}),
      };

      const finalEngine: MusicEngineId =
        engine === 'ace_step' ? 'ace_step' : engine || musicState.engine || 'elevenlabs_music';
      const finalGenre = genre ?? musicState.genre;
      const finalBpm = bpm ?? musicState.bpm;
      const finalKey = musicalKey ?? musicState.musicalKey;
      const finalInst = forceInstrumental ?? musicState.forceInstrumental;
      const finalPalette = instrumentationPalette ?? musicState.instrumentationPalette;
      const finalNegative = negativeStyles ?? musicState.negativeStyles;
      const finalDir = customDirection ?? musicState.customDirection;
      const finalBeats = Array.isArray(beats) && beats.length > 0 ? beats : musicState.beats;

      const beatsDuration = finalBeats.reduce(
        (maxEnd, b) => Math.max(maxEnd, (Number(b.startTimeSec) || 0) + (Number(b.durationSec) || 0)),
        0
      );
      const targetDurationSec = Math.max(
        5,
        Math.round(musicState.video?.durationSec || beatsDuration || 30)
      );

      const composed = await generateMusicScore({
        engine: finalEngine,
        genre: finalGenre,
        bpm: finalBpm,
        musicalKey: finalKey,
        forceInstrumental: finalInst,
        instrumentationPalette: finalPalette,
        negativeStyles: finalNegative,
        customDirection: finalDir,
        beats: finalBeats,
        targetDurationSec,
      });

      const savedAsset = await saveBufferAsset(
        project.id,
        composed.audioBuffer,
        'score-master',
        composed.ext
      );

      const newTake = {
        id: `take-${Date.now()}`,
        createdAt: new Date().toISOString(),
        engine: finalEngine,
        audioUrl: savedAsset.url,
        durationSec: composed.durationSec,
        promptSummary: `${finalGenre} · ${finalBpm} BPM · ${finalBeats.length} beats`,
      };

      const nextProject: PipelineProject = {
        ...project,
        music: {
          ...musicState,
          engine: finalEngine,
          genre: finalGenre,
          bpm: finalBpm,
          musicalKey: finalKey,
          forceInstrumental: finalInst,
          instrumentationPalette: finalPalette,
          negativeStyles: finalNegative,
          customDirection: finalDir,
          beats: finalBeats,
          masterAudioUrl: savedAsset.url,
          takes: [newTake, ...(musicState.takes || [])].slice(0, 12),
        },
        generationLog: [
          {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            step: 'Music Score',
            model: composed.engineUsed,
            prompt: composed.promptSummary.slice(0, 320),
            seed: null,
            status: 'success',
          },
          ...project.generationLog,
        ],
      };

      const saved = await saveProject(nextProject);
      res.json({ project: saved, masterAudioUrl: savedAsset.url, take: newTake });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not compose music score.',
      });
    }
  });

  return router;
}
