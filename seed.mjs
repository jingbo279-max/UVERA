import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wjhdsodlxekvhpahascs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqaGRzb2RseGVrdmhwYWhhc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mjg1NDAsImV4cCI6MjA5MjEwNDU0MH0.G6wSn2UzbRmEoz5a6fpos4cKGqJ-hFBsJ5zJcBLQ5Kc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log('Seeding mock users...');
  const { data: users, error: userErr } = await supabase.from('users').insert([
    { contact: 'user1@example.com', type: 'PERSONAL', status: 'ACTIVE' },
    { contact: 'admin@company.com', type: 'ENTERPRISE', status: 'ACTIVE' },
    { contact: '+8613800138000', type: 'PERSONAL', status: 'ACTIVE' },
    { contact: 'user4@domain.co', type: 'PERSONAL', status: 'INACTIVE' },
    { contact: 'studio@creative.net', type: 'ENTERPRISE', status: 'ACTIVE' },
  ]).select();

  if (userErr) {
    console.error('User Seed Error:', userErr);
    return;
  }
  
  console.log(`Created ${users.length} users.`);

  console.log('Seeding mock orders...');
  const mockOrders = [
    { orderNo: 'ORD-1001', userId: users[0].id, subject: 'Pro Subscription (1 Month)', amount: 99.00, status: 1 },
    { orderNo: 'ORD-1002', userId: users[1].id, subject: 'Enterprise Plan (1 Year)', amount: 2999.00, status: 1 },
    { orderNo: 'ORD-1003', userId: users[2].id, subject: 'Credit Top-up (500 pts)', amount: 50.00, status: 0 },
  ];
  
  const { error: orderErr } = await supabase.from('orders').insert(mockOrders);
  if (orderErr) {
    console.error('Order Seed Error:', orderErr);
    return;
  }
  console.log(`Created ${mockOrders.length} orders.`);

  console.log('Seeding mock recommended content...');
  const mockContent = [
    { title: 'Neon Genesis Reflection', artist: 'Cyberpunk Studio', cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop', type: 'VIDEO' },
    { title: 'Midnight City Beats', artist: 'DJ Luma', cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=2674&auto=format&fit=crop', type: 'MUSIC' },
    { title: 'Golden Hour Portrait', artist: 'Ana Photography', cover: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=2576&auto=format&fit=crop', type: 'IMAGE' },
    { title: 'Future UI Concepts', artist: 'NeoDesign', cover: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2560&auto=format&fit=crop', type: 'DESIGN' }
  ];
  const { error: contentErr } = await supabase.from('recommended_content').insert(mockContent);
  if (contentErr) {
    console.error('Content Seed Error:', contentErr);
    return;
  }
  console.log(`Created ${mockContent.length} recommended contents.`);

  console.log('Done!');
}

seed();
