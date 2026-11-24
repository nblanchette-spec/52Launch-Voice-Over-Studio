import lameRaw from 'lamejs/lame.min.js?raw';
import JSZip from 'jszip';

interface LameNamespace {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
    encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
    flush: () => Int8Array;
  };
}

let cachedLame: LameNamespace | null = null;
function getLameLib(): LameNamespace {
  if (!cachedLame) {
    cachedLame = new Function(`${lameRaw}; return lamejs;`)() as LameNamespace;
  }
  return cachedLame;
}

let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

export async function base64ToAudioBuffer(
  base64: string,
  audioContext: AudioContext
): Promise<AudioBuffer> {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return audioContext.decodeAudioData(copy.buffer);
}

export async function urlToAudioBuffer(
  url: string,
  audioContext: AudioContext
): Promise<AudioBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Could not load saved audio file.');
  const arrayBuffer = await resp.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

function wsolaTimeStretch(
  input: Float32Array,
  sampleRate: number,
  stretchFactor: number
): Float32Array {
  if (Math.abs(stretchFactor - 1.0) < 0.01 || input.length < 2048) {
    return input;
  }
  const winSize = Math.round(sampleRate * 0.032);
  const synthesisHop = Math.max(64, Math.floor(winSize / 4));
  const analysisHop = Math.max(32, Math.round(synthesisHop / stretchFactor));
  const searchRadius = Math.round(sampleRate * 0.008);

  const hann = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  const outLen = Math.max(winSize, Math.round(input.length * stretchFactor));
  const output = new Float32Array(outLen);
  const norm = new Float32Array(outLen);

  for (let i = 0; i < Math.min(winSize, input.length, outLen); i++) {
    output[i] += input[i] * hann[i];
    norm[i] += hann[i];
  }

  let inPos = analysisHop;
  let outPos = synthesisHop;

  while (outPos + winSize < outLen && inPos + winSize < input.length) {
    let bestOffset = 0;
    let bestCorr = -Infinity;
    const overlapLen = winSize - synthesisHop;
    const minOff = Math.max(-searchRadius, -inPos);
    const maxOff = Math.min(searchRadius, input.length - winSize - inPos);

    for (let off = minOff; off <= maxOff; off += 2) {
      let corr = 0;
      const candStart = inPos + off;
      for (let i = 0; i < overlapLen; i += 2) {
        corr += output[outPos + i] * input[candStart + i];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestOffset = off;
      }
    }

    const alignedStart = inPos + bestOffset;
    for (let i = 0; i < winSize; i++) {
      output[outPos + i] += input[alignedStart + i] * hann[i];
      norm[outPos + i] += hann[i];
    }

    inPos += analysisHop;
    outPos += synthesisHop;
  }

  for (let i = 0; i < outLen; i++) {
    if (norm[i] > 1e-4) {
      output[i] /= norm[i];
    }
  }
  return output;
}

