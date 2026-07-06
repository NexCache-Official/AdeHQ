-- Hard-delete topic workstream summaries when chat history is cleared.
-- Ensures topic_summaries rows cannot survive clear-chat even if app delete fails.

-- Backfill chat_cleared_at from legacy metadata-only clears.
update public.topics
set chat_cleared_at = (metadata ->> 'chatClearedAt')::timestamptz
where chat_cleared_at is null
  and metadata ? 'chatClearedAt'
  and coalesce(metadata ->> 'chatClearedAt', '') <> '';

create or replace function public.purge_topic_workstream_summary(
  p_workspace_id uuid,
  p_topic_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.topic_summaries
  where workspace_id = p_workspace_id
    and topic_id = p_topic_id;

  update public.topics
  set
    summary = null,
    pinned_summary = null,
    metadata = coalesce(metadata, '{}'::jsonb) - 'memorySuggestionLifecycle',
    updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_topic_id;
end;
$$;

comment on function public.purge_topic_workstream_summary(uuid, uuid) is
  'Removes durable topic summary rows and legacy topic.summary fields for a topic.';

create or replace function public.handle_topic_chat_cleared()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.chat_cleared_at is not null
     and (old.chat_cleared_at is null or new.chat_cleared_at > old.chat_cleared_at) then
    delete from public.topic_summaries
    where workspace_id = new.workspace_id
      and topic_id = new.id;

    new.summary := null;
    new.pinned_summary := null;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) - 'memorySuggestionLifecycle';
  end if;

  return new;
end;
$$;

drop trigger if exists topics_purge_summary_on_chat_clear on public.topics;
create trigger topics_purge_summary_on_chat_clear
before update of chat_cleared_at on public.topics
for each row
execute function public.handle_topic_chat_cleared();
