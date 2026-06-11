/**
 * §2026-05-25 fei: server-persisted story drafts (Supabase).
 *
 * Background: StoryGeneratorPage's draft auto-save wrote to localStorage
 * only — drafts didn't survive device / browser switches.
 * This module gives those drafts a server-side home (public.story_drafts
 * table, RLS-scoped to own rows).
 *
 * Schema: one row per (user_id, generation_mode). UPSERT semantics so
 * editing a draft updates the same row in place.
 *
 * Caller pattern:
 *   - StoryGeneratorPage: localStorage immediate + debounced upsertDraft()
 *   - LibraryPage: listDrafts() on mount, falls back to localStorage if
 *     server returns empty (covers anonymous users + offline)
 *   - resetWorkflowState: deleteDraft() in addition to clearing localStorage
 */

import { supabase } from './supabaseClient';

/**
 * Fetch all of the current user's drafts (most-recent first).
 * Returns [] if not authenticated, on error, or if user has none.
 * Errors are LOGGED not thrown — drafts are an enhancement, not critical.
 */
export const listDrafts = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabase
      .from('story_drafts')
      .select('id, generation_mode, data, created_at, updated_at')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('[draftService] listDrafts failed:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[draftService] listDrafts exception:', err);
    return [];
  }
};

/**
 * UPSERT a single draft. mode must be 'quick' | 'free' | 'upload' | 'series'.
 * The `data` arg should be the FULL serializable draft state (same shape
 * as localStorage 'uvera_story_draft').
 *
 * Returns true on success, false on failure. Errors LOGGED not thrown
 * — frontend keeps working from localStorage if server save fails.
 */
export const upsertDraft = async (mode, data) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;  // anonymous = localStorage only
    if (!['quick', 'free', 'upload', 'series'].includes(mode)) {
      console.warn(`[draftService] invalid mode "${mode}" — ignoring upsert`);
      return false;
    }
    const { error } = await supabase
      .from('story_drafts')
      .upsert(
        { user_id: session.user.id, generation_mode: mode, data },
        { onConflict: 'user_id,generation_mode' }
      );
    if (error) {
      console.warn(`[draftService] upsert ${mode} failed:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[draftService] upsert ${mode} exception:`, err);
    return false;
  }
};

/**
 * Delete one mode's draft for current user. No-op if not authenticated
 * or row doesn't exist. Errors LOGGED not thrown.
 */
export const deleteDraft = async (mode) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase
      .from('story_drafts')
      .delete()
      .eq('user_id', session.user.id)
      .eq('generation_mode', mode);
  } catch (err) {
    console.warn(`[draftService] delete ${mode} exception:`, err);
  }
};

/**
 * Delete ALL drafts for current user (used by "discard everything" flow).
 */
export const deleteAllDrafts = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase
      .from('story_drafts')
      .delete()
      .eq('user_id', session.user.id);
  } catch (err) {
    console.warn('[draftService] deleteAll exception:', err);
  }
};