export async function processAudioWithDSP(
  inputBuffer: AudioBuffer,
  options: {
    speed?: number;
    pitch?: number;
    bassBoostDb?: number;
    trebleBoostDb?: number;
    midPresenceDb?: number;
    reverbWet?: number;
    compression?: boolean;
    volume?: number;
  }
): Promise<AudioBuffer> {
  const speed = Math.max(0.6, Math.min(1.6, options.speed ?? 1.0));
  const pitchRatio = Math.max(0.75, Math.min(1.35, options.pitch ?? 1.0));
  const bassDb = options.bassBoostDb ?? 0;
  const trebleDb = options.trebleBoostDb ?? 0;
  const midDb = options.midPresenceDb ?? 0;
  const reverbWet = options.reverbWet ?? 0;
  const volume = options.volume ?? 1.0;
  const useCompression = options.compression === true;

  const isBypassed =
    Math.abs(speed - 1.0) < 0.01 &&
    Math.abs(pitchRatio - 1.0) < 0.01 &&
    Math.abs(bassDb) < 0.05 &&
    Math.abs(trebleDb) < 0.05 &&
    Math.abs(midDb) < 0.05 &&
    reverbWet <= 0.01 &&
    Math.abs(volume - 1.0) < 0.01 &&
    !useCompression;

  if (isBypassed) {
    return inputBuffer;
  }

  const sampleRate = inputBuffer.sampleRate;
  let workingBuffer = inputBuffer;
  const olaStretch = pitchRatio / speed;

  if (Math.abs(olaStretch - 1.0) >= 0.012) {
    const tempCtx = new OfflineAudioContext(
      inputBuffer.numberOfChannels,
      Math.max(1024, Math.ceil(inputBuffer.length * olaStretch)),
      sampleRate
    );
    const stretchedChannels: Float32Array[] = [];
    let stretchedLen = 0;
    for (let ch = 0; ch < inputBuffer.numberOfChannels; ch++) {
      const stretched = wsolaTimeStretch(
        inputBuffer.getChannelData(ch),
        sampleRate,
        olaStretch
      );
      stretchedChannels.push(stretched);
      stretchedLen = Math.max(stretchedLen, stretched.length);
    }
    workingBuffer = tempCtx.createBuffer(
      inputBuffer.numberOfChannels,
      stretchedLen,
      sampleRate
    );
    for (let ch = 0; ch < inputBuffer.numberOfChannels; ch++) {
      workingBuffer.getChannelData(ch).set(stretchedChannels[ch]);
    }
  }

  const tailSeconds = reverbWet > 0.05 ? 0.3 : 0.04;
  const effectiveDuration = workingBuffer.duration / pitchRatio + tailSeconds;
  const totalFrames = Math.ceil(effectiveDuration * sampleRate);

  const offlineCtx = new OfflineAudioContext(
    workingBuffer.numberOfChannels,
    Math.max(1024, totalFrames),
    sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = workingBuffer;
  source.playbackRate.value = pitchRatio;

  let lastNode: AudioNode = source;

  if (Math.abs(bassDb) >= 0.05) {
    const lowShelf = offlineCtx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 180;
    lowShelf.gain.value = Math.max(-8, Math.min(8, bassDb));
    lastNode.connect(lowShelf);
    lastNode = lowShelf;
  }

  if (Math.abs(midDb) >= 0.05) {
    const midPeak = offlineCtx.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = 1800;
    midPeak.Q.value = 1.0;
    midPeak.gain.value = Math.max(-6, Math.min(6, midDb));
    lastNode.connect(midPeak);
    lastNode = midPeak;
  }

  if (Math.abs(trebleDb) >= 0.05) {
    const highShelf = offlineCtx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 5500;
    highShelf.gain.value = Math.max(-8, Math.min(8, trebleDb));
    lastNode.connect(highShelf);
    lastNode = highShelf;
  }

  if (reverbWet > 0.02) {
    const delay = offlineCtx.createDelay();
    delay.delayTime.value = 0.024;
    const delayFilter = offlineCtx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 3500;
    const wetGain = offlineCtx.createGain();
    wetGain.gain.value = Math.min(reverbWet * 0.3, 0.1);
    const dryGain = offlineCtx.createGain();
    dryGain.gain.value = 1.0;

    lastNode.connect(dryGain);
    lastNode.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(wetGain);

    const merger = offlineCtx.createGain();
    dryGain.connect(merger);
    wetGain.connect(merger);
    lastNode = merger;
  }

  if (useCompression) {
    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.0;
    compressor.attack.value = 0.015;
    compressor.release.value = 0.2;
    lastNode.connect(compressor);
    lastNode = compressor;
  }

  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = volume;
  lastNode.connect(masterGain);
  masterGain.connect(offlineCtx.destination);

  source.start(0);
  return offlineCtx.startRendering();
}

export function concatenateAudioBuffers(
  audioContext: AudioContext | BaseAudioContext,
  buffers: AudioBuffer[],
  defaultGapSec: number = 0.35,
  gapMap?: Record<number, number>
): AudioBuffer | null {
  if (buffers.length === 0) return null;
  if (buffers.length === 1 && (!gapMap || !gapMap[0])) return buffers[0];

  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.max(...buffers.map((b) => b.numberOfChannels));

  let totalSamples = 0;
  for (let i = 0; i < buffers.length; i++) {
    totalSamples += buffers[i].length;
    if (i < buffers.length - 1) {
      const gap = gapMap && gapMap[i] !== undefined ? gapMap[i] : defaultGapSec;
      totalSamples += Math.floor(gap * sampleRate);
    }
  }

  const resultBuffer = audioContext.createBuffer(numChannels, totalSamples, sampleRate);
  let offset = 0;
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    for (let ch = 0; ch < numChannels; ch++) {
      const src = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      resultBuffer.copyToChannel(src, ch, offset);
    }
    offset += buf.length;
    if (i < buffers.length - 1) {
      const gap = gapMap && gapMap[i] !== undefined ? gapMap[i] : defaultGapSec;
      offset += Math.floor(gap * sampleRate);
    }
  }
  return resultBuffer;
}

