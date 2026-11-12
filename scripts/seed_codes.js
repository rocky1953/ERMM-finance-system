const { pool } = require('../config/db');
(async () => {
    const seeds = [
        // relation 类型
        { code_type: 'RELATION_TYPE', code_value: '客户', value_description: '往来对象-客户', sort_order: 1 },
        { code_type: 'RELATION_TYPE', code_value: '供应商', value_description: '往来对象-供应商', sort_order: 2 },
        { code_type: 'RELATION_TYPE', code_value: '关系人', value_description: '往来对象-其他关系人', sort_order: 3 },
        // 日报工作类型
        { code_type: 'WK_TYPE', code_value: '日常工作', value_description: '日常工作任务', sort_order: 1 },
        { code_type: 'WK_TYPE', code_value: '职业发展', value_description: '职业成长/培训', sort_order: 2 },
        { code_type: 'WK_TYPE', code_value: '财务状况', value_description: '财务相关工作', sort_order: 3 },
        { code_type: 'WK_TYPE', code_value: '健康', value_description: '健康/运动', sort_order: 4 },
        { code_type: 'WK_TYPE', code_value: '娱乐休闲', value_description: '娱乐活动', sort_order: 5 },
        { code_type: 'WK_TYPE', code_value: '家庭', value_description: '家庭事务', sort_order: 6 },
        { code_type: 'WK_TYPE', code_value: '朋友圈', value_description: '社交', sort_order: 7 },
        { code_type: 'WK_TYPE', code_value: '个人成长', value_description: '自我学习', sort_order: 8 },
        { code_type: 'WK_TYPE', code_value: '自我实现', value_description: '理想/愿景', sort_order: 9 },
        // 银行贷款状态
        { code_type: 'LOAN_STATUS', code_value: '使用中', value_description: '贷款进行中', sort_order: 1 },
        { code_type: 'LOAN_STATUS', code_value: 'Active', value_description: '贷款进行中（英文别名）', sort_order: 2 },
        { code_type: 'LOAN_STATUS', code_value: '已结清', value_description: '贷款已还清', sort_order: 3 },
        { code_type: 'LOAN_STATUS', code_value: 'Closed', value_description: '贷款已还清（英文别名）', sort_order: 4 },
        // 税类型 / 税率（value_number1 为百分数，报税算税直接读取）
        { code_type: 'TAX_TYPE', code_value: 'VAT', value_description: '增值税', value_number1: 0 },
        { code_type: 'TAX_TYPE', code_value: 'CIT', value_description: '一般纳税人', value_number1: 13 },
        { code_type: 'TAX_TYPE', code_value: 'IIT', value_description: '小型纳税人', value_number1: 3 },
        { code_type: 'TAX_TYPE', code_value: 'EIT', value_description: '企业所得税', value_number1: 25 },
        { code_type: 'TAX_TYPE', code_value: 'ST', value_description: '印花税', value_number1: 0 },
        // 增值税申报状态
        { code_type: 'FILE_STATUS', code_value: 'DRAFT', value_description: '草稿' },
        { code_type: 'FILE_STATUS', code_value: 'SUBMITTED', value_description: '已提交' },
        { code_type: 'FILE_STATUS', code_value: 'FILED', value_description: '已申报/已入账' },
        { code_type: 'FILE_STATUS', code_value: 'PENDING', value_description: '待审批' },
        { code_type: 'FILE_STATUS', code_value: 'REJECTED', value_description: '已退回' },
    ];
    let n = 0;
    for (const s of seeds) {
        const [dup] = await pool.execute(
            `SELECT id FROM cams_system_codes WHERE code_type=? AND code_value=?`, [s.code_type, s.code_value]);
        if (dup.length) continue;
        await pool.execute(`
            INSERT INTO cams_system_codes
                (code_type, code_value, value_description, value_number1, sort_order, inuse_flag, create_time, update_time)
            VALUES (?, ?, ?, ?, COALESCE(?,99), 'USE', NOW(), NOW())
        `, [s.code_type, s.code_value, s.value_description, s.value_number1 ?? null, s.sort_order ?? 99]);
        n++;
    }
    console.log(`SEED_INSERTED=${n}`);
    const [cnt] = await pool.execute(`SELECT code_type, COUNT(*) n FROM cams_system_codes GROUP BY code_type ORDER BY code_type`);
    console.log('FINAL=' + JSON.stringify(cnt));
    await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
