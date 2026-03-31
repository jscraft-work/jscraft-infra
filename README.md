# jscraft-infra

jscraft.work 서비스들의 인프라 구성 및 배포 자동화 리포지토리.

Docker Compose 기반으로 서비스를 운영하며, GitHub Actions + Webhook 기반 CI/CD 파이프라인을 통해 자동 배포합니다.

## 서비스

| 서비스 | URL | 설명 |
|--------|-----|------|
| bj-auth | https://auth.jscraft.work | OAuth2 인증 서버 (Spring Boot) |
| bj-tetris | https://tetris.jscraft.work | 테트리스 게임 (프론트엔드) |
| bj-tetris API | https://tetris-api.jscraft.work | 테트리스 백엔드 (Spring Boot) |
| deploy | https://deploy.jscraft.work | 배포 웹훅 서버 (Hono) |

## 구조

```
jscraft-infra/
├── infra/                 # 공유 인프라 (PostgreSQL, Redis, Nginx)
├── apps/
│   ├── bj-auth/           # bj-auth 앱 compose + .env
│   └── bj-tetris/         # bj-tetris 앱 compose + .env
├── nginx/                 # Nginx 설정 파일
├── postgres/              # DB 초기화 스크립트
├── deploy/                # 배포 웹훅 서버 (Hono/Node.js)
├── cloudflared/           # 터널 설정 참고
├── docs/                  # 문서
│   └── deployment.md      # 배포 구조 및 프로세스
├── setup.sh               # 서버 초기 세팅 스크립트
└── Makefile               # 서비스 관리 명령어 (make help)
```

## 시작하기

```bash
# 초기 세팅
./setup.sh

# 서비스 관리
make help
```

## 문서

- [배포 구조 및 프로세스](docs/deployment.md)
