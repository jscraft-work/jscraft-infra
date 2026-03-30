.PHONY: help up down restart pull logs ps health cloudflared-restart

help:
	@echo "=== jscraft-infra ==="
	@echo "  make up                 전체 시작"
	@echo "  make down               전체 중지"
	@echo "  make restart            전체 재시작"
	@echo "  make pull               앱 이미지 pull"
	@echo "  make ps                 컨테이너 상태"
	@echo "  make health             헬스체크"
	@echo "  make logs svc=bj-auth   로그 보기"
	@echo ""
	@echo "=== 개별 ==="
	@echo "  make up-auth            bj-auth 시작"
	@echo "  make up-tetris          bj-tetris 시작"
	@echo "  make up-infra           인프라 시작"
	@echo "  make deploy-auth        auth 배포 (pull+restart)"
	@echo "  make deploy-tetris      tetris 배포 (pull+restart)"
	@echo ""
	@echo "=== 기타 ==="
	@echo "  make cloudflared-restart  터널 재시작"
	@echo "  make deploy-server        deploy 서버 실행"

# 전체
up:
	cd infra && docker compose up -d
	cd apps/bj-auth && docker compose up -d
	cd apps/bj-tetris && docker compose up -d

down:
	cd apps/bj-tetris && docker compose down
	cd apps/bj-auth && docker compose down
	cd infra && docker compose down

restart:
	$(MAKE) down
	$(MAKE) up

pull:
	cd apps/bj-auth && docker compose pull
	cd apps/bj-tetris && docker compose pull

ps:
	docker ps

logs:
	docker logs -f $(svc)

health:
	@echo "=== auth ===" && curl -sI http://localhost:9000 | head -1
	@echo "=== tetris ===" && curl -s http://localhost:9001/api/health
	@echo "\n=== nginx ===" && curl -sI http://localhost:8080 | head -1
	@echo "=== deploy ===" && curl -s http://localhost:4000/health

# 개별 앱
up-auth:
	cd apps/bj-auth && docker compose up -d

up-tetris:
	cd apps/bj-tetris && docker compose up -d

up-infra:
	cd infra && docker compose up -d

# 배포 (pull + restart)
deploy-auth:
	cd apps/bj-auth && docker compose pull && docker compose up -d

deploy-tetris:
	cd apps/bj-tetris && docker compose pull && docker compose up -d

# cloudflared
cloudflared-restart:
	sudo launchctl kickstart -k system/com.cloudflare.cloudflared

# deploy 서버
deploy-server:
	cd deploy && node --env-file=.env index.js
