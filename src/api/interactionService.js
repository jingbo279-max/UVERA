import { supabase } from './supabaseClient';

/**
 * Ensures the user is logged in
 */
const requireAuth = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Requires authentication");
  return session.user.id;
};

/**
 * Fetch all content IDs currently liked and saved by the user.
 * Returns { likedItems: Set<string>, savedItems: Set<string> }
 */
export const fetchUserInteractions = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { likedItems: new Set(), savedItems: new Set() };
    
    const userId = session.user.id;
    
    const [likesRes, savesRes] = await Promise.all([
      supabase.from('user_likes').select('content_id').eq('user_id', userId),
      supabase.from('user_saves').select('content_id').eq('user_id', userId)
    ]);
    
    const likedSet = new Set((likesRes.data || []).map(row => row.content_id));
    const savedSet = new Set((savesRes.data || []).map(row => row.content_id));
    
    return { likedItems: likedSet, savedItems: savedSet };
  } catch (err) {
    console.error("Failed to fetch user interactions:", err);
    return { likedItems: new Set(), savedItems: new Set() };
  }
};

/**
 * Toggle like status on the server.
 * Returns true if liked, false if unliked.
 */
export const toggleLikeStatus = async (contentId, isCurrentlyLiked) => {
  try {
    const userId = await requireAuth();
    if (isCurrentlyLiked) {
      const { error } = await supabase.from('user_likes').delete().match({ user_id: userId, content_id: contentId });
      if (error) throw error;
      return false;
    } else {
      const { error } = await supabase.from('user_likes').insert({ user_id: userId, content_id: contentId });
      if (error) throw error;
      return true;
    }
  } catch (err) {
    console.error("Failed to toggle like:", err);
    throw err;
  }
};

/**
 * Toggle save status on the server.
 * Returns true if saved, false if unsaved.
 */
export const toggleSaveStatus = async (contentId, isCurrentlySaved) => {
  try {
    const userId = await requireAuth();
    if (isCurrentlySaved) {
      const { error } = await supabase.from('user_saves').delete().match({ user_id: userId, content_id: contentId });
      if (error) throw error;
      return false;
    } else {
      const { error } = await supabase.from('user_saves').insert({ user_id: userId, content_id: contentId });
      if (error) throw error;
      return true;
    }
  } catch (err) {
    console.error("Failed to toggle save:", err);
    throw err;
  }
};
