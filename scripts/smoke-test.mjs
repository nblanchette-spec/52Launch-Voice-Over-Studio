import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const VALID_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
  'base64'
);
const USERNAME = 'smoke-user';
const PASSWORD = 'smoke-test-password-123';
const BASIC_AUTH_HEADER = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`, 'utf8').toString('base64')}`;

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Could not allocate ephemeral port.')));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function runProcessExpectFailure(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Expected production startup without APP_PASSWORD to fail quickly, but it hung.'));
    }, 10_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function startProdServer({ port, dataDir }) {
  const child = spawn(process.execPath, ['server.ts'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATA_DIR: dataDir,
      APP_USERNAME: USERNAME,
      APP_PASSWORD: PASSWORD,
      ALLOW_UNAUTHENTICATED: 'false',
      GEMINI_API_KEY: '',
      FAL_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited prematurely with code ${child.exitCode}.\nLogs:\n${logs}`);
    }
    try {
      const resp = await fetch(`${baseUrl}/api/projects`, {
        headers: { Authorization: BASIC_AUTH_HEADER },
      });
      if (resp.ok) {
        return { child, baseUrl };
      }
    } catch {
      // Wait for socket bind
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  child.kill('SIGTERM');
  throw new Error(`Timed out waiting for server at ${baseUrl}.\nLogs:\n${logs}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function main() {
  const distIndexPath = path.join(ROOT_DIR, 'dist', 'index.html');
  try {
    await fs.access(distIndexPath);
  } catch {
    throw new Error('dist/index.html is missing. Run "npm run build" before running "npm run test:smoke".');
  }

  const tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), '52launch-smoke-'));
  let activeServer = null;

  try {
    console.log('1. Checking production startup refuses missing APP_PASSWORD...');
    const refusePort = await getFreePort();
    const refused = await runProcessExpectFailure(process.execPath, ['server.ts'], {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(refusePort),
      DATA_DIR: tempDataDir,
      APP_USERNAME: USERNAME,
      APP_PASSWORD: '',
      ALLOW_UNAUTHENTICATED: 'false',
    });
    assert.notEqual(refused.code, 0, 'Production startup without APP_PASSWORD must exit non-zero');
    assert.match(
      `${refused.stdout}\n${refused.stderr}`,
      /APP_PASSWORD must be set/i,
      'Startup refusal must explain APP_PASSWORD requirement'
    );

    console.log('2. Starting production server with disposable DATA_DIR and Basic Auth...');
    const port1 = await getFreePort();
    activeServer = await startProdServer({ port: port1, dataDir: tempDataDir });
    const { baseUrl } = activeServer;

    console.log('3. Checking access gate blocks unauthenticated and arbitrary Bearer requests...');
    const unauthPage = await fetch(`${baseUrl}/`);
    assert.equal(unauthPage.status, 401, 'Unauthenticated GET / must return 401');

    const unauthApi = await fetch(`${baseUrl}/api/projects`);
    assert.equal(unauthApi.status, 401, 'Unauthenticated GET /api/projects must return 401');

    const bearerOnly = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer fake-bearer-token' },
    });
    assert.equal(bearerOnly.status, 401, 'Bearer token alone must not grant app access');

    console.log('4. Checking authenticated frontend, API, model defaults, and JSON 404...');
    const authPage = await fetch(`${baseUrl}/`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(authPage.status, 200, 'Authenticated GET / must return 200');
    const html = await authPage.text();
    assert.match(html, /<!doctype html/i, 'Frontend response must serve built HTML');

    const llmStatusRes = await fetch(`${baseUrl}/api/pipeline/llm-status`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(llmStatusRes.status, 200);
    const llmStatus = await llmStatusRes.json();
    assert.equal(llmStatus.geminiTextModel, 'gemini-3.5-flash-lite');
    assert.equal(llmStatus.falGeminiModel, 'google/gemini-3.5-flash-lite');

    const notFoundApi = await fetch(`${baseUrl}/api/does-not-exist`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(notFoundApi.status, 404, 'Unknown /api/* route must return 404');
    assert.match(
      notFoundApi.headers.get('content-type') || '',
      /application\/json/i,
      'Unknown /api/* route must return JSON'
    );
    const notFoundJson = await notFoundApi.json();
    assert.ok(notFoundJson.error, 'Unknown /api/* 404 must contain error field');

    console.log('5. Checking project creation & asset upload/serving security...');
    const createRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client: 'Smoke Test Client',
        product: {
          name: 'Smoke Test Widget',
          description: 'Synthetic VO session for smoke verification.',
        },
      }),
    });
    assert.equal(createRes.status, 200, 'Project creation must succeed');
    const { project } = await createRes.json();
    assert.ok(project?.id, 'Created project must have an id');

    const uploadRes = await fetch(`${baseUrl}/api/projects/${project.id}/assets`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix: '../bad/prefix',
        dataUrl: `data:image/png;base64,${VALID_PNG_BYTES.toString('base64')}`,
      }),
    });
    assert.equal(uploadRes.status, 200, 'Valid PNG upload must succeed');
    const uploadedAsset = await uploadRes.json();
    assert.ok(uploadedAsset.filename.startsWith('bad-prefix-'), `Prefix must be sanitized, got: ${uploadedAsset.filename}`);
    assert.ok(!uploadedAsset.filename.includes('..') && !uploadedAsset.filename.includes('/'));

    const assetGetRes = await fetch(`${baseUrl}${uploadedAsset.url}`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(assetGetRes.status, 200, 'Uploaded asset must be served cleanly');
    assert.equal(
      assetGetRes.headers.get('x-content-type-options'),
      'nosniff',
      'Served asset must include X-Content-Type-Options: nosniff'
    );
    const servedBytes = Buffer.from(await assetGetRes.arrayBuffer());
    assert.ok(servedBytes.equals(VALID_PNG_BYTES), 'Served asset bytes must match uploaded PNG bytes');

    const invalidUploadRes = await fetch(`${baseUrl}/api/projects/${project.id}/assets`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix: 'evil',
        dataUrl: `data:text/html;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`,
      }),
    });
    assert.equal(invalidUploadRes.status, 400, 'Unsupported upload MIME type must be rejected with 400');

    const invalidAssetGetRes = await fetch(`${baseUrl}/api/projects/${project.id}/assets/payload.html`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(invalidAssetGetRes.status, 400, 'Unsupported asset extension on GET must be rejected with 400');

    console.log('6. Checking ElevenLabs catalog & deterministic script import endpoints...');
    const elVoicesRes = await fetch(`${baseUrl}/api/pipeline/elevenlabs-voices`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(elVoicesRes.status, 200, 'ElevenLabs voices endpoint must return 200');
    const elVoicesJson = await elVoicesRes.json();
    assert.ok(Array.isArray(elVoicesJson.voices) && elVoicesJson.voices.length > 0, 'ElevenLabs curated catalog must be non-empty');

    const emptyImportRes = await fetch(`${baseUrl}/api/pipeline/vo-import-script`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId: project.id, rawText: '   ' }),
    });
    assert.equal(emptyImportRes.status, 400, 'Empty script import must return 400');

    const importRes = await fetch(`${baseUrl}/api/pipeline/vo-import-script`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: project.id,
        rawText: 'Narrator: (warmly) Precision meets emotion.\n\nTalent: Ready when you are.',
        useAiEnhance: false,
        replaceExisting: true,
      }),
    });
    assert.equal(importRes.status, 200, 'Deterministic script import must succeed offline');
    const importedJson = await importRes.json();
    assert.equal(importedJson.project?.voScript?.length, 2, 'Imported script must contain 2 parsed cues');
    assert.equal(importedJson.project.voScript[0].speaker, 'Narrator');
    assert.equal(importedJson.project.voScript[0].line, 'Precision meets emotion.');
    assert.equal(importedJson.project.voScript[1].speaker, 'Talent');

    console.log('7. Checking backup export, unsafe backup rejection, restore, and restart persistence...');
    const backupRes = await fetch(`${baseUrl}/api/projects/${project.id}/backup`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(backupRes.status, 200, 'Backup export must succeed');
    const backupBundle = await backupRes.json();
    assert.equal(backupBundle.format, '52launch-project-backup');
    assert.ok(backupBundle.embeddedAssets[uploadedAsset.filename], 'Backup must embed uploaded PNG asset');

    const badBackupRes = await fetch(`${baseUrl}/api/projects/import-backup`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...backupBundle,
        project: { ...backupBundle.project, id: `${project.id}-bad` },
        embeddedAssets: {
          'malicious.html': `data:text/html;base64,${Buffer.from('<h1>bad</h1>').toString('base64')}`,
        },
      }),
    });
    assert.equal(badBackupRes.status, 400, 'Backup with unsupported asset file must be rejected with 400');

    const restoredId = `${project.id}-restored`;
    const restoreRes = await fetch(`${baseUrl}/api/projects/import-backup`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...backupBundle,
        project: { ...backupBundle.project, id: restoredId },
      }),
    });
    assert.equal(restoreRes.status, 200, 'Legitimate backup restore must succeed');

    // Restart server against same DATA_DIR to verify disk persistence
    await stopServer(activeServer.child);
    activeServer = null;

    const port2 = await getFreePort();
    activeServer = await startProdServer({ port: port2, dataDir: tempDataDir });

    const persistedProjectRes = await fetch(`${activeServer.baseUrl}/api/projects/${restoredId}`, {
      headers: { Authorization: BASIC_AUTH_HEADER },
    });
    assert.equal(persistedProjectRes.status, 200, 'Restored project must persist across server restarts');

    const persistedAssetRes = await fetch(
      `${activeServer.baseUrl}/api/projects/${restoredId}/assets/${uploadedAsset.filename}`,
      { headers: { Authorization: BASIC_AUTH_HEADER } }
    );
    assert.equal(persistedAssetRes.status, 200, 'Restored asset must persist across server restarts');
    const persistedBytes = Buffer.from(await persistedAssetRes.arrayBuffer());
    assert.ok(persistedBytes.equals(VALID_PNG_BYTES), 'Persisted asset bytes must remain identical after restart');

    console.log('ALL SMOKE CHECKS PASSED');
  } finally {
    if (activeServer?.child) {
      await stopServer(activeServer.child);
    }
    await fs.rm(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
