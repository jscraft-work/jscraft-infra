import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new Hono();
const PORT = process.env.PORT || 4000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const INFRA_DIR = process.env.INFRA_DIR || join(__dirname, '..');
const REPOS_DIR = process.env.REPOS_DIR || join(INFRA_DIR, '..');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function notify(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg }),
    });
  } catch {
    log('[telegram] failed to send notification');
  }
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

if (!WEBHOOK_SECRET) {
  log('WEBHOOK_SECRET is required');
  process.exit(1);
}

// 앱 이름 → compose 디렉토리 + 서비스명 + 리포 정보 매핑
const APP_MAP = {
  'bj-auth': {
    composeDir: join(INFRA_DIR, 'apps/bj-auth'),
    service: 'bj-auth',
  },
  'bj-tetris-server': {
    composeDir: join(INFRA_DIR, 'apps/bj-tetris'),
    service: 'bj-tetris-server',
    repo: 'git@github.com:jscraft-work/bj-tetris.git',
    repoDir: join(REPOS_DIR, 'bj-tetris'),
    buildDir: 'web',
    buildCmd: ['npm', ['run', 'build']],
    staticSrc: 'web/dist',
    staticDest: join(INFRA_DIR, 'web/tetris'),
  },
};

async function syncRepo(app) {
  if (!app.repo) return;

  try {
    await access(join(app.repoDir, '.git'), constants.F_OK);
    log(`[repo] pulling ${app.repoDir}...`);
    await exec('git', ['pull', '--rebase', 'origin', 'main'], { cwd: app.repoDir });
  } catch {
    log(`[repo] cloning ${app.repo}...`);
    await exec('git', ['clone', app.repo, app.repoDir]);
  }

  if (app.buildCmd) {
    const buildCwd = join(app.repoDir, app.buildDir);
    log(`[repo] installing dependencies...`);
    await exec('npm', ['install'], { cwd: buildCwd });
    log(`[repo] building...`);
    await exec(app.buildCmd[0], app.buildCmd[1], { cwd: buildCwd });
  }

  if (app.staticSrc && app.staticDest) {
    log(`[repo] syncing static files → ${app.staticDest}`);
    await exec('rsync', ['-a', '--delete', join(app.repoDir, app.staticSrc) + '/', app.staticDest + '/']);
  }
}

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
    // 리포 clone/pull + 정적파일 동기화
    await syncRepo(app);

    // .env 갱신 (env 필드가 있으면)
    if (env && typeof env === 'object') {
      const envPath = join(app.composeDir, '.env');
      const envContent = Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';
      await writeFile(envPath, envContent);
      log(`[deploy] ${app.key} .env updated`);
    }

    log(`[deploy] pulling ${app.service}...`);
    await exec('docker', ['compose', 'pull', app.service], { cwd: app.composeDir });

    log(`[deploy] restarting ${app.service}...`);
    await exec('docker', ['compose', 'up', '-d', app.service], { cwd: app.composeDir });

    log(`[deploy] ${app.service} deployed successfully`);
    await notify(`[DEPLOY OK] ${app.key} 배포 완료`);
  }

  deployApp().catch((err) => {
    log(`[deploy] ${app.key} failed: ${err.message}`);
    notify(`[DEPLOY FAIL] ${app.key} 배포 실패: ${err.message}`);
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

    log('[infra-update] git pull...');
    await exec('git', ['pull', '--rebase', 'origin', 'main'], { cwd: INFRA_DIR });

    // deploy 서버 의존성 업데이트
    log('[infra-update] npm install...');
    await exec('npm', ['install'], { cwd: join(INFRA_DIR, 'deploy') });

    log('[infra-update] restarting infra services...');
    await exec('docker', ['compose', 'up', '-d'], { cwd: infraComposeDir });

    log('[infra-update] reloading nginx...');
    await exec('docker', ['compose', 'exec', 'nginx', 'nginx', '-s', 'reload'], { cwd: infraComposeDir });

    log('[infra-update] restarting deploy server...');
    await notify('[INFRA OK] 인프라 업데이트 완료');
    await exec('pm2', ['restart', 'ecosystem.config.cjs'], { cwd: join(INFRA_DIR, 'deploy') });
  }

  updateInfra().catch((err) => {
    log(`[infra-update] failed: ${err.message}`);
    notify(`[INFRA FAIL] 인프라 업데이트 실패: ${err.message}`);
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
  log(`[env-sync] ${target} .env updated (${Object.keys(merged).length} keys)`);

  if (restart) {
    const composeDir = target === 'infra'
      ? join(INFRA_DIR, 'infra')
      : APP_MAP[target]?.composeDir;

    if (composeDir) {
      exec('docker', ['compose', 'up', '-d'], { cwd: composeDir }).catch((err) => {
        log(`[env-sync] restart failed: ${err.message}`);
      });
    }
  }

  return c.json({ status: 'synced', target, keys: Object.keys(merged).length });
});

serve({ fetch: app.fetch, port: PORT }, () => {
  log(`Deploy server listening on port ${PORT}`);
});
