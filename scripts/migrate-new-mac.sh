#!/bin/bash
# ============================================================
# longvv 项目 — 新 MBP M5 Pro 初始化脚本
# 在新机上运行此脚本完成所有环境配置
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; }
step() { echo -e "\n${CYAN}[$1] $2${NC}"; }

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  longvv 新机初始化 — MBP 2026 M5 Pro${NC}"
echo -e "${GREEN}================================================${NC}"

# ─── 路径定义 ─────────────────────────────────────────────
GDRIVE_ROOT="$HOME/Library/CloudStorage/GoogleDrive-leonsuen@gmail.com/My Drive"
LONGVV_REAL="$GDRIVE_ROOT/longvv"
LONGVV_LINK="$HOME/longvv"
DEV_PATH="$LONGVV_LINK/04-Development"

# ============================================================
step "1/8" "Homebrew"
# ============================================================
if command -v brew &>/dev/null; then
  ok "Homebrew 已安装 ($(brew --prefix))"
else
  echo "  安装 Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon: 写入 shell profile
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  eval "$(/opt/homebrew/bin/brew shellenv)"
  ok "Homebrew 已安装"
fi

# ============================================================
step "2/8" "核心依赖"
# ============================================================
BREW_PKGS=(node ffmpeg yt-dlp jq)
for pkg in "${BREW_PKGS[@]}"; do
  if brew list "$pkg" &>/dev/null; then
    ok "$pkg 已安装"
  else
    echo "  安装 $pkg..."
    brew install "$pkg"
    ok "$pkg 已安装"
  fi
done

echo ""
echo "  当前版本："
echo "    Node.js: $(node -v)"
echo "    npm:     $(npm -v)"
echo "    FFmpeg:  $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"

# ============================================================
step "3/8" "Google Drive 符号链接"
# ============================================================
# 等待 Google Drive 同步
if [ ! -d "$LONGVV_REAL" ]; then
  warn "Google Drive 尚未同步完成"
  echo "  请先登录 Google Drive Desktop 并等待 longvv 目录出现"
  echo "  路径: $LONGVV_REAL"
  echo ""
  read -p "  同步完成后按 Enter 继续..."
fi

if [ -L "$LONGVV_LINK" ]; then
  CURRENT_TARGET=$(readlink "$LONGVV_LINK")
  if [ "$CURRENT_TARGET" = "$LONGVV_REAL" ]; then
    ok "~/longvv 符号链接已正确"
  else
    warn "~/longvv 指向旧路径: $CURRENT_TARGET"
    rm "$LONGVV_LINK"
    ln -s "$LONGVV_REAL" "$LONGVV_LINK"
    ok "~/longvv 符号链接已更新"
  fi
elif [ -e "$LONGVV_LINK" ]; then
  fail "~/longvv 已存在且不是符号链接，请手动处理"
  exit 1
else
  ln -s "$LONGVV_REAL" "$LONGVV_LINK"
  ok "~/longvv → $LONGVV_REAL"
fi

# Google Drive 根目录链接
GD_LINK="$HOME/Google Drive"
GD_ROOT="$HOME/Library/CloudStorage/GoogleDrive-leonsuen@gmail.com"
if [ ! -L "$GD_LINK" ]; then
  ln -s "$GD_ROOT" "$GD_LINK"
  ok "~/Google Drive → $GD_ROOT"
else
  ok "~/Google Drive 链接已存在"
fi

# ============================================================
step "4/8" "npm install"
# ============================================================
if [ -d "$DEV_PATH" ]; then
  cd "$DEV_PATH"
  echo "  正在安装依赖（arm64 原生编译）..."
  npm install
  ok "node_modules 已安装"
else
  fail "开发目录不存在: $DEV_PATH"
  echo "  请确认 Google Drive 已同步完成"
  exit 1
fi

# ============================================================
step "5/8" "SSH 密钥"
# ============================================================
SSH_DIR="$HOME/.ssh"
if [ -f "$SSH_DIR/id_ed25519" ]; then
  ok "SSH 密钥已存在"
  echo "    $(cat "$SSH_DIR/id_ed25519.pub")"
else
  warn "未检测到 SSH 密钥"
  echo ""
  echo "  请从旧机迁移（推荐 AirDrop）："
  echo "    旧机 → 新机: ~/.ssh/id_ed25519 + id_ed25519.pub + known_hosts"
  echo "    新机权限: chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_ed25519"
  echo ""
  echo "  或者生成新密钥（需要添加到服务器 authorized_keys）："
  echo "    ssh-keygen -t ed25519 -C \"uvera-deploy\""
  echo "    ssh-copy-id root@47.102.201.142"
  echo ""
  read -p "  处理完成后按 Enter 继续..."
fi

# 测试 SSH 连接
echo "  测试服务器连接..."
if ssh -o ConnectTimeout=5 -o BatchMode=yes root@47.102.201.142 "echo ok" &>/dev/null; then
  ok "SSH 到 47.102.201.142 连接成功"
else
  warn "SSH 连接失败，请检查密钥或网络"
fi

