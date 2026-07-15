/** True when a topic id is a Postgres uuid (not a client-only `topic-general-*` key). */
export function isPersistedTopicId(topicId: string | null | undefined): boolean {
  if (!topicId) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    topicId,
  );
}
