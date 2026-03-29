# Engineering Runbook: Local Agentic RAG 

This document is the implementation and operations guide for building and running this app from zero on a CPU machine.


## 1) Environment and CPU Expectations

CPU-only is supported and acceptable.

Common risk areas on CPU laptops:

- Build hangs due to too many parallel compile jobs.
- Slow inference for chat model if model is too large or not quantized.
- Embedding server failures if physical batch size is too small.

Use controlled concurrency:

- Build: `-j4` to `-j8` (start conservative).
- Chat threads: 6-8.
- Embeddings threads: 4-6
- 

## 2) Installation and Build

### 2.1 Clone and build llama.cpp

```bash
cd <folder_for_model_hosting>
git clone https://github.com/ggml-org/llama.cpp.git
cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF
nice -n 10 cmake --build llama.cpp/build --target llama-server -- -j6
```

Notes:

- Do not use bare `-j` on constrained machines.
- `cmake` builds binaries only; it does not download models.

### 3.2 Download models (correct repos/files)

```bash
mkdir -p ~/models
python3 -m pip install --user -U "huggingface_hub[cli]"

# Chat model 
huggingface-cli download bartowski/Qwen2.5-7B-Instruct-GGUF Qwen2.5-7B-Instruct-Q4_K_M.gguf --local-dir ~/models

# Embedding model
huggingface-cli download ggml-org/embeddinggemma-300M-GGUF embeddinggemma-300M-Q8_0.gguf --local-dir ~/models
```

Important:

- File names and repo IDs are case-sensitive.
- Many 401/404 errors from HF are actually wrong repo/file names.

## 4) Start Services in Correct Order

### 4.1 Chroma

```bash
docker-compose -f docker-compose.infra.yml up -d chroma
```

### 4.2 Chat server

```bash
<folder_for_model_hosting>/llama.cpp/build/bin/llama-server \
  -m ~/models/Qwen2.5-7B-Instruct-Q4_K_M.gguf \
  --host 127.0.0.1 --port 8081 \
  --ctx-size 4096 \
  --threads 8 \
  --n-gpu-layers 0
```

### 4.3 Embeddings server 

```bash
<folder_for_model_hosting>/llama.cpp/build/bin/llama-server \
  -m ~/models/embeddinggemma-300M-Q8_0.gguf \
  --host 127.0.0.1 --port 8082 \
  --embeddings \
  --threads 6 \
  --batch-size 2048 \
  --ubatch-size 1024 \
  --parallel 1 \
  --no-cont-batching \
  --n-gpu-layers 0
```

Critical debugging note:

- `--batch-size` is logical batch.
- `--ubatch-size` is physical batch.
- The error `input (...) is too large ... current batch size: 512` means `--ubatch-size` is still default.

### 4.4 Optional web index

<tbd>


### 4.5 App server

```bash
cd <repo folder>
npm install @langchain/langgraph@latest @langchain/core@latest
npm install
npm run dev
```

## 5) Required `.env` Defaults

Core values:

```env
LLAMA_CHAT_BASE_URL=http://127.0.0.1:8081
LLAMA_EMBED_BASE_URL=http://127.0.0.1:8082
LLAMA_CHAT_MODEL=Qwen2.5-7B-Instruct-Q4_K_M.gguf
LLAMA_EMBED_MODEL=embeddinggemma-300M-Q8_0.gguf
CHROMA_URL=http://127.0.0.1:8000
LOCAL_WEB_INDEX_URL=http://127.0.0.1:4005
```

If intentionally running without web index, disable fallback:

```env
LOCAL_CONFIDENCE_THRESHOLD=0
```

## 6) Ingestion and Delta Behavior

- put `.txt` / `.md` / `.pdf` files in `./docs` (subdirectories supported)

Use:

```bash
npm run ingest -- docs
```

Expected behavior:

- Logs each scanned file.
- Prints whether file is new/changed/unchanged.
- Shows chunking + embedding batch progress.
- Deletes stale chunks for removed/changed files.
- Writes manifest to `logs/ingest-manifest.json`.

Status:

```bash
npm run ingest:status
```

This command should:

- Show manifest path used.
- List tracked docs and chunk counts.
- Support legacy manifest at `data/ingest-manifest.json`.

If you are embedding the docs via UI - it will require from you the folder path and display when the documents are embedded. 

## 7) Querying 

Query for answer with metadata:

```bash
curl -s http://127.0.0.1:8080/ask \
  -H "content-type: application/json" \
  -d '{"query":"How to add new records to the database in mongo db?"}'
```

Human-readable answer only:

```bash
curl -s http://127.0.0.1:8080/ask \
  -H "content-type: application/json" \
  -d '{"query":"How to add new records to the database in mongo db?"}' \
  | jq -r '.answer'
```

