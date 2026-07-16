-- Seed live brain_pricing_snapshots from V1 catalog rates (idempotent upsert by id).

insert into public.brain_pricing_snapshots (
  id, route_id, currency, effective_from, effective_to,
  input_per_million, output_per_million, cached_input_per_million,
  per_image, per_video, per_thousand_utf8_bytes, per_search_request, per_browser_second,
  source
) values
  ('ps_v4flash_sf_2026-07-16', 'route_text_v4flash_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.13, 0.28, 0.028, null, null, null, null, null, 'seed'),
  ('ps_v4flash_sf_quick_2026-07-16', 'route_text_v4flash_sf_quick', 'USD', '2026-07-16T00:00:00Z', null, 0.13, 0.28, 0.028, null, null, null, null, null, 'seed'),
  ('ps_v4pro_vg_2026-07-16', 'route_text_v4pro_vg', 'USD', '2026-07-16T00:00:00Z', null, 0.43, 0.87, 0.43, null, null, null, null, null, 'seed'),
  ('ps_v4pro_sf_2026-07-16', 'route_text_v4pro_sf_failover', 'USD', '2026-07-16T00:00:00Z', null, 1.5016, 3.135, 0.135, null, null, null, null, null, 'seed'),
  ('ps_minimax_m25_vg_2026-07-16', 'route_text_minimax_m25_vg', 'USD', '2026-07-16T00:00:00Z', null, 0.27, 0.95, 0.27, null, null, null, null, null, 'seed'),
  ('ps_minimax_m25_sf_2026-07-16', 'route_text_minimax_m25_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.3, 1.2, 0.03, null, null, null, null, null, 'seed'),
  ('ps_qwen3_coder_sf_2026-07-16', 'route_text_qwen3_coder_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.5, 1.0, 0.5, null, null, null, null, null, 'seed'),
  ('ps_qwen3_8b_sf_2026-07-16', 'route_text_qwen3_8b_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.06, 0.06, 0.06, null, null, null, null, null, 'seed'),
  ('ps_embed_qwen3_sf_2026-07-16', 'route_embed_qwen3_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.02, 0.02, 0.02, null, null, null, null, null, 'seed'),
  ('ps_search_tavily_2026-07-16', 'route_search_tavily', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, null, 0.008, null, 'seed'),
  ('ps_browser_browserbase_2026-07-16', 'route_browser_browserbase', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, null, null, 0.002, 'seed'),
  ('ps_image_z_turbo_2026-07-16', 'route_image_z_image_turbo', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, 0.005, null, null, null, null, 'seed'),
  ('ps_image_qwen_2026-07-16', 'route_image_qwen_image', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, 0.02, null, null, null, null, 'seed'),
  ('ps_image_qwen_edit_2026-07-16', 'route_image_qwen_image_edit', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, 0.04, null, null, null, null, 'seed'),
  ('ps_image_flux2_2026-07-16', 'route_image_flux2_flex', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, 0.06, null, null, null, null, 'seed'),
  ('ps_video_wan22_2026-07-16', 'route_video_wan22', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, 0.29, null, null, null, 'seed'),
  ('ps_tts_cosyvoice_2026-07-16', 'route_tts_cosyvoice', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, 0.00715, null, null, 'seed'),
  ('ps_eval_qwen36_2026-07-16', 'route_eval_qwen36', 'USD', '2026-07-16T00:00:00Z', null, 0.2, 0.6, 0.2, null, null, null, null, null, 'seed'),
  ('ps_eval_glm52_2026-07-16', 'route_eval_glm52', 'USD', '2026-07-16T00:00:00Z', null, 0.5, 1.5, 0.5, null, null, null, null, null, 'seed'),
  ('ps_eval_minimax_m3_2026-07-16', 'route_eval_minimax_m3', 'USD', '2026-07-16T00:00:00Z', null, 0.4, 1.2, 0.4, null, null, null, null, null, 'seed')
on conflict (id) do nothing;
