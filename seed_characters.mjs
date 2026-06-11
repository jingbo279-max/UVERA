import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wjhdsodlxekvhpahascs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqaGRzb2RseGVrdmhwYWhhc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mjg1NDAsImV4cCI6MjA5MjEwNDU0MH0.G6wSn2UzbRmEoz5a6fpos4cKGqJ-hFBsJ5zJcBLQ5Kc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function seedCharacters() {
  console.log('Seeding mock characters (user works)...');
  
  // First get a user to assign them to
  const { data: users } = await supabase.from('users').select('id').limit(1);
  const userId = users && users.length > 0 ? users[0].id : 'temp_user_test';

  const mockCharacters = [
    { 
      user_id: userId, 
      photo_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=2564&auto=format&fit=crop', 
      identity_features: '{"gender": "female", "style": "cyberpunk"}',
      status: 'success'
    },
    { 
      user_id: 'temp_user_123', 
      photo_url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=2487&auto=format&fit=crop', 
      identity_features: '{"gender": "male", "style": "formal"}',
      status: 'success'
    },
    { 
      user_id: 'temp_user_456', 
      photo_url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?q=80&w=2550&auto=format&fit=crop', 
      identity_features: '{"gender": "female", "style": "casual"}',
      status: 'success'
    }
  ];

  const { error: charErr } = await supabase.from('characters').insert(mockCharacters);
  if (charErr) {
    console.error('Character Seed Error:', charErr);
    return;
  }
  
  console.log(`Created ${mockCharacters.length} character assets.`);
  console.log('Done!');
}

seedCharacters();
