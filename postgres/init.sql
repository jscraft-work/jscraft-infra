-- bj_auth DB는 POSTGRES_DB 환경변수로 자동 생성됨
-- bj_tetris DB 추가 생성 (멱등성 보장)
SELECT 'CREATE DATABASE bj_tetris'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bj_tetris')\gexec
