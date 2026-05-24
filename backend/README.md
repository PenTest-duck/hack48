# Hack48 Backend

Modal serverless backend for recording analysis.

## Setup

```bash
cd backend
uv run --python 3.12 pytest
uv run --python 3.12 modal setup
```

Required local or Modal secret values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `MODAL_ANALYSIS_SECRET`

Deploy:

```bash
cd backend
uv run --python 3.12 modal deploy modal_app.py
```

Run the E2E upload fixture:

```bash
cd backend
uv run --python 3.12 python -m backend.tools.e2e_upload_bundle \
  --bundle ../playground/data/iphone-data-2 \
  --task-id 106760b6-43ec-41bd-b6f6-340b00db1d58 \
  --wait score
```
