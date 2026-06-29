-- Coerce legacy OpenAI employees and workspace defaults to SiliconFlow.
update public.ai_employees
set provider = 'siliconflow'
where lower(provider) in ('openai', 'anthropic', 'gemini', 'perplexity', 'openrouter');

update public.workspace_ai_settings
set default_provider = 'siliconflow'
where default_provider = 'openai';
