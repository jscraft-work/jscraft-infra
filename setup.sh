#!/bin/bash
set -e

# jscraft-infra 초기 세팅 스크립트
# macOS (맥미니) 서버용

# sudo 비밀번호 미리 캐시
sudo -v

INSTALL_DIR="/opt/jscraft"
REPO_URL="git@github.com:jscraft-work/jscraft-infra.git"

echo "=== jscraft-infra 초기 세팅 ==="

# 1. 디렉토리 생성
if [ ! -d "$INSTALL_DIR" ]; then
  echo "[1/6] 디렉토리 생성: $INSTALL_DIR"
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown $(whoami):staff "$INSTALL_DIR"
else
  echo "[1/6] 디렉토리 이미 존재: $INSTALL_DIR"
fi

# 2. 리포 clone
if [ ! -d "$INSTALL_DIR/jscraft-infra" ]; then
  echo "[2/6] git clone..."
  git clone "$REPO_URL" "$INSTALL_DIR/jscraft-infra"
else
  echo "[2/6] 리포 이미 존재, git pull..."
  cd "$INSTALL_DIR/jscraft-infra"
  git pull origin main
fi

cd "$INSTALL_DIR/jscraft-infra"

# 3. .env 파일 세팅
echo "[3/6] .env 파일 세팅..."

if [ ! -f infra/.env ]; then
  cp infra/.env.example infra/.env
  echo "  → infra/.env 생성됨 (값을 수정하세요)"
else
  echo "  → infra/.env 이미 존재"
fi

if [ ! -f apps/bj-auth/.env ]; then
  cp apps/bj-auth/.env.example apps/bj-auth/.env
  echo "  → apps/bj-auth/.env 생성됨 (값을 수정하세요)"
else
  echo "  → apps/bj-auth/.env 이미 존재"
fi

if [ ! -f apps/bj-tetris/.env ]; then
  cp apps/bj-tetris/.env.example apps/bj-tetris/.env
  echo "  → apps/bj-tetris/.env 생성됨 (값을 수정하세요)"
else
  echo "  → apps/bj-tetris/.env 이미 존재"
fi

if [ ! -f deploy/.env ]; then
  cp deploy/.env.example deploy/.env
  echo "  → deploy/.env 생성됨 (값을 수정하세요)"
else
  echo "  → deploy/.env 이미 존재"
fi

# 4. deploy 서버 의존성 설치
echo "[4/6] deploy 서버 npm install..."
cd deploy
npm install
cd ..

# 5. deploy 서버 pm2 등록
echo "[5/7] deploy 서버 pm2 등록..."
mkdir -p "$INSTALL_DIR/logs"

# pm2 설치 (없으면)
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
  echo "  → pm2 설치됨"
fi

# deploy 서버 시작
cd "$INSTALL_DIR/jscraft-infra/deploy"
pm2 start ecosystem.config.js
pm2 startup
pm2 save
echo "  → deploy 서버 시작됨"
cd "$INSTALL_DIR/jscraft-infra"

# 6. Docker 네트워크 생성
echo "[6/7] Docker 네트워크 확인..."
if ! docker network inspect jscraft >/dev/null 2>&1; then
  docker network create jscraft
  echo "  → jscraft 네트워크 생성됨"
else
  echo "  → jscraft 네트워크 이미 존재"
fi

# 7. 안내
echo ""
echo "=== 세팅 완료 ==="
echo ""
echo "다음 단계:"
echo "  1. .env 파일들의 값을 채우세요:"
echo "     - infra/.env (DB_USERNAME, DB_PASSWORD, ALT_FAST_DIST)"
echo "     - apps/bj-auth/.env"
echo "     - apps/bj-tetris/.env"
echo "     - deploy/.env (WEBHOOK_SECRET)"
echo ""
echo "  2. cloudflared config에 ingress 추가:"
echo "     sudo vi /etc/cloudflared/config.yml"
echo "     (cloudflared/config.yml.example 참고)"
echo "     sudo cloudflared service restart"
echo ""
echo "  3. 서비스 시작:"
echo "     cd $INSTALL_DIR/jscraft-infra"
echo "     cd deploy && node index.js &"
echo "     cd ../infra && docker compose up -d"
echo "     cd ../apps/bj-auth && docker compose up -d"
echo "     cd ../apps/bj-tetris && docker compose up -d"
