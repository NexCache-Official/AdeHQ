-- Client message idempotency: dedupe human sends by workspace + client_message_id
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_workspace_client_message_id_unique
  ON public.messages (workspace_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

COMMENT ON COLUMN public.messages.client_message_id IS
  'Client-generated id for idempotent message sends; deduped per workspace.';
