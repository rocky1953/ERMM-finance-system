/**
 * 郵件工具 — 月度經營+人效報告推送
 * 依賴 nodemailer，配置從 .env 讀取 SMTP_* / MGMT_REPORT_RECIPIENTS
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT) || 465;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    if (!host) {
        console.warn('[mailer] SMTP_HOST 未配置，郵件功能未啟用');
        return null;
    }
    transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: process.env.SMTP_USER ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        } : undefined
    });
    return transporter;
}

function getRecipients() {
    const raw = process.env.MGMT_REPORT_RECIPIENTS || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 產生月度報告 HTML 郵件內容
 * @param {object} r - monthly-business-report 回傳的 report 物件
 * @returns {string} HTML
 */
function buildReportHtml(r) {
    const b = r.business || {};
    const h = r.hr || {};
    const e = r.efficiency || {};
    const mom = b.output_mom != null
        ? `<span style="color:${b.output_mom >= 0 ? '#27ae60' : '#e74c3c'};">(${b.output_mom >= 0 ? '↑' : '↓'} ${Math.abs(b.output_mom)}%)</span>`
        : '';
    const fmt = v => Number(v || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });

    const deptRows = (r.departments || []).map(d => `
        <tr>
            <td style="padding:6px 10px;border:1px solid #ddd;">${d.depart_id || '未分類'}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${d.emp_cnt}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmt(d.total_hours)}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${d.emp_cnt > 0 ? (d.total_hours / d.emp_cnt).toFixed(1) : 0}</td>
        </tr>`).join('') || `<tr><td colspan="4" style="padding:8px;text-align:center;color:#999;">暫無部門資料</td></tr>`;

    const topRows = (r.top_performers || []).map((u, i) => `
        <tr>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${i + 1}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;">${u.user_id} ${u.user_name || ''}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;">${u.depart_id || '-'}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmt(u.total_hours)}</td>
        </tr>`).join('');

    const bottomRows = (r.bottom_performers || []).map((u, i) => `
        <tr style="background:#fdf6e3;">
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${i + 1}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;">${u.user_id} ${u.user_name || ''}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;">${u.depart_id || '-'}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmt(u.total_hours)}</td>
        </tr>`).join('');

    return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:'Microsoft JhengHei','PingFang TC',sans-serif;background:#f5f6fa;margin:0;padding:20px;">
  <div style="max-width:760px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1b4f72,#2980b9);color:#fff;padding:22px 28px;">
      <h1 style="margin:0;font-size:20px;">📑 ERMM 月度經營+人效報告</h1>
      <div style="margin-top:6px;font-size:14px;opacity:0.9;">公司：${r.bu_no}　·　期間：${r.period}　·　產出時間：${new Date(r.generated_at).toLocaleString('zh-TW')}</div>
    </div>
    <div style="padding:24px 28px;">
      <h2 style="margin:0 0 14px 0;font-size:16px;color:#2c3e50;border-left:4px solid #2980b9;padding-left:10px;">💰 經營概況</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
        <tr><td style="padding:8px 12px;background:#eaf2f8;border:1px solid #d6eaf8;"><b>產值</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${fmt(b.output)} ${mom}</td></tr>
        <tr><td style="padding:8px 12px;background:#eaf2f8;border:1px solid #d6eaf8;"><b>開票金額</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${fmt(b.invoice_amt)}（${b.invoice_cnt || 0} 筆）</td></tr>
        <tr><td style="padding:8px 12px;background:#eaf2f8;border:1px solid #d6eaf8;"><b>採購金額</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${fmt(b.po_amt)}（${b.po_cnt || 0} 筆）</td></tr>
        <tr><td style="padding:8px 12px;background:#eaf2f8;border:1px solid #d6eaf8;"><b>銷售訂單</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${b.so_cnt || 0} 筆</td></tr>
      </table>

      <h2 style="margin:0 0 14px 0;font-size:16px;color:#2c3e50;border-left:4px solid #8e44ad;padding-left:10px;">👥 人力概況</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
        <tr><td style="padding:8px 12px;background:#f4ecf7;border:1px solid #ebdef0;"><b>在職人數</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${h.employee_cnt} 人</td></tr>
        <tr><td style="padding:8px 12px;background:#f4ecf7;border:1px solid #ebdef0;"><b>薪資總額</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${fmt(h.salary_total)}</td></tr>
        <tr><td style="padding:8px 12px;background:#f4ecf7;border:1px solid #ebdef0;"><b>人均薪資</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${fmt(h.avg_salary)}</td></tr>
      </table>

      <h2 style="margin:0 0 14px 0;font-size:16px;color:#2c3e50;border-left:4px solid #27ae60;padding-left:10px;">⚙️ 人效指標</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
        <tr><td style="padding:8px 12px;background:#e8f8f5;border:1px solid #d1f2eb;"><b>人均產值</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${fmt(e.per_capita_output)}</td></tr>
        <tr><td style="padding:8px 12px;background:#e8f8f5;border:1px solid #d1f2eb;"><b>人均工時</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${e.per_capita_hours} 小時</td></tr>
        <tr><td style="padding:8px 12px;background:#e8f8f5;border:1px solid #d1f2eb;"><b>工作占比</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${e.work_ratio || 0}%</td></tr>
        <tr><td style="padding:8px 12px;background:#e8f8f5;border:1px solid #d1f2eb;"><b>填報人數/天數</b></td><td style="padding:8px 12px;border:1px solid #ddd;">${e.report_users} 人 / ${e.report_days} 天</td></tr>
      </table>

      <h2 style="margin:0 0 14px 0;font-size:16px;color:#2c3e50;border-left:4px solid #f39c12;padding-left:10px;">🏆 工時 Top 5</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px;">
        <tr style="background:#f8f9fa;"><th style="padding:6px 10px;border:1px solid #ddd;">#</th><th style="padding:6px 10px;border:1px solid #ddd;">員工</th><th style="padding:6px 10px;border:1px solid #ddd;">部門</th><th style="padding:6px 10px;border:1px solid #ddd;">總工時</th></tr>
        ${topRows}
      </table>

      <h2 style="margin:0 0 14px 0;font-size:16px;color:#2c3e50;border-left:4px solid #e74c3c;padding-left:10px;">⚠️ 工時 Bottom 5</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px;">
        <tr style="background:#f8f9fa;"><th style="padding:6px 10px;border:1px solid #ddd;">#</th><th style="padding:6px 10px;border:1px solid #ddd;">員工</th><th style="padding:6px 10px;border:1px solid #ddd;">部門</th><th style="padding:6px 10px;border:1px solid #ddd;">總工時</th></tr>
        ${bottomRows}
      </table>

      <h2 style="margin:0 0 14px 0;font-size:16px;color:#2c3e50;border-left:4px solid #16a085;padding-left:10px;">🏢 部門表現</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px;">
        <tr style="background:#f8f9fa;"><th style="padding:6px 10px;border:1px solid #ddd;">部門</th><th style="padding:6px 10px;border:1px solid #ddd;">人數</th><th style="padding:6px 10px;border:1px solid #ddd;">總工時</th><th style="padding:6px 10px;border:1px solid #ddd;">人均工時</th></tr>
        ${deptRows}
      </table>

      <div style="background:#f8f9fa;border-radius:6px;padding:14px;font-size:13px;color:#555;margin-top:20px;">
        本報告由 ERMM 財務系統自動產生並推送。如需查看完整圖表與趨勢，請登入系統至「工作日报 → 月度报告」。
      </div>
    </div>
  </div>
</body></html>`;
}

/**
 * 發送月度報告郵件
 * @param {object} report - report 物件
 * @returns {Promise<{success:boolean, message:string, info?:any}>}
 */
async function sendMgmtReport(report) {
    const tp = getTransporter();
    if (!tp) return { success: false, message: 'SMTP 未配置，郵件未發送' };
    const recipients = getRecipients();
    if (recipients.length === 0) return { success: false, message: '未設定收件人（MGMT_REPORT_RECIPIENTS）' };

    const subject = `【ERMM 月度報告】${report.bu_no} · ${report.period} 經營+人效`;
    const html = buildReportHtml(report);

    try {
        const info = await tp.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: recipients.join(', '),
            subject,
            html
        });
        console.log(`[mailer] 報告郵件已發送: ${report.bu_no}/${report.period} → ${recipients.join(', ')} messageId=${info.messageId}`);
        return { success: true, message: `已發送給 ${recipients.length} 位高管`, info: { messageId: info.messageId, recipients } };
    } catch (err) {
        console.error('[mailer] 郵件發送失敗:', err.message);
        return { success: false, message: err.message };
    }
}

module.exports = { sendMgmtReport, getRecipients, buildReportHtml };
