-- Open the Supabase Dashboard, go to SQL Editor, and paste this to initialize the database:

CREATE TABLE IF NOT EXISTS public.users (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "contact" text NOT NULL,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  "orderNo" text PRIMARY KEY,
  "userId" uuid REFERENCES public.users("id"),
  "subject" text NOT NULL,
  "amount" numeric NOT NULL,
  "status" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recommended_content (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" text NOT NULL,
  "artist" text NOT NULL,
  "cover" text NOT NULL,
  "type" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_configs (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.characters (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id" text NOT NULL,
  "photo_url" text NOT NULL,
  "identity_features" jsonb NOT NULL,
  "status" text DEFAULT 'success',
  "createdAt" timestamp with time zone DEFAULT now()
);

-- Enable RLS (Row Level Security) and add open policies for testing
-- WARNING: These policies allow anonymous SELECT, INSERT, UPDATE, DELETE for prototyping.
-- In production, you must restrict this either through server-side functions or authenticated RLS!

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommended_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all access to users" ON public.users FOR ALL USING (true);
CREATE POLICY "Allow public all access to orders" ON public.orders FOR ALL USING (true);
CREATE POLICY "Allow public all access to recommended_content" ON public.recommended_content FOR ALL USING (true);
CREATE POLICY "Allow public all access to system_configs" ON public.system_configs FOR ALL USING (true);
CREATE POLICY "Allow public all access to characters" ON public.characters FOR ALL USING (true);
