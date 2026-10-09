# -*- coding: utf-8 -*-
"""
產生 2015 年度（1~12 月）財務入帳 / 報稅 / 勾稽 測試資料，寫入 ERMM_db。
- fin_voucher + fin_voucher_entry（每月 4 張憑證：收入/成本/費用/繳稅，狀態 POSTED）
- fin_tax_return + fin_tax_return_item（每月增值稅，狀態 FILED）
- fin_reconciliation（每月勾稽：繳稅憑證與報稅 MATCHED，其餘 UNMATCHED）
- fin_ruid_ledger（每筆業務一個 RUID）
用法：python scripts/gen_finance_2015.py
"""
import random
import pymysql
from datetime import datetime

random.seed(2015)  # 固定種子，資料可重現

DB = dict(host='localhost', port=3306, user='root', password='ld68315711',
          database='ERMM_db', charset='utf8mb4')

BU = 'HM'
YEAR = 2015

# 會計科目（已存在於 fin_account_subject）
SUBJ = {
    '1002': '银行存款',
    '1122': '应收账款',
    '2202': '应付账款',
    '2221': '应交税费',
    '6001': '主营业务收入',
    '6401': '主营业务成本',
    '6601': '销售费用',
    '6602': '管理费用',
}


def gen_ruid(bu, dt):
    ts = dt.strftime('%Y%m%d%H%M%S')
    rnd = str(random.randint(100, 999))
    return f"R{bu}{ts}{rnd}"


def fmt_money(v):
    return round(v, 2)


def insert_voucher(conn, ym, month, day, summary, entries, created_by='SYSTEM'):
    """entries: list of (subject_code, debit, credit, line_summary)"""
    ruid = gen_ruid(BU, datetime(YEAR, month, day, 9, 0, 0))
    voucher_no = f"V{BU}{ym.replace('/', '')}{day:02d}"
    td = sum(e[1] for e in entries)
    tc = sum(e[2] for e in entries)
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO fin_voucher
            (bu_no, ruid, voucher_no, voucher_date, YYYY_MM, summary, total_debit, total_credit, status, created_by, approved_by, approved_time, posted_time)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'POSTED',%s,%s,%s,%s)
        """, (BU, ruid, voucher_no, f"{YEAR}-{month:02d}-{day:02d}", ym, summary, td, tc,
              created_by, created_by, f"{YEAR}-{month:02d}-{day:02d} 10:00:00", f"{YEAR}-{month:02d}-{day:02d} 11:00:00"))
        vid = cur.lastrowid
        for sc, dr, cr, ls in entries:
            cur.execute("""
                INSERT INTO fin_voucher_entry (voucher_id, ruid, subject_code, subject_name, debit, credit, summary)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (vid, ruid, sc, SUBJ[sc], dr, cr, ls))
        cur.execute("""
            INSERT INTO fin_ruid_ledger (ruid, bu_no, biz_type, source_id, amount, remark)
            VALUES (%s,%s,'VOUCHER',%s,%s,%s)
        """, (ruid, BU, voucher_no, td, summary))
    return vid, ruid, td


