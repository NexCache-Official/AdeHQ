-- Dismiss unusable pending topic suggestions that erode owner trust
-- (bare person names, one-word titles, or empty titles left by older heuristics).

update public.topic_suggestions
set
  status = 'dismissed',
  resolved_at = coalesce(resolved_at, now()),
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'autoDismissReason',
    'junk_or_truncated_title_migration'
  )
where status = 'pending'
  and (
    title is null
    or btrim(title) = ''
    or length(btrim(title)) < 4
    or title ~* '^(emily|adrian|wren|priya|maya|team|yes|no|ok|project|follow.?up|discussion|general|misc)(\s|$)'
    or (title !~ '\s' and length(btrim(title)) < 18)
  );
