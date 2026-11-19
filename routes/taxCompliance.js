/**
 * CFO-10 税务与合规管理
 *
 * GET    /api/tax-compliance/overview?bu_no=&YYYY=     合规评分、KPI、分类统计、预警、待办、申报日历、事项、法规、分公司对比
 * GET    /api/tax-compliance/filing-tasks               申报任务清单
 * POST   /api/tax-compliance/filing-tasks               新增申报任务
 * PUT    /api/tax-compliance/filing-tasks/:uid          编辑/标记申报
 * DELETE /api/tax-compliance/filing-tasks/:uid          删除申报任务
 * POST   /api/tax-compliance/filing-tasks/generate      按年度批量生成标准申报日历
 * GET    /api/tax-compliance/compliance-items           合规事项清单
 * POST   /api/tax-compliance/compliance-items           新增合规事项
 * PUT    /api/tax-compliance/compliance-items/:uid      编辑合规事项
 * DELETE /api/tax-compliance/compliance-items/:uid      删除合规事项
 * GET    /api/tax-compliance/regulations                法规政策库
 * POST   /api/tax-compliance/regulations                新增法规
 * PUT    /api/tax-compliance/regulations/:uid           编辑法规
 * DELETE /api/tax-compliance/regulations/:uid           删除法规
 * POST   /api/tax-compliance/scan                       扫描合规风险并写入 alert_log
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, fail500 } = require('../utils/response');
const {
    BUS, TAX_TYPES, FILING_CYCLES,
    ITEM_CATEGORIES, ITEM_FREQUENCIES, ITEM_STATUS, RISK_LEVELS,
    REG_CATEGORIES, REG_STATUS,
    todayStr, buildFilingRows, buildItemRows, buildRegRows,
    buildOverview, generateFilings, scanCompliance
} = require('../services/taxCompliance');

const n = (v) => Number(v || 0);

function parseYear(v) {
    const s = String(v || '').trim();
    return /^\d{4}$/.test(s) ? s : null;
}

function parseBu(v, dft = 'ALL') {
    const s = String(v || dft).trim().toUpperCase();
    if (s === 'ALL') return 'ALL';
    return BUS.includes(s) ? s : null;
}

async function defaultYear() {
    const [rows] = await pool.execute('SELECT MAX(tax_year) AS y FROM tax_filing_task');
    return rows[0]?.y ? String(rows[0].y).slice(0, 4) : todayStr().slice(0, 4);
}

function pickStr(v, max) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    return s.slice(0, max);
}

/** 合法返回 YYYY-MM-DD，空返回 null，非法返回 undefined */
function pickDate(v) {
    if (v == null || v === '') return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function readFiling(body, partial) {
    const out = {};
    const put = (key, value) => { if (!partial || value !== undefined) out[key] = value; };

    if (body.bu_no !== undefined) {
        const v = parseBu(body.bu_no, null);
        if (!v) return { error: '公司别仅支持 GROUP/HM/HN/SZ' };
        out.bu_no = v;
    } else if (!partial) {
        return { error: '公司别不能为空' };
    }

    if (body.tax_year !== undefined) {
        const v = parseYear(body.tax_year);
        if (!v) return { error: '纳税年度格式应为 YYYY' };
        out.tax_year = v;
    } else if (!partial) {
        return { error: '纳税年度不能为空' };
    }

    if (body.tax_period !== undefined) {
        const s = String(body.tax_period || '').trim();
        if (s && !/^\d{4}-\d{2}$/.test(s)) return { error: '所属期格式应为 YYYY-MM' };
        out.tax_period = s || '';
    }

    if (body.tax_type !== undefined) {
        const v = String(body.tax_type || '').trim().toUpperCase();
        if (!TAX_TYPES[v]) return { error: '税种无效' };
        out.tax_type = v;
    } else if (!partial) {
        return { error: '税种不能为空' };
    }

    if (body.filing_cycle !== undefined) {
        const v = String(body.filing_cycle || '').trim().toUpperCase();
        if (!FILING_CYCLES[v]) return { error: '申报周期无效' };
        out.filing_cycle = v;
    }

    if (body.due_date !== undefined) {
        const d = pickDate(body.due_date);
        if (d === undefined) return { error: '申报截止日格式应为 YYYY-MM-DD' };
        if (!d) return { error: '申报截止日不能为空' };
        out.due_date = d;
    } else if (!partial) {
        return { error: '申报截止日不能为空' };
    }

    if (body.filed_date !== undefined) {
        const d = pickDate(body.filed_date);
        if (d === undefined) return { error: '实际申报日格式应为 YYYY-MM-DD' };
        out.filed_date = d;
    }

    if (body.status !== undefined) {
        const v = String(body.status || '').trim().toUpperCase();
        if (!['PENDING', 'FILED', 'EXEMPT'].includes(v)) {
            return { error: '状态仅支持 PENDING/FILED/EXEMPT（逾期由截止日推导）' };
        }
        out.status = v;
    }

    if (body.tax_amount !== undefined) {
        const v = n(body.tax_amount);
        if (v < 0) return { error: '申报税额不能为负' };
        out.tax_amount = v;
    }

    if (body.receipt_no !== undefined) out.receipt_no = pickStr(body.receipt_no, 50);
    if (body.owner_id !== undefined) out.owner_id = pickStr(body.owner_id, 50);
    if (body.note !== undefined) out.note = pickStr(body.note, 500);

    return { value: out };
}

function readItem(body, partial) {
    const out = {};
    if (body.bu_no !== undefined) {
        const v = parseBu(body.bu_no, null);
        if (!v) return { error: '公司别仅支持 GROUP/HM/HN/SZ' };
        out.bu_no = v;
    } else if (!partial) {
        return { error: '公司别不能为空' };
    }

    if (body.tax_year !== undefined) {
        const v = parseYear(body.tax_year);
        if (!v) return { error: '纳税年度格式应为 YYYY' };
        out.tax_year = v;
    } else if (!partial) {
        return { error: '纳税年度不能为空' };
    }

    if (body.category !== undefined) {
        const v = String(body.category || '').trim().toUpperCase();
        if (!ITEM_CATEGORIES[v]) return { error: '合规事项分类无效' };
        out.category = v;
    } else if (!partial) {
        return { error: '合规事项分类不能为空' };
    }

    if (body.item_name !== undefined) {
        const v = pickStr(body.item_name, 150);
        if (!v) return { error: '合规事项名称不能为空' };
        out.item_name = v;
    } else if (!partial) {
        return { error: '合规事项名称不能为空' };
    }

    if (body.requirement !== undefined) out.requirement = pickStr(body.requirement, 500);

    if (body.frequency !== undefined) {
        const v = String(body.frequency || '').trim().toUpperCase();
        if (!ITEM_FREQUENCIES[v]) return { error: '执行频率无效' };
        out.frequency = v;
    }

    if (body.owner_dept !== undefined) out.owner_dept = pickStr(body.owner_dept, 50);
    if (body.owner_id !== undefined) out.owner_id = pickStr(body.owner_id, 50);

    if (body.due_date !== undefined) {
        const d = pickDate(body.due_date);
        if (d === undefined) return { error: '完成期限格式应为 YYYY-MM-DD' };
        out.due_date = d;
    }
    if (body.completed_date !== undefined) {
        const d = pickDate(body.completed_date);
        if (d === undefined) return { error: '实际完成日格式应为 YYYY-MM-DD' };
        out.completed_date = d;
    }

    if (body.status !== undefined) {
        const v = String(body.status || '').trim().toUpperCase();
        if (!ITEM_STATUS[v]) return { error: '合规事项状态无效' };
        out.status = v;
    }

    if (body.risk_level !== undefined) {
        const v = String(body.risk_level || '').trim().toUpperCase();
        if (!RISK_LEVELS[v]) return { error: '风险等级仅支持 HIGH/MEDIUM/LOW' };
        out.risk_level = v;
    }

    if (body.evidence !== undefined) out.evidence = pickStr(body.evidence, 500);
    if (body.note !== undefined) out.note = pickStr(body.note, 500);

    return { value: out };
}

function readRegulation(body, partial) {
    const out = {};
    if (body.reg_code !== undefined) out.reg_code = pickStr(body.reg_code, 50) || null;

    if (body.title !== undefined) {
        const v = pickStr(body.title, 200);
        if (!v) return { error: '法规名称不能为空' };
        out.title = v;
    } else if (!partial) {
        return { error: '法规名称不能为空' };
    }

    if (body.category !== undefined) {
        const v = String(body.category || '').trim().toUpperCase();
        if (!REG_CATEGORIES[v]) return { error: '法规类别无效' };
        out.category = v;
    }

    if (body.issue_org !== undefined) out.issue_org = pickStr(body.issue_org, 100);

    for (const key of ['publish_date', 'effective_date']) {
        if (body[key] !== undefined) {
            const d = pickDate(body[key]);
            if (d === undefined) return { error: '日期格式应为 YYYY-MM-DD' };
            out[key] = d;
        }
    }

    if (body.impact_level !== undefined) {
        const v = String(body.impact_level || '').trim().toUpperCase();
        if (!RISK_LEVELS[v]) return { error: '影响等级仅支持 HIGH/MEDIUM/LOW' };
        out.impact_level = v;
    }

    if (body.summary !== undefined) {
        const v = String(body.summary == null ? '' : body.summary).trim();
        out.summary = v ? v.slice(0, 4000) : null;
    }

    if (body.action_required !== undefined) out.action_required = pickStr(body.action_required, 500);

    if (body.status !== undefined) {
        const v = String(body.status || '').trim().toUpperCase();
        if (!REG_STATUS[v]) return { error: '法规状态无效' };
        out.status = v;
    }

    if (body.owner_id !== undefined) out.owner_id = pickStr(body.owner_id, 50);
    if (body.note !== undefined) out.note = pickStr(body.note, 500);

    return { value: out };
}

// ============ 总览 ============
router.get('/overview', async (req, res) => {
    try {
        const bu = parseBu(req.query.bu_no, 'ALL');
        if (!bu) return fail(res, '公司别仅支持 ALL/GROUP/HM/HN/SZ');
        const year = parseYear(req.query.YYYY) || await defaultYear();
        ok(res, await buildOverview(bu, year));
    } catch (err) { fail500(res, err); }
});

// ============ 申报任务 ============
router.get('/filing-tasks', async (req, res) => {
    try {
        const bu = parseBu(req.query.bu_no, 'ALL');
        if (!bu) return fail(res, '公司别仅支持 ALL/GROUP/HM/HN/SZ');
        const year = parseYear(req.query.YYYY) || await defaultYear();
        let sql = 'SELECT * FROM tax_filing_task WHERE tax_year=?';
        const params = [year];
        if (bu !== 'ALL') { sql += ' AND bu_no=?'; params.push(bu); }
        sql += ' ORDER BY due_date, tax_type';
        const [rows] = await pool.execute(sql, params);
        let list = buildFilingRows(rows, todayStr());
        const status = String(req.query.status || '').trim().toUpperCase();
        if (status) list = list.filter(r => r.status === status);
        ok(res, { YYYY: year, bu_no: bu, rows: list });
    } catch (err) { fail500(res, err); }
});

// 按年度生成标准申报日历（放在 /:uid 之前）
router.post('/filing-tasks/generate', async (req, res) => {
    try {
        const body = req.body || {};
        const bu = parseBu(body.bu_no, null);
        if (!bu || bu === 'GROUP' || bu === 'ALL') {
            return fail(res, '请选择具体公司 HM/HN/SZ 生成申报日历');
        }
        const year = parseYear(body.YYYY) || todayStr().slice(0, 4);
        const r = await generateFilings(bu, year);
        ok(res, { bu_no: bu, YYYY: year, ...r }, `已生成 ${r.generated} 项申报任务`);
    } catch (err) { fail500(res, err); }
});

router.post('/filing-tasks', async (req, res) => {
    try {
        const parsed = readFiling(req.body || {}, false);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;
        if (!o.filing_cycle) o.filing_cycle = 'MONTHLY';
        if (!o.status) o.status = 'PENDING';
        if (o.status === 'FILED' && !o.filed_date) o.filed_date = todayStr();

        const [result] = await pool.execute(
            `INSERT INTO tax_filing_task
                (bu_no, tax_year, tax_period, tax_type, filing_cycle, due_date,
                 filed_date, status, tax_amount, receipt_no, owner_id, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [o.bu_no, o.tax_year, o.tax_period || '', o.tax_type, o.filing_cycle, o.due_date,
             o.filed_date || null, o.status, o.tax_amount || 0,
             o.receipt_no || null, o.owner_id || null, o.note || null]);

        const [rows] = await pool.execute('SELECT * FROM tax_filing_task WHERE uid=?', [result.insertId]);
        ok(res, buildFilingRows(rows, todayStr())[0], '申报任务已创建');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return fail(res, '同一公司、年度、所属期、税种与周期的任务已存在');
        fail500(res, err);
    }
});

router.put('/filing-tasks/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT * FROM tax_filing_task WHERE uid=?', [uid]);
        if (!cur.length) return fail(res, '申报任务不存在', 404);

        const parsed = readFiling(req.body || {}, true);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;
        if (!Object.keys(o).length) return fail(res, '没有需要更新的字段');

        if (o.status === 'FILED' && o.filed_date === undefined && !cur[0].filed_date) {
            o.filed_date = todayStr();
        }

        const fields = Object.keys(o);
        await pool.execute(
            `UPDATE tax_filing_task SET ${fields.map(f => `${f}=?`).join(', ')} WHERE uid=?`,
            [...fields.map(f => o[f]), uid]);

        const [rows] = await pool.execute('SELECT * FROM tax_filing_task WHERE uid=?', [uid]);
        ok(res, buildFilingRows(rows, todayStr())[0], '申报任务已更新');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return fail(res, '同一公司、年度、所属期、税种与周期的任务已存在');
        fail500(res, err);
    }
});

router.delete('/filing-tasks/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [result] = await pool.execute('DELETE FROM tax_filing_task WHERE uid=?', [uid]);
        if (!result.affectedRows) return fail(res, '申报任务不存在', 404);
        ok(res, { uid }, '申报任务已删除');
    } catch (err) { fail500(res, err); }
});

// ============ 合规事项 ============
router.get('/compliance-items', async (req, res) => {
    try {
        const bu = parseBu(req.query.bu_no, 'ALL');
        if (!bu) return fail(res, '公司别仅支持 ALL/GROUP/HM/HN/SZ');
        const year = parseYear(req.query.YYYY) || await defaultYear();
        let sql = 'SELECT * FROM tax_compliance_item WHERE tax_year=?';
        const params = [year];
        if (bu !== 'ALL') { sql += ' AND bu_no=?'; params.push(bu); }
        sql += ' ORDER BY (due_date IS NULL), due_date, uid';
        const [rows] = await pool.execute(sql, params);
        let list = buildItemRows(rows, todayStr());
        const status = String(req.query.status || '').trim().toUpperCase();
        if (status) list = list.filter(r => r.status === status);
        const category = String(req.query.category || '').trim().toUpperCase();
        if (category) list = list.filter(r => r.category === category);
        ok(res, { YYYY: year, bu_no: bu, rows: list });
    } catch (err) { fail500(res, err); }
});

router.post('/compliance-items', async (req, res) => {
    try {
        const parsed = readItem(req.body || {}, false);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;
        if (!o.frequency) o.frequency = 'MONTHLY';
        if (!o.status) o.status = 'NOT_STARTED';
        if (!o.risk_level) o.risk_level = 'MEDIUM';
        if (o.status === 'DONE' && !o.completed_date) o.completed_date = todayStr();

        const [result] = await pool.execute(
            `INSERT INTO tax_compliance_item
                (bu_no, tax_year, category, item_name, requirement, frequency,
                 owner_dept, owner_id, due_date, completed_date, status, risk_level, evidence, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [o.bu_no, o.tax_year, o.category, o.item_name, o.requirement || null, o.frequency,
             o.owner_dept || null, o.owner_id || null, o.due_date || null, o.completed_date || null,
             o.status, o.risk_level, o.evidence || null, o.note || null]);

        const [rows] = await pool.execute('SELECT * FROM tax_compliance_item WHERE uid=?', [result.insertId]);
        ok(res, buildItemRows(rows, todayStr())[0], '合规事项已创建');
    } catch (err) { fail500(res, err); }
});

router.put('/compliance-items/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT * FROM tax_compliance_item WHERE uid=?', [uid]);
        if (!cur.length) return fail(res, '合规事项不存在', 404);

        const parsed = readItem(req.body || {}, true);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;
        if (!Object.keys(o).length) return fail(res, '没有需要更新的字段');
        if (o.status === 'DONE' && o.completed_date === undefined && !cur[0].completed_date) {
            o.completed_date = todayStr();
        }

        const fields = Object.keys(o);
        await pool.execute(
            `UPDATE tax_compliance_item SET ${fields.map(f => `${f}=?`).join(', ')} WHERE uid=?`,
            [...fields.map(f => o[f]), uid]);

        const [rows] = await pool.execute('SELECT * FROM tax_compliance_item WHERE uid=?', [uid]);
        ok(res, buildItemRows(rows, todayStr())[0], '合规事项已更新');
    } catch (err) { fail500(res, err); }
});

