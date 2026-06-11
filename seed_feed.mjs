import { createClient } from '@supabase/supabase-js';
import { mediaItems } from './src/data/mediaItems.js';

const supabaseUrl = 'https://wjhdsodlxekvhpahascs.supabase.co';
// Using the same anon key that seed_characters uses to insert
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqaGRzb2RseGVrdmhwYWhhc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mjg1NDAsImV4cCI6MjA5MjEwNDU0MH0.G6wSn2UzbRmEoz5a6fpos4cKGqJ-hFBsJ5zJcBLQ5Kc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function seedFeed() {
  console.log('Seeding mock recommended content feed...');
  
  // Transform the media items to match the DB schema.
  // legacy `type` column dropped 2026-04-23 — use media_kind instead.
  const dbItems = mediaItems.map(item => ({
    title: item.title || 'Untitled',
    artist: item.artist || 'Unknown',
    cover: item.cover || '',
    media_kind: 'Video',
  }));

  const { error } = await supabase.from('recommended_content').insert(dbItems);
  if (error) {
    console.error('Seed feed error:', error);
    return;
  }
  
  console.log(`Successfully seeded ${dbItems.length} items to recommended_content!`);
}

seedFeed();
