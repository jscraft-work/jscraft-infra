-- 신규 postgres 컨테이너의 PGDATA가 비어있을 때만 1회 실행 (멱등).
-- bj_auth는 POSTGRES_DB 환경변수로도 자동 생성되지만, 다른 환경/리셋 대비해 같이 둠.

SELECT 'CREATE DATABASE bj_auth'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bj_auth')\gexec

SELECT 'CREATE DATABASE bj_tetris'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bj_tetris')\gexec

SELECT 'CREATE DATABASE alt'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'alt')\gexec
