---
title: Tokens 与 Ucoin 合并为单一货币(需求变更)
type: decision
status: active
owner: Leon
created: 2026-06-06
updated: 2026-06-09
tags: [currency, tokens, ucoin, wallet, drama-pay, billing, migration, backend]
---

# Tokens × Ucoin 合并为单一「Tokens」(2026-06-06 甲方需求变更)

甲方提出**重大需求变更**:取消双货币,**仅保留 Tokens 一种**。Ucoin(短剧付费点数)
并入 Tokens。

## 当前双货币现状(合并前)

| | Tokens(生成点数) | Ucoin(短剧点数) |
|---|---|---|
| 用途 | AI 生成(视频/图/脚本)扣费 | 解锁短剧付费集 |
| 余额表 | user_metadata / credits(随订阅 + 每日领取 + Lite) | `wallet_balance.ucoins` |
| 充值 | 不单独售卖(订阅/每日/Lite 获得) | Ucoin packs(200/520/1100/2300/6000…),`ucoins_orders` |
| 汇率 | 订阅档位隐含(如 Creator 1500 tokens / $69·mo) | 100 Ucoin ≈ $0.99(`system_settings.ucoins_to_usd_cents`) |
| 消费 RPC | 生成计费(`creditSpend` / `computeVideoCost`) | `wallet_unlock_episode` 等(SECURITY DEFINER) |
| 结算 | — | 月度结算按 Ucoin 收入分成(`settlements`) |

⚠️ **两者单价不同(约数倍差)** —— 合并必须先定**统一汇率**,否则换算存量余额会让
用户资产凭空缩水/膨胀。这是**总开关**,没定其他都不能动。

## 前端已落地(壳,纯导航/布局,已上线,**不碰货币本身**)

为不阻塞、又能呈现最终形态,前端先做了**安全的壳**(commit `983fefe` 一带):
- Wallet 砍掉 `Subscription / Ucoin` 子 tab → 单视图。
- Current Balance(Tokens)卡旁加主 CTA **「Top up」** → 右栏显示充值(`rightPane='topup'`)。
- 每日领取改为余额卡下方**全宽条**(mobile 触控友好)。
- 右栏四态:plans / topup / activity / purchases。
- **Ucoin 名字 + 独立余额暂保留**(过渡态:Top up 面板仍显示「Ucoin 余额」+ Ucoin packs)
  —— 故意不改名,避免后端未合并时线上出现"两个 Tokens"。

## 需费(后端)决定 / 执行 —— 合并真正落地的部分

1. **【总开关】统一汇率**:1 Token = ? USD。决定:
   - 存量 `wallet_balance.ucoins` 怎么折成 Tokens(比例 + 是否补偿)。
   - 订阅档位的 tokens/mo 是否随之调整。
2. **余额合并**:`wallet_balance.ucoins` 与 Tokens/credits 并成**一个池**。定哪张表为
   canonical + 迁移脚本(一次性把所有用户 Ucoin 按汇率加进 Tokens,清零/归档 ucoins)。
3. **统一扣费**:生成计费 + 短剧解锁(`wallet_unlock_episode` / `wallet_credit_purchase` /
   `wallet_refund_purchase`)都改成扣 **Tokens** 单一池。RPC 改写 + FOR UPDATE 锁不变。
4. **短剧定价重算**:`episodes` / `series` 的 Ucoin 价 → 按汇率换成 Tokens 价。
5. **充值 packs 重算**:Ucoin packs → Tokens packs(数量 + $ 价按汇率)。
6. **结算口径**:`settlements` 创作者分成从 Ucoin 收入 → Tokens 收入(汇率换算,历史结算是否回溯)。
7. **历史数据**:`ucoins_orders` / `wallet_tx` / series 价格快照等迁移或加换算视图。

## 待费给出 1(汇率)后,前端收尾(我做)

- Ucoin → **Tokens** 全站改名(余额、packs、流水、Top up 面板)。
- 去掉独立 Ucoin 余额展示(合并后 Current Balance 即唯一余额)。
- packs/短剧价改读后端 Tokens 价(已是后端驱动,换算在后端)。

## 🔒 锁定口径(2026-06-09,Leon 拍板)

- **汇率**:**5 Ucoin = 1 Token**(1 Token = 5¢,**$1 = 20 Tokens**;费最终定 2026-06-09,
  修正早先 4:1)。
- **存量**:全是内测数据,**不补偿**,按 ÷5 折算 + 一条迁移说明。
- **档位**:**方案 B(保价格、÷5 减数量)**。
- **分工**:Claude 做 **前端 + 后端(worker)+ 数据库迁移**;**费做 Stripe**(按下表建 products/prices)。

### 迁移数字(基于现有真实数据)

| 项 | 现值(Ucoin) | → Token(÷5) |
|---|---|---|
| `wallet_balance.ucoins_balance` | 80(购 200 / 花 120) | **16**(购 40 / 花 24) |
| `series.ucoins_per_episode`(2 部剧) | 40 / 集 | **8 / 集** |
| `episodes.ucoins_price_override` | 全 null(继承 series) | 不变(null) |

