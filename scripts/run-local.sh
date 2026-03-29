#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

docker-compose -f docker-compose.infra.yml up -d chroma
echo "Chroma started on 127.0.0.1:8000"
echo "Start local web index: npm run webindex:dev"
echo "Start llama.cpp server separately, bound to 127.0.0.1."
echo "Then run: npm install && npm run dev"
