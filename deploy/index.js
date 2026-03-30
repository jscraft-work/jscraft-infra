import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);

const app = new Hono();
const PORT = process.env.PORT || 4000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const COMPOSE_DIR = process.env.COMPOSE_DIR || '/opt/jscraft-infra';

if (!WEBHOOK_SECRET) {
  console.error('WEBHOOK_SECRET is required');
  process.exit(1);
}

// 서비스 이미지 → docker compose 서비스명 매핑
const IMAGE_SERVICE_MAP = {
  'bj-auth': 'bj-auth',
  'bj-tetris-server': 'bj-tetris-server',
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

function resolveService(image) {
  for (const [key, service] of Object.entries(IMAGE_SERVICE_MAP)) {
    if (image.includes(key)) return service;
  }
  return null;
}

async function deploy(service) {
  console.log(`[deploy] pulling ${service}...`);
  await exec('docker', ['compose', 'pull', service], { cwd: COMPOSE_DIR });

  console.log(`[deploy] restarting ${service}...`);
  await exec('docker', ['compose', 'up', '-d', service], { cwd: COMPOSE_DIR });

  console.log(`[deploy] ${service} deployed successfully`);
}

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Webhook endpoint
app.post('/webhook/deploy', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-hub-signature-256') || c.req.header('x-signature-256');

  if (!verifySignature(WEBHOOK_SECRET, rawBody, signature)) {
    console.warn('[webhook] invalid signature');
    return c.json({ error: 'invalid signature' }, 401);
  }

  const body = JSON.parse(rawBody);
  const image = body.image;

  if (!image) {
    return c.json({ error: 'missing image field' }, 400);
  }

  const service = resolveService(image);
  if (!service) {
    return c.json({ error: `unknown image: ${image}` }, 400);
  }

  // 비동기로 배포 실행 (webhook 응답은 바로 반환)
  deploy(service).catch((err) => {
    console.error(`[deploy] failed: ${err.message}`);
  });

  return c.json({ status: 'deploying', service });
});

// Env sync endpoint
app.post('/webhook/env-sync', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-hub-signature-256') || c.req.header('x-signature-256');

  if (!verifySignature(WEBHOOK_SECRET, rawBody, signature)) {
    console.warn('[env-sync] invalid signature');
    return c.json({ error: 'invalid signature' }, 401);
  }

  const body = JSON.parse(rawBody);
  const { env } = body;

  if (!env || typeof env !== 'object') {
    return c.json({ error: 'missing or invalid env field' }, 400);
  }

  const envPath = join(COMPOSE_DIR, '.env');

  // 기존 .env에서 WEBHOOK_SECRET, TUNNEL_TOKEN은 보존 (부트스트랩 값)
  const PRESERVE_KEYS = ['WEBHOOK_SECRET', 'TUNNEL_TOKEN'];
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

  // 병합: 부트스트랩 값 우선 보존
  const merged = { ...env, ...preserved };
  const envContent = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

  await writeFile(envPath, envContent);
  console.log(`[env-sync] .env updated (${Object.keys(merged).length} keys)`);

  // 서비스 재시작 (선택)
  if (body.restart) {
    const services = Array.isArray(body.restart) ? body.restart : [body.restart];
    for (const service of services) {
      deploy(service).catch((err) => {
        console.error(`[env-sync] restart ${service} failed: ${err.message}`);
      });
    }
  }

  return c.json({ status: 'synced', keys: Object.keys(merged).length });
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Deploy server listening on port ${PORT}`);
});