export function audioBufferToWav(buffer: AudioBuffer, normalize: boolean = false): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const length = buffer.length;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  let maxPeak = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    channels.push(data);
    if (normalize) {
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > maxPeak) maxPeak = abs;
      }
    }
  }

  const gain = normalize && maxPeak > 0 ? Math.min(0.98 / maxPeak, 3.0) : 1.0;
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i] * gain));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(intSample), true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function audioBufferToMp3(
  buffer: AudioBuffer,
  bitrate: 128 | 192 | 320 = 320,
  normalize: boolean = false
): Blob {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const lameLib = getLameLib();
  const encoder = new lameLib.Mp3Encoder(numChannels, sampleRate, bitrate);

  let maxPeak = 0;
  if (normalize) {
    for (let ch = 0; ch < numChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > maxPeak) maxPeak = abs;
      }
    }
  }

  const gain = normalize && maxPeak > 0 ? Math.min(0.98 / maxPeak, 3.0) : 1.0;
  const leftFloat = buffer.getChannelData(0);
  const rightFloat = numChannels > 1 ? buffer.getChannelData(1) : leftFloat;
  const length = buffer.length;
  const leftInt = new Int16Array(length);
  const rightInt = new Int16Array(length);

  for (let i = 0; i < length; i++) {
    const sL = Math.max(-1, Math.min(1, leftFloat[i] * gain));
    leftInt[i] = sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7fff);
    if (numChannels > 1) {
      const sR = Math.max(-1, Math.min(1, rightFloat[i] * gain));
      rightInt[i] = sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7fff);
    }
  }

  const mp3Data: Uint8Array[] = [];
  const blockSize = 1152;
  for (let i = 0; i < length; i += blockSize) {
    const leftChunk = leftInt.subarray(i, i + blockSize);
    const mp3buf =
      numChannels === 1
        ? encoder.encodeBuffer(leftChunk)
        : encoder.encodeBuffer(leftChunk, rightInt.subarray(i, i + blockSize));
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf.buffer, mp3buf.byteOffset, mp3buf.length));
    }
  }

  const endBuf = encoder.flush();
  if (endBuf.length > 0) {
    mp3Data.push(new Uint8Array(endBuf.buffer, endBuf.byteOffset, endBuf.length));
  }

  return new Blob(mp3Data as unknown as BlobPart[], { type: 'audio/mp3' });
}

export async function exportMasterOrStems(params: {
  projectName: string;
  items: Array<{
    shotId: string;
    speaker: string;
    line: string;
    buffer: AudioBuffer;
    pauseAfter: number;
  }>;
  format: 'wav' | 'mp3';
  bitrate: 128 | 192 | 320;
  normalize: boolean;
  mode: 'master' | 'stems';
}): Promise<void> {
  const ctx = getAudioContext();
  const slug = params.projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'voiceover';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

  if (params.mode === 'master') {
    const gapMap: Record<number, number> = {};
    params.items.forEach((item, idx) => {
      gapMap[idx] = item.pauseAfter;
    });
    const master = concatenateAudioBuffers(
      ctx,
      params.items.map((i) => i.buffer),
      0.35,
      gapMap
    );
    if (!master) throw new Error('No ready audio lines to export.');
    const blob =
      params.format === 'wav'
        ? audioBufferToWav(master, params.normalize)
        : audioBufferToMp3(master, params.bitrate, params.normalize);
    triggerBlobDownload(blob, `${slug}-vo-master-${stamp}.${params.format}`);
    return;
  }

  const zip = new JSZip();
  let manifest = `52Launch Production Studio — Voiceover Stems\n`;
  manifest += `Project: ${params.projectName}\n`;
  manifest += `Exported: ${new Date().toLocaleString()}\n`;
  manifest += `Format: ${params.format.toUpperCase()}${params.format === 'mp3' ? ` (${params.bitrate} kbps)` : ' (16-bit PCM)'}\n`;
  manifest += `--------------------------------------------------\n\n`;

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i];
    const blob =
      params.format === 'wav'
        ? audioBufferToWav(item.buffer, params.normalize)
        : audioBufferToMp3(item.buffer, params.bitrate, params.normalize);
    const num = String(i + 1).padStart(2, '0');
    const filename = `${num}-${item.shotId}.${params.format}`;
    zip.file(filename, blob);
    manifest += `${filename} | ${item.speaker} (${item.buffer.duration.toFixed(1)}s): "${item.line}"\n`;
  }
  zip.file('tracklist.txt', manifest);
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(zipBlob, `${slug}-vo-stems-${stamp}.zip`);
}