# ============================================================
step "6/8" "launchd Dev Server 守护进程"
# ============================================================
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/com.longvv.devserver.plist"
NODE_PATH=$(which node)
NPM_PATH=$(which npm)
BREW_BIN=$(dirname "$NPM_PATH")

mkdir -p "$PLIST_DIR"

cat > "$PLIST_FILE" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- longvv Dev Server — port 5176 (永久固定) -->
  <key>Label</key>
  <string>com.longvv.devserver</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NPM_PATH}</string>
    <string>run</string>
    <string>dev</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${LONGVV_LINK}/04-Development</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${BREW_BIN}:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>5</integer>

  <key>StandardOutPath</key>
  <string>/tmp/longvv-dev.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/longvv-dev.err</string>

  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
PLIST

launchctl load "$PLIST_FILE" 2>/dev/null || true
ok "com.longvv.devserver 已配置并加载"
echo "    npm 路径: $NPM_PATH"
echo "    工作目录: $LONGVV_LINK/04-Development"

# 等待启动
sleep 3
if lsof -i :5176 | grep -q LISTEN; then
  ok "Dev Server 已在端口 5176 运行"
else
  warn "Dev Server 尚未就绪，查看日志: cat /tmp/longvv-dev.err"
fi

# ============================================================
step "7/8" "Shell 配置"
# ============================================================
ZPROFILE="$HOME/.zprofile"
ZSHRC="$HOME/.zshrc"

# .zprofile — Homebrew (通常安装时已添加)
if ! grep -q "brew shellenv" "$ZPROFILE" 2>/dev/null; then
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$ZPROFILE"
  ok "Homebrew shellenv 已添加到 .zprofile"
else
  ok ".zprofile Homebrew 配置已存在"
fi

# .zshrc — 项目快捷命令
if ! grep -q "longvv" "$ZSHRC" 2>/dev/null; then
  cat >> "$ZSHRC" << 'ZSHRC_BLOCK'

# longvv 项目
export LONGVV_PATH="$HOME/longvv"
alias lv='cd "$LONGVV_PATH/04-Development"'
alias lvdev='cd "$LONGVV_PATH/04-Development" && npm run dev'
alias lvbuild='cd "$LONGVV_PATH/04-Development" && npm run build'
alias lvdeploy='cd "$LONGVV_PATH/04-Development" && npm run build && ./deploy/deploy.sh'
ZSHRC_BLOCK
  ok "longvv 快捷命令已添加到 .zshrc"
else
  ok ".zshrc longvv 配置已存在"
fi

# ============================================================
step "8/8" "Git 全局配置"
# ============================================================
GIT_NAME=$(git config --global user.name 2>/dev/null || true)
GIT_EMAIL=$(git config --global user.email 2>/dev/null || true)

if [ -z "$GIT_NAME" ] || [ -z "$GIT_EMAIL" ]; then
  warn "Git 全局用户未配置"
  echo ""
  read -p "  输入 Git user.name (例: Leon): " INPUT_NAME
  read -p "  输入 Git user.email (例: leonsuen@gmail.com): " INPUT_EMAIL
  git config --global user.name "$INPUT_NAME"
  git config --global user.email "$INPUT_EMAIL"
  ok "Git 已配置: $INPUT_NAME <$INPUT_EMAIL>"
else
  ok "Git 已配置: $GIT_NAME <$GIT_EMAIL>"
fi

# ============================================================
# 最终验证
# ============================================================
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  初始化完成！最终检查：${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""

CHECK_PASS=0
CHECK_TOTAL=0

verify() {
  CHECK_TOTAL=$((CHECK_TOTAL + 1))
  if eval "$1" &>/dev/null; then
    ok "$2"
    CHECK_PASS=$((CHECK_PASS + 1))
  else
    fail "$2"
  fi
}

verify "command -v node"                          "Node.js $(node -v 2>/dev/null)"
verify "command -v npm"                           "npm $(npm -v 2>/dev/null)"
verify "command -v ffmpeg"                        "FFmpeg"
verify "command -v jq"                            "jq"
verify "[ -L '$LONGVV_LINK' ]"                    "~/longvv 符号链接"
verify "[ -d '$DEV_PATH/node_modules' ]"          "node_modules"
verify "[ -f '$SSH_DIR/id_ed25519' ]"             "SSH 密钥"
verify "[ -f '$PLIST_FILE' ]"                     "launchd plist"
verify "lsof -i :5176 | grep -q LISTEN"          "Dev Server :5176"
verify "git config --global user.name"            "Git user.name"

echo ""
echo -e "  ${CYAN}通过 $CHECK_PASS / $CHECK_TOTAL${NC}"

if [ "$CHECK_PASS" -eq "$CHECK_TOTAL" ]; then
  echo ""
  echo -e "${GREEN}  🎉 新机环境就绪！${NC}"
  echo ""
  echo "  本地开发: http://127.0.0.1:5176"
  echo "  生产环境: https://uvera.ai"
  echo ""
else
  echo ""
  warn "部分检查未通过，请根据上方提示手动处理"
fi
