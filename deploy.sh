#!/usr/bin/env bash
# =============================================================================
# ERMM 财务系统 · Ubuntu 部署脚本
# 流程：拉取 GitHub → 更新依赖 → 部署前备份 → 数据库迁移 → PM2 重启 → 健康检查
#
# 用法：
#   ./deploy.sh                 完整部署
#   ./deploy.sh --skip-backup   跳过部署前备份（不推荐）
#   ./deploy.sh --skip-db       只拉代码 + 重启（本次无资料表变更时用）
#   ./deploy.sh --skip-install  跳过 npm install（package.json 未变时用）
#   ./deploy.sh --help          查看帮助
#
# 可用环境变量覆盖：APP_DIR BRANCH PM2_NAME PORT
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/Project/ERMM-finance-system}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-ermm-finance-system}"
PORT="${PORT:-3008}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

SKIP_INSTALL=0
SKIP_DB=0
SKIP_BACKUP=0

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-db)      SKIP_DB=1 ;;
    --skip-backup)  SKIP_BACKUP=1 ;;
    -h|--help)      sed -n '2,14p' "$0"; exit 0 ;;
    *)              echo "未知参数：$arg（用 --help 查看用法）" >&2; exit 1 ;;
  esac
done

log()  { printf '\n\033[1;36m──── [%s] %s\033[0m\n' "$(date '+%H:%M:%S')" "$*"; }
ok()   { printf '\033[1;32m✅ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠️  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 前置检查 ──────────────────────────────────────────────────────────────────
[ -d "$APP_DIR/.git" ] || die "部署目录不存在或不是 Git 仓库：$APP_DIR"
command -v git >/dev/null || die "未安装 git"
command -v node >/dev/null || die "未安装 node"
command -v pm2  >/dev/null || die "未安装 pm2（npm install -g pm2）"

cd "$APP_DIR"

# ── 解析 PM2 进程名（配置名与实际进程名可能不一致，自动对齐）───────────────────
RESOLVED_PM2_NAME="$PM2_NAME"
resolve_pm2_name() {
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    RESOLVED_PM2_NAME="$PM2_NAME"
    return 0
  fi

  local detected=""
  # 只在 APP_DIR 目录内查找执行 app.js 的进程，避免误改名同机的其他 Node 服务
  detected="$(pm2 jlist 2>/dev/null | ERMM_APP_DIR="$APP_DIR" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const root=((process.env.ERMM_APP_DIR||"").replace(/\\/g,"/")).replace(/\/+/g,"/");JSON.parse(s).filter(a=>{const p=((a.pm2_env||{}).pm_exec_path||"").replace(/\\/g,"/");return root&&p.indexOf(root+"/")===0&&/app\.js/i.test(p)}).forEach(a=>console.log(a.name))}catch(e){}})' | head -n1)" || detected=""

  if [ -n "$detected" ]; then
    warn "pm2 中未找到「$PM2_NAME」，改用本项目的现有进程「$detected」（如要统一名称：pm2 delete + pm2 start）"
    RESOLVED_PM2_NAME="$detected"
    return 0
  fi

  warn "pm2 中没有任何运行 app.js 的进程，将按 ecosystem.config.js 启动"
  pm2 start ecosystem.config.js --env production >/dev/null
  RESOLVED_PM2_NAME="$PM2_NAME"
}

# ── 失败自动回滚 ──────────────────────────────────────────────────────────────
PREV_COMMIT=""
ROLLBACK_ARMED=0
on_error() {
  local code=$?
  if [ "$ROLLBACK_ARMED" = 1 ] && [ -n "$PREV_COMMIT" ]; then
    printf '\n\033[1;31m❌ 部署失败（exit %s），自动回滚到 %s\033[0m\n' "$code" "$PREV_COMMIT"
    git reset --hard "$PREV_COMMIT" >/dev/null 2>&1 || true
    npm install --production >/dev/null 2>&1 || true
    pm2 restart "${RESOLVED_PM2_NAME:-$PM2_NAME}" >/dev/null 2>&1 || true
    printf '\033[1;33m已回滚并重启，请检查：pm2 logs %s --lines 40\033[0m\n' "${RESOLVED_PM2_NAME:-$PM2_NAME}"
  fi
  exit "$code"
}
trap on_error ERR

# ── 0. 记录回滚点 ─────────────────────────────────────────────────────────────
log "0/7 记录当前版本"
PREV_COMMIT="$(git rev-parse HEAD)"
echo "当前提交：$(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
if [ -n "$(git status --porcelain)" ]; then
  warn "服务器存在未提交的本地改动（常见为手动改过的 .env）："
  git status --short
  warn "若 pull 失败，请先执行：git stash && git pull origin $BRANCH && git stash pop"
fi

# ── 1. 拉取 GitHub 最新代码 ───────────────────────────────────────────────────
log "1/7 拉取 GitHub 最新代码（origin/$BRANCH）"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"
ROLLBACK_ARMED=1
echo
echo "本次更新内容："
git diff --stat "$PREV_COMMIT..HEAD" || true

# ── 2. 更新依赖 ───────────────────────────────────────────────────────────────
if [ "$SKIP_INSTALL" = 1 ]; then
  warn "2/7 已跳过 npm install（--skip-install）"
else
  log "2/7 更新 npm 依赖"
  npm install --production
  ok "依赖安装完成"
fi

# ── 3. 部署前备份 ─────────────────────────────────────────────────────────────
if [ "$SKIP_BACKUP" = 1 ]; then
  warn "3/7 已跳过部署前备份（--skip-backup）"
else
  log "3/7 部署前备份（数据库 + 代码包）"
  APP_DIR="$APP_DIR" bash scripts/server_backup.sh || die "备份失败，已中止部署（确认磁盘空间与 mysqldump 可用）"
  ok "部署前备份完成"
fi

# ── 4. 数据库迁移 ─────────────────────────────────────────────────────────────
if [ "$SKIP_DB" = 1 ]; then
  warn "4/7 已跳过数据库迁移（--skip-db）"
else
  log "4/7 数据库迁移"

  # 建表 / 扩栏脚本（幂等，先补齐基础表与配置表）
  echo "▶ 建表 / 扩栏脚本（CREATE TABLE IF NOT EXISTS，可重复执行）"
  for s in add_daily_report.js add_daily_report_target.js add_annual_review.js \
             add_okr.js add_ai_records.js add_cash_safe_level.js add_integration.js \
             add_llm_config.js add_daily_report_lock_audit.js add_dr_forecast_alert.js \
             add_p1p2_tables.js add_new_features_tables.js add_admin_column.js add_user_cols.js add_scenario_saved.js ; do
    if [ -f "database/$s" ]; then
      echo "  → node database/$s"
      node "database/$s" >/dev/null
    fi
  done
  ok "建表脚本执行完成"

  echo "▶ 增量迁移（台账比对，只执行未执行过的迁移档）"
  node scripts/db_migrate.js
  ok "数据库结构同步完成"
fi

# ── 4. 重启服务 ───────────────────────────────────────────────────────────────
log "5/7 重启 PM2 服务：$PM2_NAME"
resolve_pm2_name
pm2 restart "$RESOLVED_PM2_NAME" --update-env
pm2 save >/dev/null
ok "服务已重启（$RESOLVED_PM2_NAME）"

# ── 5. 健康检查 ───────────────────────────────────────────────────────────────
log "6/7 健康检查 $HEALTH_URL"
HEALTHY=0
for i in $(seq 1 10); do
  if curl -sf "$HEALTH_URL" >/tmp/ermm_health.json 2>/dev/null; then
    HEALTHY=1
    break
  fi
  printf '  等待服务就绪… (%s/10)\n' "$i"
  sleep 2
done
[ "$HEALTHY" = 1 ] || die "健康检查失败：$HEALTH_URL 无响应，请查看 pm2 logs $PM2_NAME --lines 40"
ok "健康检查通过"
cat /tmp/ermm_health.json
echo

# ── 6. 完成 ───────────────────────────────────────────────────────────────────
log "7/7 部署完成"
ROLLBACK_ARMED=0
pm2 status "$RESOLVED_PM2_NAME"
echo
echo "更新前：$(git rev-parse --short "$PREV_COMMIT")"
echo "更新后：$(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
echo
warn "前端有改动时，请让使用者 Ctrl+Shift+R 强制刷新浏览器缓存"
ok "全部完成"