### 充值档位 → Token 档(方案 B,价格不变、token = ucoins÷5)— **费 Stripe 照此**

| package_id | 原 Ucoin(base+bonus) | $ | → Token(base+bonus) |
|---|---|---|---|
| pkg_099_first(首充翻倍) | 100+100 | $0.99 | **20 + 20 = 40** |
| pkg_199 | 200+0 | $1.99 | **40** |
| pkg_499 | 500+20 | $4.99 | **100 + 4 = 104** |
| pkg_999 | 1000+100 | $9.99 | **200 + 20 = 220** |
| pkg_1999 | 2000+300 | $19.99 | **400 + 60 = 460** |
| pkg_4999 | 5000+1000 | $49.99 | **1000 + 200 = 1200** |

> 价格($/cents)全不变 → 费的 Stripe products/prices **金额不用改**,只改"买到多少 Token"的展示/到账数量(后端到账逻辑由 Claude 改)。

### Stripe 文案(精确字符串,给费照填)

充值档位的 Stripe **product 名称 / 描述**(已改 Tokens、÷5 后):

| package_id | $ | Product name | Description |
|---|---|---|---|
| pkg_099_first(首充翻倍) | $0.99 | `40 Tokens` | `20 + 20 bonus = 40 Tokens` |
| pkg_199 | $1.99 | `40 Tokens` | `40 Tokens` |
| pkg_499 | $4.99 | `104 Tokens` | `100 + 4 bonus = 104 Tokens` |
| pkg_999 | $9.99 | `220 Tokens` | `200 + 20 bonus = 220 Tokens` |
| pkg_1999 | $19.99 | `460 Tokens` | `400 + 60 bonus = 460 Tokens` |
| pkg_4999 | $49.99 | `1200 Tokens` | `1000 + 200 bonus = 1200 Tokens` |

> pack 的 Stripe product 名/描述现由 worker **代码动态生成**(`_worker.js` L8725-8727,模板 `${ucoins} U-Coins`)。Claude 改 worker 时把单位词 `U-Coins`→`Tokens`,数量随迁移后的 packages 配置自动变成上表值。**若费改走 Stripe 预建 Products,就按上表 name/description 建。**

**其余 Stripe Dashboard 项(费确认/改):**
- **Lite**(代码用 `liteProductId`,名字在 Dashboard):确认为 `100 Tokens / Lite`,**无 Ucoin/U-Coins**。
- **订阅**(Starter/Creator/Studio,`priceId`):套餐名无 Ucoin,无需改;顺手确认。
- **Statement descriptor**(信用卡对账单,账户级):确认通用 `UVERA`,不含 Ucoin。
- **收据/发票**:由上面 product 名派生,改完自动跟着变。

**FYI(Stripe 展示但与本次合并无关,不用动):**
- 整剧买断 product(`_worker.js` L8836)`<剧名> — 整剧买断` + 描述 `Unlock all episodes of this series, forever.` —— 非 Ucoin。
- 订阅付款后邮件(L9567)已是「… **tokens** have been added …」✅。

### 执行顺序(Claude P1-P3,与费 Stripe 协调 cutover)

- **P1 DB**:`wallet_balance ÷4 → user_credits`;`series.ucoins_per_episode ÷4`;`ucoins_packages` 改 Token 到账数(apply_migration)。
- **P2 Worker**:短剧解锁 RPC 从扣 `wallet_balance` → 扣 `user_credits`(Token);Ucoin order 到账改记 Token;结算口径转 Token。
- **P3 前端**:Ucoin→Tokens 改名、去独立 Ucoin 余额(Current Balance 即唯一)、packs 显示 Token。
- **cutover**:内测数据可短暂 broken window;与费确认 Stripe 就绪后一次切。

### ✅ 执行记录(2026-06-09,Claude 应用 prod)

通过 supabase CLI + Management API(复用 .mcp.json token,无需 DB 密码)直接应用:

- **P1**(`20260609000001`)✅ — 余额并入 user_credits、wallet_balance 清零、series/packages 折算、哨兵 set。(初按 4:1,见 P1c 修正)
- **P2**(`20260609000002`)✅ — 3 钱包 RPC 改读/写 user_credits(验证 prosrc 全 user_credits、无 wallet_balance);签名不变 worker 零改。
- **P2b**(`20260609000003`)✅ — `ucoins_to_usd_cents` 设值;历史 unlock 折算。
- **P1c 汇率修正**(`20260609000004`)✅ — 费最终定 **$1=20 Tokens(5:1)**,把 4:1 已应用结果改 5:1:余额 6430→**6426**(合并到账 20→**16**)、series 10→**8**、历史 unlock 10→**8**、汇率 4→**5**、packages÷5(pkg_199=**40 Tokens** 等)。
- **P3 代码**(commit 见 git)✅ — `/api/wallet/balance` 读 user_credits;前端+admin Ucoin→Tokens 改名;worker Stripe/tx 文案→Tokens;汇率注记 **$1=20 Tokens**、creator 估算 /20。worker/前端经费自动部署上线。

**短剧解锁/充值/退款全切 Token,$1=20 Tokens,钱逻辑正确。** 待费按上表建/改 Stripe products。
