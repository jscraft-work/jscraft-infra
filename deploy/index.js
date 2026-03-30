import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new Hono();
const PORT = process.env.PORT || 4000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const INFRA_DIR = process.env.INFRA_DIR || join(__dirname, '..');

if (!WEBHOOK_SECRET) {
  console.error('WEBHOOK_SECRET is required');
  process.exit(1);
}

// 앱 이름 → compose 디렉토리 + 서비스명 매핑
const APP_MAP = {
  'bj-auth': { composeDir: join(INFRA_DIR, 'apps/bj-auth'), service: 'bj-auth' },
  'bj-tetris-server': { composeDir: join(INFRA_DIR, 'apps/bj-tetris'), service: 'bj-tetris-server' },
};

function verifySignature(secret, payload, signature) {
  if (!signature) return false;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  const expected = `sha256=${hmac}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function resolveApp(image) {
  for (const [key, app] of Object.entries(APP_MAP)) {
    if (image.includes(key)) return { key, ...app };
  }
  return null;
}

function verifyOrReject(c, rawBody) {
  const signature = c.req.header('x-hub-signature-256') || c.req.header('x-signature-256');
  if (!verifySignature(WEBHOOK_SECRET, rawBody, signature)) {
    return false;
  }
  return true;
}

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// 앱 배포: .env 갱신 + docker pull + restart
app.post('/webhook/deploy', async (c) => {
  const rawBody = await c.req.text();
  if (!verifyOrReject(c, rawBody)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const body = JSON.parse(rawBody);
  const { image, env } = body;

  if (!image) {
    return c.json({ error: 'missing image field' }, 400);
  }

  const app = resolveApp(image);
  if (!app) {
    return c.json({ error: `unknown image: ${image}` }, 400);
  }

  async function deployApp() {
    // .env 갱신 (env 필드가 있으면)
    if (env && typeof env === 'object') {
      const envPath = join(app.composeDir, '.env');
      const envContent = Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';
      await writeFile(envPath, envContent);
      console.log(`[deploy] ${app.key} .env updated`);
    }

    console.log(`[deploy] pulling ${app.service}...`);
    await exec('docker', ['compose', 'pull', app.service], { cwd: app.composeDir });

    console.log(`[deploy] restarting ${app.service}...`);
    await exec('docker', ['compose', 'up', '-d', app.service], { cwd: app.composeDir });

    console.log(`[deploy] ${app.service} deployed successfully`);
  }

  deployApp().catch((err) => {
    console.error(`[deploy] ${app.key} failed: ${err.message}`);
  });

  return c.json({ status: 'deploying', service: app.service });
});

// 인프라 업데이트: git pull + docker compose up + nginx reload
app.post('/webhook/infra-update', async (c) => {
  const rawBody = await c.req.text();
  if (!verifyOrReject(c, rawBody)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  async function updateInfra() {
    const infraComposeDir = join(INFRA_DIR, 'infra');

    console.log('[infra-update] git pull...');
    await exec('git', ['pull', 'origin', 'main'], { cwd: INFRA_DIR });

    console.log('[infra-update] restarting infra services...');
    await exec('docker', ['compose', 'up', '-d'], { cwd: infraComposeDir });

    console.log('[infra-update] reloading nginx...');
    await exec('docker', ['compose', 'exec', 'nginx', 'nginx', '-s', 'reload'], { cwd: infraComposeDir });

    console.log('[infra-update] done');
  }

  updateInfra().catch((err) => {
    console.error(`[infra-update] failed: ${err.message}`);
  });

  return c.json({ status: 'updating' });
});

// 인프라 .env 갱신
app.post('/webhook/env-sync', async (c) => {
  const rawBody = await c.req.text();
  if (!verifyOrReject(c, rawBody)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const body = JSON.parse(rawBody);
  const { target, env, restart } = body;

  if (!env || typeof env !== 'object') {
    return c.json({ error: 'missing or invalid env field' }, 400);
  }

  // target: "infra" 또는 앱 이름 ("bj-auth", "bj-tetris")
  let envPath;
  if (target === 'infra') {
    envPath = join(INFRA_DIR, 'infra', '.env');
  } else if (APP_MAP[target]) {
    envPath = join(APP_MAP[target].composeDir, '.env');
  } else {
    return c.json({ error: `unknown target: ${target}` }, 400);
  }

  // 기존 .env에서 부트스트랩 값 보존
  const PRESERVE_KEYS = ['WEBHOOK_SECRET'];
  let preserved = {};

  try {
    const existing = await readFile(envPath, 'utf-8');
    for (const line of existing.split('\n')) {
      const match = line.match(/^(\w+)=(.*)$/);
      if (match && PRESERVE_KEYS.includes(match[1])) {
        preserved[match[1]] = match[2];
      }
    }
  } catch {
    // .env가 없으면 무시
  }

  const merged = { ...env, ...preserved };
  const envContent = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

  await writeFile(envPath, envContent);
  console.log(`[env-sync] ${target} .env updated (${Object.keys(merged).length} keys)`);

  if (restart) {
    const composeDir = target === 'infra'
      ? join(INFRA_DIR, 'infra')
      : APP_MAP[target]?.composeDir;

    if (composeDir) {
      exec('docker', ['compose', 'up', '-d'], { cwd: composeDir }).catch((err) => {
        console.error(`[env-sync] restart failed: ${err.message}`);
      });
    }
  }

  return c.json({ status: 'synced', target, keys: Object.keys(merged).length });
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Deploy server listening on port ${PORT}`);
});
