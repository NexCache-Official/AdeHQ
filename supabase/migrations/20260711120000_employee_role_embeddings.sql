-- Employee role embeddings for deterministic (non-LLM) orchestration role
-- matching. Stored as plain jsonb float arrays, not pgvector — a workspace
-- has at most a few dozen employees, so cosine similarity is computed in
-- application code against this small in-memory set; no HNSW index needed.

alter table public.ai_employees
  add column if not exists role_embedding jsonb;

alter table public.ai_employees
  add column if not exists role_embedding_source text;

comment on column public.ai_employees.role_embedding is
  'Precomputed embedding vector (float array) of this employee''s role/instructions, used for fast deterministic role-match in room orchestration. Recomputed lazily when role_embedding_source no longer matches the current role summary.';