def insert_tax_return(conn, ym, month, taxable_amount, tax_amount, linked_ruid):
    ruid = gen_ruid(BU, datetime(YEAR, month, 15, 14, 0, 0))
    receipt = f"RX{BU}{ym.replace('/', '')}{month:02d}"
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO fin_tax_return
            (bu_no, ruid, tax_type, tax_period, taxable_amount, tax_amount, status, filed_time, receipt_no, remark)
            VALUES (%s,%s,'VAT',%s,%s,%s,'FILED',%s,%s,%s)
        """, (BU, ruid, ym, taxable_amount, tax_amount,
              f"{YEAR}-{month:02d}-15 15:00:00", receipt, f"{YEAR}年{month}月增值税申报"))
        rid = cur.lastrowid
        cur.execute("""
            INSERT INTO fin_tax_return_item (return_id, ruid, subject_code, item_name, taxable_amount, tax_rate, tax_amount)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """, (rid, ruid, '2221', '增值税-销项税额', taxable_amount, 0.13, tax_amount))
        cur.execute("""
            INSERT INTO fin_ruid_ledger (ruid, bu_no, biz_type, source_id, amount, remark)
            VALUES (%s,%s,'TAX',%s,%s,%s)
        """, (ruid, BU, f"VAT:{rid}", tax_amount, f"{YEAR}年{month}月增值税"))
    return rid, ruid, tax_amount


def insert_recon(conn, ym, voucher_ruid, tax_ruid, v_amt, t_amt, status):
    diff = round(t_amt - v_amt, 2)
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO fin_reconciliation
            (bu_no, period, voucher_ruid, tax_ruid, voucher_amount, tax_amount, diff_amount, match_status, handled, remark)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (BU, ym, voucher_ruid, tax_ruid, v_amt, t_amt, diff, status,
              1 if status == 'MATCHED' else 0,
              '系统自动勾稽' if status == 'MATCHED' else '口径差异：入账为收入/成本/费用，报税为增值税'))


def main():
    conn = pymysql.connect(**DB)
    total_v = total_t = total_r = 0

    for month in range(1, 13):
        ym = f"{YEAR}/{month:02d}"
        # 隨機但合理的金額
        revenue = random.randint(500000, 1500000)       # 銷售收入
        cost = round(revenue * random.uniform(0.55, 0.72))  # 成本
        expense = random.randint(50000, 200000)          # 營運費用
        vat = round(revenue * 0.13, 2)                    # 增值稅

        # 憑證 A：銷售收入
        _, ruid_a, _ = insert_voucher(conn, ym, month, 5, f"{YEAR}年{month}月销售收入",
            [('1122', revenue, 0, '应收销货款'), ('6001', 0, revenue, '主营业务收入')])
        # 憑證 B：結轉成本
        _, ruid_b, _ = insert_voucher(conn, ym, month, 10, f"{YEAR}年{month}月销售成本",
            [('6401', cost, 0, '结转销售成本'), ('2202', 0, cost, '应付供应商货款')])
        # 憑證 C：營運費用
        _, ruid_c, _ = insert_voucher(conn, ym, month, 20, f"{YEAR}年{month}月运营费用",
            [('6602', expense, 0, '管理费用-办公/差旅'), ('1002', 0, expense, '银行存款支付')])
        # 憑證 D：繳納增值稅（與報稅 MATCHED）
        _, ruid_d, amt_d = insert_voucher(conn, ym, month, 25, f"{YEAR}年{month}月缴纳增值税",
            [('2221', vat, 0, '应交税费-应交增值税'), ('1002', 0, vat, '银行存款缴税')])

        # 報稅：增值稅
        _, tax_ruid, tax_amt = insert_tax_return(conn, ym, month, revenue, vat, ruid_d)

        # 勾稽：D 與報稅 MATCHED，其餘 UNMATCHED
        insert_recon(conn, ym, ruid_d, tax_ruid, amt_d, tax_amt, 'MATCHED')
        insert_recon(conn, ym, ruid_a, None, revenue, 0, 'UNMATCHED')
        insert_recon(conn, ym, ruid_b, None, cost, 0, 'UNMATCHED')
        insert_recon(conn, ym, ruid_c, None, expense, 0, 'UNMATCHED')

        conn.commit()
        total_v += 4
        total_t += 1
        total_r += 4
        print(f"[{ym}] 憑證4 張（收入{revenue}/成本{cost}/費用{expense}/繳稅{vat}） 報稅1 筆（增值稅{vat}） 勾稽4 筆")

    conn.close()
    print(f"\n✅ 完成：{YEAR} 年度共產生 憑證 {total_v} 張 / 報稅 {total_t} 筆 / 勾稽 {total_r} 筆")


if __name__ == '__main__':
    main()
