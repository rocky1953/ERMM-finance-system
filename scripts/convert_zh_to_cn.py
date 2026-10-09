# -*- coding: utf-8 -*-
"""
ermm_db 全庫繁體→簡體轉換腳本
依賴：zhconv, pymysql
用法：
  python scripts/convert_zh_to_cn.py --dry-run          # 預覽，不寫庫
  python scripts/convert_zh_to_cn.py --tables t1,t2      # 只轉指定表
  python scripts/convert_zh_to_cn.py                     # 全量轉換
"""
import sys
import os
import argparse
import pymysql
from zhconv import convert

# 資料庫連線（對應 .env）
DB_CONFIG = {
    'host': 'localhost',
    'port': 3306,
    'user': 'root',
    'password': 'ld68315711',
    'database': 'ERMM_db',
    'charset': 'utf8mb4',
}

# 字串型別欄位（需轉換）
STRING_TYPES = ('varchar', 'char', 'text', 'mediumtext', 'longtext', 'tinytext')


def to_cn(s):
    if s is None:
        return s
    try:
        return convert(s, 'zh-cn')
    except Exception:
        return s


def get_string_columns(conn):
    """取得所有表的字串型欄位"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND DATA_TYPE IN (%s)
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """ % ','.join(['%s'] * len(STRING_TYPES)), STRING_TYPES)
        return cur.fetchall()


def get_primary_keys(conn, table):
    """取得表的主鍵欄位（用於 UPDATE WHERE）"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND CONSTRAINT_NAME = 'PRIMARY'
        """, (table,))
        return [r[0] for r in cur.fetchall()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='只預覽不寫庫')
    parser.add_argument('--tables', type=str, default='', help='只處理指定表（逗號分隔）')
    parser.add_argument('--batch-size', type=int, default=500, help='每批提交筆數')
    args = parser.parse_args()

    only_tables = set(t.strip() for t in args.tables.split(',') if t.strip()) if args.tables else None

    conn = pymysql.connect(**DB_CONFIG)
    print(f"[連線] {DB_CONFIG['database']} @ {DB_CONFIG['host']}")
    print(f"[模式] {'DRY-RUN 預覽' if args.dry_run else '實際寫入'}")

    cols = get_string_columns(conn)
    # 按表分組
    table_cols = {}
    for t, c, dt in cols:
        if only_tables and t not in only_tables:
            continue
        table_cols.setdefault(t, []).append(c)

    total_tables = len(table_cols)
    total_updated = 0
    total_scanned = 0

    for table, columns in table_cols.items():
        pks = get_primary_keys(conn, table)
        if not pks:
            print(f"[跳過] {table} 無主鍵，無法安全 UPDATE")
            continue

        # 構造 SELECT（主鍵 + 字串欄位）
        select_cols = ', '.join(pks + columns)
        sql_sel = f"SELECT {select_cols} FROM `{table}`"

        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(sql_sel)
            rows = cur.fetchall()

        table_updated = 0
        updates = []  # (sql, params)
        for row in rows:
            total_scanned += 1
            changed = False
            set_clauses = []
            params = []
            for c in columns:
                old = row[c]
                if old is None:
                    continue
                if not isinstance(old, str):
                    continue
                new = to_cn(old)
                if new != old:
                    changed = True
                    set_clauses.append(f"`{c}` = %s")
                    params.append(new)
            if changed:
                where_clause = ' AND '.join(f"`{pk}` = %s" for pk in pks)
                where_params = [row[pk] for pk in pks]
                sql_upd = f"UPDATE `{table}` SET {', '.join(set_clauses)} WHERE {where_clause}"
                updates.append((sql_upd, params + where_params))
                table_updated += 1

        if table_updated == 0:
            continue

        print(f"[{table}] 掃描 {len(rows)} 行，將更新 {table_updated} 行")
        # 顯示前 3 筆樣本
        for i, (sql_upd, prm) in enumerate(updates[:3]):
            preview = ', '.join(str(p)[:40] for p in prm)
            print(f"    樣本 {i+1}: {preview[:120]}")

        if not args.dry_run:
            with conn.cursor() as cur:
                for i, (sql_upd, prm) in enumerate(updates):
                    cur.execute(sql_upd, prm)
                    if (i + 1) % args.batch_size == 0:
                        conn.commit()
                conn.commit()
            print(f"    ✅ 已寫入 {table_updated} 行")

        total_updated += table_updated

    conn.close()
    print(f"\n[完成] 共掃描 {total_scanned} 行，更新 {total_updated} 行（涉及 {total_tables} 張表）")
    if args.dry_run:
        print("[提示] 此為 DRY-RUN，未寫入資料庫。確認後移除 --dry-run 執行全量轉換。")


if __name__ == '__main__':
    main()