export async function exportCueTimelineAudioMix(params: {
  projectName: string;
  stageSlug: 'foley' | 'edit-sfx';
  stageTitle: string;
  totalDurationSec: number;
  cues: Array<{
    cueNumber: string;
    label: string;
    prompt: string;
    startTimeSec: number;
    gain: number;
    muted?: boolean;
    audioUrl: string;
  }>;
  format: 'wav' | 'mp3';
  bitrate: 128 | 192 | 320;
  normalize: boolean;
  mode: 'master' | 'stems';
}): Promise<void> {
  const ctx = getAudioContext();
  const activeCues = params.cues.filter((c) => !c.muted && Boolean(c.audioUrl));
  if (activeCues.length === 0) {
    throw new Error('Generate at least one unmuted audio cue before exporting.');
  }

  const decoded: Array<{
    cue: (typeof activeCues)[number];
    buffer: AudioBuffer;
  }> = [];

  for (const cue of activeCues) {
    const buf = await urlToAudioBuffer(cue.audioUrl, ctx);
    decoded.push({ cue, buffer: buf });
  }

  const slug =
    params.projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'studio';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

  if (params.mode === 'master') {
    const maxEndSec = decoded.reduce(
      (max, item) => Math.max(max, item.cue.startTimeSec + item.buffer.duration),
      params.totalDurationSec || 5
    );
    const sampleRate = 44100;
    const totalFrames = Math.max(sampleRate, Math.ceil(maxEndSec * sampleRate));
    const offline = new OfflineAudioContext(2, totalFrames, sampleRate);

    for (const item of decoded) {
      const src = offline.createBufferSource();
      src.buffer = item.buffer;
      const gainNode = offline.createGain();
      gainNode.gain.value = Math.max(0, Math.min(2, item.cue.gain ?? 1));
      src.connect(gainNode);
      gainNode.connect(offline.destination);
      src.start(Math.max(0, item.cue.startTimeSec));
    }

    const mixedBuffer = await offline.startRendering();
    const blob =
      params.format === 'wav'
        ? audioBufferToWav(mixedBuffer, params.normalize)
        : audioBufferToMp3(mixedBuffer, params.bitrate, params.normalize);
    triggerBlobDownload(blob, `${slug}-${params.stageSlug}-mix-${stamp}.${params.format}`);
    return;
  }

  const zip = new JSZip();
  let manifest = `52Launch Sound Studio — ${params.stageTitle} Stems\n`;
  manifest += `Session: ${params.projectName}\n`;
  manifest += `Exported: ${new Date().toLocaleString()}\n`;
  manifest += `--------------------------------------------------\n\n`;

  for (let i = 0; i < decoded.length; i++) {
    const { cue, buffer } = decoded[i];
    const blob =
      params.format === 'wav'
        ? audioBufferToWav(buffer, params.normalize)
        : audioBufferToMp3(buffer, params.bitrate, params.normalize);
    const filename = `${cue.cueNumber}-t${cue.startTimeSec.toFixed(1)}s.${params.format}`;
    zip.file(filename, blob);
    manifest += `${filename} | @ ${cue.startTimeSec.toFixed(2)}s (${buffer.duration.toFixed(2)}s) | ${cue.label}: ${cue.prompt}\n`;
  }
  zip.file('cue-sheet.txt', manifest);
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(zipBlob, `${slug}-${params.stageSlug}-stems-${stamp}.zip`);
}

export async function exportAudioUrlAsFormat(params: {
  audioUrl: string;
  filenameBase: string;
  format: 'wav' | 'mp3';
  bitrate?: 128 | 192 | 320;
  normalize?: boolean;
}): Promise<void> {
  const ctx = getAudioContext();
  const buffer = await urlToAudioBuffer(params.audioUrl, ctx);
  const blob =
    params.format === 'wav'
      ? audioBufferToWav(buffer, Boolean(params.normalize))
      : audioBufferToMp3(buffer, params.bitrate || 320, Boolean(params.normalize));
  triggerBlobDownload(blob, `${params.filenameBase}.${params.format}`);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