router.delete('/compliance-items/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [result] = await pool.execute('DELETE FROM tax_compliance_item WHERE uid=?', [uid]);
        if (!result.affectedRows) return fail(res, '合规事项不存在', 404);
        ok(res, { uid }, '合规事项已删除');
    } catch (err) { fail500(res, err); }
});

// ============ 法规政策库 ============
router.get('/regulations', async (req, res) => {
    try {
        const year = parseYear(req.query.YYYY) || await defaultYear();
        const [rows] = await pool.execute(
            `SELECT * FROM tax_regulation
              WHERE status <> 'ARCHIVED'
                AND (YEAR(publish_date)=? OR YEAR(effective_date)=?)
              ORDER BY impact_level, COALESCE(effective_date, publish_date) DESC, uid DESC`,
            [year, year]);
        ok(res, { YYYY: year, rows: buildRegRows(rows) });
    } catch (err) { fail500(res, err); }
});

router.post('/regulations', async (req, res) => {
    try {
        const parsed = readRegulation(req.body || {}, false);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;
        if (!o.category) o.category = 'OTHER';
        if (!o.impact_level) o.impact_level = 'MEDIUM';
        if (!o.status) o.status = 'NEW';

        const [result] = await pool.execute(
            `INSERT INTO tax_regulation
                (reg_code, title, category, issue_org, publish_date, effective_date,
                 impact_level, summary, action_required, status, owner_id, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [o.reg_code || null, o.title, o.category, o.issue_org || null,
             o.publish_date || null, o.effective_date || null, o.impact_level,
             o.summary || null, o.action_required || null, o.status,
             o.owner_id || null, o.note || null]);

        const [rows] = await pool.execute('SELECT * FROM tax_regulation WHERE uid=?', [result.insertId]);
        ok(res, buildRegRows(rows)[0], '法规已创建');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return fail(res, '法规文号已存在');
        fail500(res, err);
    }
});

router.put('/regulations/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [cur] = await pool.execute('SELECT * FROM tax_regulation WHERE uid=?', [uid]);
        if (!cur.length) return fail(res, '法规不存在', 404);

        const parsed = readRegulation(req.body || {}, true);
        if (parsed.error) return fail(res, parsed.error);
        const o = parsed.value;
        if (!Object.keys(o).length) return fail(res, '没有需要更新的字段');

        const fields = Object.keys(o);
        await pool.execute(
            `UPDATE tax_regulation SET ${fields.map(f => `${f}=?`).join(', ')} WHERE uid=?`,
            [...fields.map(f => o[f]), uid]);

        const [rows] = await pool.execute('SELECT * FROM tax_regulation WHERE uid=?', [uid]);
        ok(res, buildRegRows(rows)[0], '法规已更新');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return fail(res, '法规文号已存在');
        fail500(res, err);
    }
});

router.delete('/regulations/:uid', async (req, res) => {
    try {
        const uid = Number(req.params.uid);
        if (!uid) return fail(res, '参数无效');
        const [result] = await pool.execute('DELETE FROM tax_regulation WHERE uid=?', [uid]);
        if (!result.affectedRows) return fail(res, '法规不存在', 404);
        ok(res, { uid }, '法规已删除');
    } catch (err) { fail500(res, err); }
});

// ============ 风险扫描 ============
router.post('/scan', async (req, res) => {
    try {
        const body = req.body || {};
        const bu = parseBu(body.bu_no, 'ALL');
        if (!bu) return fail(res, '公司别仅支持 ALL/GROUP/HM/HN/SZ');
        const year = parseYear(body.YYYY) || await defaultYear();
        const r = await scanCompliance(bu, year);
        ok(res, r, `扫描完成，新增预警 ${r.created} 条，抑制重复 ${r.suppressed} 条`);
    } catch (err) { fail500(res, err); }
});

module.exports = router;
