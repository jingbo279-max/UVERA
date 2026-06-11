import { supabase } from './supabaseClient';

/* Migration: 20260506_follows_table */

const requireAuth = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Requires authentication');
  return session.user.id;
};

/**
 * Fetch the set of user IDs the current user is following.
 * Returns Set<string> (UUIDs); empty set if not logged in or on error.
 */
export const fetchUserFollowing = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return new Set();
    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', session.user.id);
    if (error) throw error;
    return new Set((data || []).map(r => r.following_id));
  } catch (err) {
    console.error('Failed to fetch user following:', err);
    return new Set();
  }
};

/**
 * Toggle follow status. Returns the new following state (true = now
 * following, false = now unfollowed).
 *
 * Self-follow is silently no-op'd because the DB CHECK constraint would
 * reject it; we early-return to avoid a confusing 23514 error in the UI.
 */
export const toggleFollowStatus = async (targetUserId, isCurrentlyFollowing) => {
  try {
    const userId = await requireAuth();
    if (userId === targetUserId) return isCurrentlyFollowing;
    if (isCurrentlyFollowing) {
      const { error } = await supabase
        .from('follows')
        .delete()
        .match({ follower_id: userId, following_id: targetUserId });
      if (error) throw error;
      return false;
    } else {
      const { error } = await supabase
        .from('follows')
        .insert({ follower_id: userId, following_id: targetUserId });
      if (error) throw error;
      return true;
    }
  } catch (err) {
    console.error('Failed to toggle follow:', err);
    throw err;
  }
};

/**
 * Fetch the list of users the current user follows, enriched with
 * profile info (username, avatar) for display.
 *
 * Implementation: two PostgREST queries — `follows` rows for the
 * follower_id, then `profiles` for those IDs. PostgREST can't
 * auto-embed across two FKs to auth.users.id, so we join client-side.
 *
 * Returns an array sorted by follow-time (newest first) of:
 *   { id, username, avatar_url, followed_at }
 */
export const fetchFollowingList = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const userId = session.user.id;

    const { data: follows, error: fErr } = await supabase
      .from('follows')
      .select('following_id, created_at')
      .eq('follower_id', userId)
      .order('created_at', { ascending: false });
    if (fErr) throw fErr;
    if (!follows || follows.length === 0) return [];

    const ids = follows.map(f => f.following_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', ids);
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    return follows.map(f => ({
      id: f.following_id,
      username:    profileMap.get(f.following_id)?.username   || null,
      avatar_url:  profileMap.get(f.following_id)?.avatar_url || null,
      followed_at: f.created_at,
    }));
  } catch (err) {
    console.error('Failed to fetch following list:', err);
    return [];
  }
};

/**
 * Fetch the list of users who follow the current user. Symmetric to
 * fetchFollowingList but pivots on following_id instead.
 */
export const fetchFollowerList = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const userId = session.user.id;

    const { data: follows, error: fErr } = await supabase
      .from('follows')
      .select('follower_id, created_at')
      .eq('following_id', userId)
      .order('created_at', { ascending: false });
    if (fErr) throw fErr;
    if (!follows || follows.length === 0) return [];

    const ids = follows.map(f => f.follower_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', ids);
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    return follows.map(f => ({
      id: f.follower_id,
      username:    profileMap.get(f.follower_id)?.username   || null,
      avatar_url:  profileMap.get(f.follower_id)?.avatar_url || null,
      followed_at: f.created_at,
    }));
  } catch (err) {
    console.error('Failed to fetch follower list:', err);
    return [];
  }
};
