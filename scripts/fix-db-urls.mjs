/**
 * One-shot script to fix all wlpaas.weilitech.cn URLs in the database
 * to use asset.uvera.ai instead.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wjhdsodlxekvhpahascs.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqaGRzb2RseGVrdmhwYWhhc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mjg1NDAsImV4cCI6MjA5MjEwNDU0MH0.G6wSn2UzbRmEoz5a6fpos4cKGqJ-hFBsJ5zJcBLQ5Kc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function fixUrls() {
  console.log('--- Scanning characters table for wlpaas URLs ---');
  
  const { data: chars, error: charErr } = await supabase
    .from('characters')
    .select('id, photo_url')
    .like('photo_url', '%wlpaas.weilitech.cn%');
  
  if (charErr) {
    console.error('Error querying characters:', charErr);
  } else {
    console.log(`Found ${chars.length} characters with wlpaas URLs`);
    for (const row of chars) {
      const newUrl = row.photo_url.replace(/wlpaas\.weilitech\.cn/g, 'asset.uvera.ai');
      console.log(`  [${row.id}] ${row.photo_url} → ${newUrl}`);
      const { error } = await supabase
        .from('characters')
        .update({ photo_url: newUrl })
        .eq('id', row.id);
      if (error) console.error(`    FAILED: ${error.message}`);
      else console.log('    ✅ Updated');
    }
  }

  console.log('\n--- Scanning recommended_content table for wlpaas URLs ---');
  
  const { data: content, error: contentErr } = await supabase
    .from('recommended_content')
    .select('id, cover')
    .like('cover', '%wlpaas.weilitech.cn%');
  
  if (contentErr) {
    console.error('Error querying recommended_content:', contentErr);
  } else {
    console.log(`Found ${content.length} recommended_content rows with wlpaas URLs`);
    for (const row of content) {
      const newUrl = row.cover.replace(/wlpaas\.weilitech\.cn/g, 'asset.uvera.ai');
      console.log(`  [${row.id}] ${row.cover} → ${newUrl}`);
      const { error } = await supabase
        .from('recommended_content')
        .update({ cover: newUrl })
        .eq('id', row.id);
      if (error) console.error(`    FAILED: ${error.message}`);
      else console.log('    ✅ Updated');
    }
  }
  
  console.log('\n--- Done ---');
}

fixUrls();
