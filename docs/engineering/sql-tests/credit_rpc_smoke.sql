-- §2026-05-29 — credit RPC 冒烟断言。在 Supabase SQL editor 逐段跑。
-- 注意:spend_credits/grant_credits 是 service_role only。SQL editor 默认以
-- postgres 超级用户身份跑(能调);若以受限角色跑需先 SET ROLE service_role。
-- 用一个【真实测试用户 id】替换下面的占位 uuid(从 auth.users 取一个测试账号)。

-- ── 用占位 uuid(末尾全 0)做隔离测试,跑完即清理 ──────────────────────────
-- 1) grant 100,余额应 +100
SELECT public.grant_credits('00000000-0000-0000-0000-000000000000'::uuid, 100, 'admin_grant', null, null, 'test');
-- 2) spend 30,余额应 70,返回 success:true balance_after:70
SELECT public.spend_credits('00000000-0000-0000-0000-000000000000'::uuid, 30, 'spend_video', 'task-x', 'test');
-- 3) spend 9999,应 insufficient:true
SELECT public.spend_credits('00000000-0000-0000-0000-000000000000'::uuid, 9999, 'spend_video', 'task-y', 'test');
-- 4) grant 幂等:同 key 两次,余额只 +5 一次
SELECT public.grant_credits('00000000-0000-0000-0000-000000000000'::uuid, 5, 'refund', 'task-x', 'refund:task-x', 'test');
SELECT public.grant_credits('00000000-0000-0000-0000-000000000000'::uuid, 5, 'refund', 'task-x', 'refund:task-x', 'test'); -- 期望 idempotent:true
-- 5) 最终余额 = 100 - 30 + 5 = 75
SELECT balance FROM public.user_credits WHERE user_id = '00000000-0000-0000-0000-000000000000';
-- 期望:75

-- ── 清理 ────────────────────────────────────────────────────────────────────
DELETE FROM public.credit_tx WHERE user_id = '00000000-0000-0000-0000-000000000000';
DELETE FROM public.user_credits WHERE user_id = '00000000-0000-0000-0000-000000000000';

-- 注:占位 uuid 不在 auth.users 里,user_credits.user_id 有 FK REFERENCES
-- auth.users(id)。若 FK 拒绝插入,改用一个真实测试账号 uuid 跑(并相应调整
-- 期望值,跑前先记下该账号原余额,跑后清理掉本脚本插入的 credit_tx 测试行)。
