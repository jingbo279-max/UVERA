import { supabase } from './supabaseClient';

/**
 * Toggle the published / unpublished state of a recommended_content row.
 *
 * RLS on recommended_content enforces that only the owner (auth.uid() =
 * artist) can update their row — direct supabase call from the client
 * is safe; no service-role / worker endpoint needed.
 *
 * - published: true   → work appears in Discover feed + everywhere
 * - published: false  → work is hidden from public feeds; stays in
 *                       the owner's own profile / library
 *
 * Returns { ok: true, published: boolean } on success, throws on error.
 * The caller is expected to do an optimistic UI update.
 *
 * Note: this does NOT touch `published_at` — that timestamp records
 * the FIRST publish time and we preserve it across toggles so the
 * audit trail is meaningful. If a future product decision requires
 * "last published at" semantics, add a separate column.
 */
export const togglePublishedStatus = async (workId, makePublished) => {
  if (!workId) throw new Error('workId required');
  const patch = { published: !!makePublished };
  // Only set published_at on first publish (when going false→true and
  // no prior timestamp exists). Subsequent toggles preserve original.
  if (makePublished) {
    const { data: existing } = await supabase
      .from('recommended_content')
      .select('published_at')
      .eq('id', workId)
      .single();
    if (existing && !existing.published_at) {
      patch.published_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabase
    .from('recommended_content')
    .update(patch)
    .eq('id', workId)
    .select('id, published, published_at')
    .single();
  if (error) {
    console.error('togglePublishedStatus failed:', error);
    throw new Error(error.message || 'Failed to update visibility');
  }
  return { ok: true, published: data.published, published_at: data.published_at };
};
