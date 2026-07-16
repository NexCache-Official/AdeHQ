-- AdeHQ Brain PR-11: catalog v2 seed — new routes + exact pricing.
-- Preserves live production text/search snapshots. Does not activate media/vision/voice.

-- Close snapshots that must be repriced or retired (unique live-per-route).
update public.brain_pricing_snapshots
set effective_to = now()
where effective_to is null
  and (
    id in (
      'ps_eval_qwen36_2026-07-16',
      'ps_eval_glm52_2026-07-16',
      'ps_eval_minimax_m3_2026-07-16',
      'ps_video_wan22_2026-07-16',
      'ps_tts_cosyvoice_2026-07-16'
    )
    or route_id in (
      'route_eval_glm52',
      'route_eval_minimax_m3',
      'route_eval_qwen36'
    )
  );

insert into public.brain_pricing_snapshots (
  id, route_id, currency, effective_from, effective_to,
  input_per_million, output_per_million, cached_input_per_million,
  per_image, per_video, per_thousand_utf8_bytes, per_search_request, per_browser_second,
  source
) values
  ('ps_minimax_m25_vg_native_2026-07-16', 'route_text_minimax_m25_vg_native', 'USD', '2026-07-16T00:00:00Z', null, 0.3, 1.2, 0.3, null, null, null, null, null, 'seed'),
  ('ps_step35_flash_sf_2026-07-16', 'route_classify_step35_flash_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.1, 0.3, 0.1, null, null, null, null, null, 'seed'),
  ('ps_search_perplexity_2026-07-16', 'route_search_perplexity', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, null, 0.005, null, 'seed'),
  ('ps_search_exa_2026-07-16', 'route_search_exa', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, null, 0.007, null, 'seed'),
  ('ps_vision_vl8b_sf_2026-07-16', 'route_vision_qwen3_vl_8b_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.18, 0.68, 0.18, null, null, null, null, null, 'seed'),
  ('ps_vision_vl32b_sf_2026-07-16', 'route_vision_qwen3_vl_32b_sf', 'USD', '2026-07-16T00:00:00Z', null, 0.2, 1.5, 0.2, null, null, null, null, null, 'seed'),
  ('ps_video_wan22_t2v_2026-07-16', 'route_video_wan22_t2v', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, 0.29, null, null, null, 'seed'),
  ('ps_video_wan22_i2v_2026-07-16', 'route_video_wan22_i2v', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, 0.29, null, null, null, 'seed'),
  ('ps_tts_cosyvoice2_2026-07-16', 'route_tts_cosyvoice2', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, 0.00715, null, null, 'seed'),
  ('ps_tts_indextts2_2026-07-16', 'route_tts_indextts2', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, 0.00715, null, null, 'seed'),
  ('ps_tts_fish_speech_2026-07-16', 'route_tts_fish_speech', 'USD', '2026-07-16T00:00:00Z', null, null, null, null, null, null, 0.015, null, null, 'seed'),
  ('ps_eval_kimi_k27_2026-07-16', 'route_eval_kimi_k27_code', 'USD', '2026-07-16T00:00:00Z', null, 0.8592, 3.8, 0.1799, null, null, null, null, null, 'seed'),
  ('ps_eval_qwen36_35b_2026-07-16', 'route_eval_qwen36_35b', 'USD', '2026-07-16T00:00:00Z', null, 0.2, 1.6, 0.2, null, null, null, null, null, 'seed'),
  ('ps_eval_qwen36_27b_2026-07-16', 'route_eval_qwen36_27b', 'USD', '2026-07-16T00:00:00Z', null, 0.3, 3.2, 0.3, null, null, null, null, null, 'seed'),
  ('ps_eval_glm52_v2_2026-07-16', 'route_eval_glm52', 'USD', '2026-07-16T00:00:00Z', null, 1.302, 4.092, 0.26, null, null, null, null, null, 'seed'),
  ('ps_eval_minimax_m3_v2_2026-07-16', 'route_eval_minimax_m3', 'USD', '2026-07-16T00:00:00Z', null, 0.3, 1.2, 0.06, null, null, null, null, null, 'seed')
on conflict (id) do nothing;
