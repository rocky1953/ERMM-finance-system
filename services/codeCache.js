/**
 * 系统码表内存缓存（从 cams_system_codes 表读取）
 * 用法：
 *   const { codeList, ensureCode, invalidate } = require('../services/codeCache');
 *
 *   // 启动时预加载（推荐在 app.js 顶部调一次）
 *   await ensureCode();
 *
 *   // 同步读（已预加载或有兜底）
 *   const wkTypes = codeList.WK_TYPE;  // ['日常工作', '职业发展', ...]
 *
 *   // 运行时刷新
 *   await ensureCode('WK_TYPE');
 */
const { pool } = require('../config/db');

const FAILBACK = {
    WK_TYPE:      ['日常工作','职业发展','财务状况','健康','娱乐休闲','家庭','朋友圈','个人成长','自我实现'],
    USER_ROLE:    ['部門主管','高階主管','部門經理','部门主管','部门经理','高阶主管','高价主管'],
    CIT_ADJ_TYPE: ['TAX_FREE_INCOME','ADJ_INCREASE','ADJ_DECREASE','TAX_EXEMPTION','TAX_CREDIT'],
    RELATION_TYPE:['客户','供应商','关系人'],
    FLAG:         ['USE','NOUSE'],
    ACTION_STATUS:['pending','doing','done'],
    ACTION_PRIORITY:['low','medium','high'],
    LOAN_TYPE:    ['Short-term','Long-term','FX Loan'],
    LOAN_STATUS:  ['使用中','Active','已结清','Closed'],
    TAX_TYPE:     ['VAT','CIT','ST','IT'],
    FILE_STATUS:  ['DRAFT','SUBMITTED','FILED','PENDING','REJECTED'],
    BUSINESS_ID:  ['HM','HN','SZ'],
    CURRENCY:     ['HKD','RMB','USD','EUR','JPY'],
    AGEING_STOCK: ['31-90天','91-180天','181-365天'],
};

// 已注册的路由常用码表（启动时预加载）
const PRELOAD_TYPES = ['WK_TYPE', 'USER_ROLE', 'CIT_ADJ_TYPE', 'RELATION_TYPE', 'FLAG',
                       'ACTION_STATUS', 'ACTION_PRIORITY', 'LOAN_TYPE', 'TAX_TYPE', 'FILE_STATUS'];

/** code_type -> ['code_value', ...] 数组（排序后） */
const codeList = {};
/** code_type -> [{code_value, value_description, ...}] 完整对象 */
const codeListFull = {};
/** 加载中 Promise（并发去重） */
const loading = {};
let initialized = false;

async function loadOne(codeType) {
    try {
        const [rows] = await pool.execute(
            `SELECT code_value, value_description, value_number1, value_number2, value_number3,
                    value_alpha1, value_alpha2, sort_order
               FROM cams_system_codes
              WHERE code_type=? AND (inuse_flag='USE' OR inuse_flag IS NULL OR inuse_flag='')
              ORDER BY COALESCE(sort_order, 999), code_value`,
            [codeType]
        );
        codeListFull[codeType] = rows;
        codeList[codeType] = rows.map(r => r.code_value);
    } catch (e) {
        console.warn(`[codeCache] 加载 ${codeType} 失败，使用硬编码兜底：${e.message}`);
        codeList[codeType] = FAILBACK[codeType] || [];
        codeListFull[codeType] = (FAILBACK[codeType] || []).map(v => ({ code_value: v }));
    }
}

/** 预加载所有常用码表，或指定单个 */
async function ensureCode(codeType) {
    if (codeList[codeType] !== undefined) return;
    if (loading[codeType]) return loading[codeType];
    loading[codeType] = loadOne(codeType).finally(() => delete loading[codeType]);
    return loading[codeType];
}

/** 全量预加载（启动时调用） */
async function initAll() {
    if (initialized) return;
    initialized = true;
    await Promise.all(PRELOAD_TYPES.map(t => ensureCode(t)));
}

/** 手动刷新（码表新增修改后调用） */
function invalidate(codeType) {
    if (codeType) { delete codeList[codeType]; delete codeListFull[codeType]; }
    else { Object.keys(codeList).forEach(k => { delete codeList[k]; delete codeListFull[k]; }); initialized = false; }
}

/**
 * 便捷 getter 函数（每次调用时动态从内存缓存取）
 * 调用时机晚于 initAll() 即拿到真实码表，否则拿兜底硬编码
 */
function wkTypes()      { return codeList.WK_TYPE && codeList.WK_TYPE.length      ? codeList.WK_TYPE      : FAILBACK.WK_TYPE; }
function managerTypes() { return codeList.USER_ROLE && codeList.USER_ROLE.length   ? codeList.USER_ROLE   : FAILBACK.USER_ROLE; }
function citAdjTypes()  { return codeList.CIT_ADJ_TYPE && codeList.CIT_ADJ_TYPE.length ? codeList.CIT_ADJ_TYPE : FAILBACK.CIT_ADJ_TYPE; }
function relationTypes(){ return codeList.RELATION_TYPE && codeList.RELATION_TYPE.length ? codeList.RELATION_TYPE : FAILBACK.RELATION_TYPE; }
function loanTypes()    { return codeList.LOAN_TYPE && codeList.LOAN_TYPE.length   ? codeList.LOAN_TYPE   : FAILBACK.LOAN_TYPE; }
function flagValues()   { return codeList.FLAG && codeList.FLAG.length             ? codeList.FLAG        : FAILBACK.FLAG; }

/** LIFE_TYPES = WK_TYPES.slice(1) 派生 */
function lifeTypes() { return wkTypes().slice(1); }

module.exports = { codeList, codeListFull, ensureCode, initAll, invalidate,
                   wkTypes, managerTypes, citAdjTypes, relationTypes, loanTypes, flagValues, lifeTypes };
