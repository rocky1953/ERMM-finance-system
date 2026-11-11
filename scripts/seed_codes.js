const { pool } = require('../config/db');
(async () => {
    // 先查 BUSINESS_ID 是否有（summary.js 和 system.js 在读它）
    const [b] = await pool.execute(`SELECT code_type, code_value, value_description, value_number3 AS VAT_rate
        FROM cams_system_codes WHERE code_type='BUSINESS_ID' ORDER BY code_value`);
    console.log('BUSINESS_ID_EXIST=' + JSON.stringify(b));

    // 查现有所有 code_type 清单
    const [all] = await pool.execute(`SELECT code_type, COUNT(*) n FROM cams_system_codes GROUP BY code_type ORDER BY code_type`);
    console.log('ALL_TYPES=' + JSON.stringify(all));

    // 补种子
    const seeds = [
        // BUSINESS_ID（必须有，否则 summary.js / system.js 读不到公司）
        { code_type: 'BUSINESS_ID', code_value: 'HM', value_description: '华明', value_number3: 13, sort_order: 1 },
        { code_type: 'BUSINESS_ID', code_value: 'HN', value_description: '华能', value_number3: 13, sort_order: 2 },
        { code_type: 'BUSINESS_ID', code_value: 'SZ', value_description: '深圳公司', value_number3: 13, sort_order: 3 },

        // 任务状态（actions.js 前端硬编码 pending/doing/done）
        { code_type: 'ACTION_STATUS', code_value: 'pending', value_description: '待处理', sort_order: 1 },
        { code_type: 'ACTION_STATUS', code_value: 'doing', value_description: '进行中', sort_order: 2 },
        { code_type: 'ACTION_STATUS', code_value: 'done', value_description: '已完成', sort_order: 3 },

        // 任务优先级（actions.js 硬编码 low/medium/high）
        { code_type: 'ACTION_PRIORITY', code_value: 'low', value_description: '低', sort_order: 1 },
        { code_type: 'ACTION_PRIORITY', code_value: 'medium', value_description: '中', sort_order: 2 },
        { code_type: 'ACTION_PRIORITY', code_value: 'high', value_description: '高', sort_order: 3 },

        // 贷款类型（bank.js 硬编码 Short-term / Long-term / FX Loan）
        { code_type: 'LOAN_TYPE', code_value: 'Short-term', value_description: '短期贷款', sort_order: 1 },
        { code_type: 'LOAN_TYPE', code_value: 'Long-term', value_description: '长期贷款', sort_order: 2 },
        { code_type: 'LOAN_TYPE', code_value: 'FX Loan', value_description: '外汇贷款', sort_order: 3 },

        // 往来对象状态（relation.js 的 USE/NOUSE）
        { code_type: 'FLAG', code_value: 'USE', value_description: '启用', sort_order: 1 },
        { code_type: 'FLAG', code_value: 'NOUSE', value_description: '停用', sort_order: 2 },

        // 管理员角色（dailyReport / alert / drAlertScanner 硬编码 MANAGER_TYPES）
        { code_type: 'USER_ROLE', code_value: '部門主管', value_description: '繁体-部门主管', sort_order: 1 },
        { code_type: 'USER_ROLE', code_value: '部门主管', value_description: '简体-部门主管', sort_order: 2 },
        { code_type: 'USER_ROLE', code_value: '高階主管', value_description: '繁体-高阶主管', sort_order: 3 },
        { code_type: 'USER_ROLE', code_value: '高阶主管', value_description: '简体-高阶主管', sort_order: 4 },
        { code_type: 'USER_ROLE', code_value: '部門經理', value_description: '繁体-部门经理', sort_order: 5 },
        { code_type: 'USER_ROLE', code_value: '部门经理', value_description: '简体-部门经理', sort_order: 6 },

        // CIT 调整项类型（tax.js 硬编码 5 项）
        { code_type: 'CIT_ADJ_TYPE', code_value: 'TAX_FREE_INCOME', value_description: '免税收入', sort_order: 1 },
        { code_type: 'CIT_ADJ_TYPE', code_value: 'ADJ_INCREASE', value_description: '纳税调增', sort_order: 2 },
        { code_type: 'CIT_ADJ_TYPE', code_value: 'ADJ_DECREASE', value_description: '纳税调减', sort_order: 3 },
        { code_type: 'CIT_ADJ_TYPE', code_value: 'TAX_EXEMPTION', value_description: '税额减免', sort_order: 4 },
        { code_type: 'CIT_ADJ_TYPE', code_value: 'TAX_CREDIT', value_description: '税额抵免', sort_order: 5 },
    ];

    let n = 0;
    for (const s of seeds) {
        const [dup] = await pool.execute(
            `SELECT id FROM cams_system_codes WHERE code_type=? AND code_value=?`, [s.code_type, s.code_value]);
        if (dup.length) continue;
        await pool.execute(`
            INSERT INTO cams_system_codes
                (code_type, code_value, value_description, value_number3, sort_order, inuse_flag, create_time, update_time)
            VALUES (?, ?, ?, ?, COALESCE(?,99), 'USE', NOW(), NOW())
        `, [s.code_type, s.code_value, s.value_description, s.value_number3 ?? null, s.sort_order ?? 99]);
        n++;
    }
    console.log(`SEED_INSERTED=${n}`);
    const [cnt] = await pool.execute(`SELECT code_type, COUNT(*) n FROM cams_system_codes GROUP BY code_type ORDER BY code_type`);
    console.log('FINAL=' + JSON.stringify(cnt));
    await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
