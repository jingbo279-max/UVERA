import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wjhdsodlxekvhpahascs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqaGRzb2RseGVrdmhwYWhhc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mjg1NDAsImV4cCI6MjA5MjEwNDU0MH0.G6wSn2UzbRmEoz5a6fpos4cKGqJ-hFBsJ5zJcBLQ5Kc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function seedMore() {
  console.log('Seeding more mock recommended content...');
  const mockContent = [
    { title: 'Abstract Liquid Metal', artist: 'Zeta 3D', cover: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2670&auto=format&fit=crop', type: 'VIDEO' },
    { title: 'Cyber City Rain', artist: 'HoloLens Studio', cover: 'https://images.unsplash.com/photo-1515630278258-407f66498911?q=80&w=2698&auto=format&fit=crop', type: 'VIDEO' },
    { title: 'Synthesizer Waveforms', artist: 'AudioMax', cover: 'https://plus.unsplash.com/premium_photo-1661877737564-3e5f20f01eb3?q=80&w=2670&auto=format&fit=crop', type: 'AUDIO' },
    { title: 'Astro-Botanicals', artist: 'Plant AI', cover: 'https://images.unsplash.com/photo-1454789548928-111def59a0f?q=80&w=2400&auto=format&fit=crop', type: 'IMAGE' },
    { title: 'Quantum Computing Nodes', artist: 'TechVision', cover: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2670&auto=format&fit=crop', type: 'DESIGN' },
    { title: 'Desert Solitude', artist: 'Nomad Chronicles', cover: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=80&w=2621&auto=format&fit=crop', type: 'IMAGE' },
    { title: 'Lofi Chill Hop Beats', artist: 'Sunset Radio', cover: 'https://images.unsplash.com/photo-1516280440502-85194488b14a?q=80&w=2670&auto=format&fit=crop', type: 'AUDIO' },
    { title: 'Neon Car Drift', artist: 'SpeedForce', cover: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?q=80&w=2670&auto=format&fit=crop', type: 'VIDEO' }
  ];
  
  const { error: contentErr } = await supabase.from('recommended_content').insert(mockContent);
  if (contentErr) {
    console.error('Content Seed Error:', contentErr);
    return;
  }
  console.log(`Created ${mockContent.length} recommended contents successfully!`);
}

seedMore();
