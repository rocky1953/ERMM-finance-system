#!/usr/bin/env bash
# =============================================================================
# ERMM 财务系统 · 服务器备份脚本
#
# 备份内容：
#   1) 数据库：调用 scripts/backup.js（mysqldump --single-transaction 一致快照），
#              记录写入 backup_log，并按 GFS 策略自动清理（7 天日备 / 周备 / 月备）
#   2) 代码包：backups/code/code_<时间>.tar.gz
#              包含程序、配置与 .env（含密钥，文件权限 600），排除 node_modules/.git/backups/logs
#
# 用法：
#   ./scripts/server_backup.sh              数据库 + 代码包
#   ./scripts/server_backup.sh --db-only    只备份数据库
#   ./scripts/server_backup.sh --code-only  只打包代码
#   ./scripts/server_backup.sh --help
#
# 可用环境变量覆盖：
#   APP_DIR      项目目录（默认脚本所在目录的上一级）
#   BACKUP_KEEP  代码包保留份数（默认 10）
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"

DO_DB=1
DO_CODE=1

for arg in "$@"; do
  case "$arg" in
    --db-only)   DO_CODE=0 ;;
    --code-only) DO_DB=0 ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *)           echo "未知参数：$arg（用 --help 查看用法）" >&2; exit 1 ;;
  esac
done

log()  { printf '\n\033[1;36m──── [%s] %s\033[0m\n' "$(date '+%H:%M:%S')" "$*"; }
ok()   { printf '\033[1;32m✅ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠️  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

cd "$APP_DIR"

[ -f .env ] || die "缺少 .env（数据库连线参数），请先配置：$APP_DIR/.env"
command -v node >/dev/null || die "未安装 node"
command -v tar  >/dev/null || die "未安装 tar"

TS="$(date '+%Y%m%d_%H%M%S')"
BACKUP_ROOT="$APP_DIR/backups"
CODE_DIR="$BACKUP_ROOT/code"
mkdir -p "$CODE_DIR"
umask 077   # 备份含 .env，限制为仅属主可读

if [ "$DO_DB" = 1 ]; then
  log "备份数据库"
  node scripts/backup.js backup --type=AUTO --remark="服务器备份 ${TS}" \
    || die "数据库备份失败，已中止（未生成备份前不要继续部署）"
  ok "数据库备份完成"
fi

if [ "$DO_CODE" = 1 ]; then
  log "打包代码与配置"
  TAR_FILE="$CODE_DIR/code_${TS}.tar.gz"
  tar czf "$TAR_FILE" \
    --exclude='./node_modules' \
    --exclude='./.git' \
    --exclude='./backups' \
    --exclude='./logs' \
    --exclude='./coverage' \
    --exclude='./.trae' \
    -C "$APP_DIR" . \
    || die "代码打包失败"
  [ -s "$TAR_FILE" ] || die "代码包为空：$TAR_FILE"
  chmod 600 "$TAR_FILE"
  ok "代码包完成：$(du -h "$TAR_FILE" | cut -f1)  $TAR_FILE"

  # 只保留最近 BACKUP_KEEP 份代码包
  COUNT="$(find "$CODE_DIR" -maxdepth 1 -name 'code_*.tar.gz' -type f | wc -l)"
  if [ "$COUNT" -gt "$BACKUP_KEEP" ]; then
    find "$CODE_DIR" -maxdepth 1 -name 'code_*.tar.gz' -type f -printf '%T@ %p\n' \
      | sort -rn | tail -n +$((BACKUP_KEEP + 1)) | cut -d' ' -f2- \
      | while read -r old; do rm -f "$old"; echo "  已清理旧代码包：$(basename "$old")"; done
  fi
fi

log "备份汇总"
echo "数据库备份：$BACKUP_ROOT"
[ "$DO_DB" = 1 ] && ls -lht "$BACKUP_ROOT"/*.sql 2>/dev/null | head -n 3 || true
if [ "$DO_CODE" = 1 ]; then
  echo "代码备份：$CODE_DIR"
  ls -lht "$CODE_DIR"/code_*.tar.gz 2>/dev/null | head -n 3 || true
fi
echo
echo "恢复方式："
echo "  数据库：node scripts/backup.js restore <文件名|backup_log.id>"
echo "  代码包：tar xzf backups/code/code_<时间>.tar.gz -C <目标目录>"
ok "备份完成"
