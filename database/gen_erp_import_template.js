/**
 * 生成「ERMM ERP 第三方导入模板」Excel
 *
 * 范围：ERP 接单（SO）、采购（PO）、制造（MO/用料/工艺/报工）及相关配套主档
 * 结构：
 *   00_使用说明  — 资料表清单、导入顺序、格式规范、去重键
 *   01_栏位总览  — 全部资料表 × 栏位（中英文、类型、必填、说明）
 *   每张资料表一个 Sheet，Sheet 名 = 资料表英文名
 *     第 1 行：中文名称 + 英文栏位名（* 为必填）
 *     第 2~3 行：灰色示例，正式填报前删除
 *     第 4 行起：第三方填写
 *
 * 用法：node database/gen_erp_import_template.js
 */
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'exports', 'ERMM_ERP_Import_Template_20261025.xlsx');

const NUM_FMT = {
    '文本': '@',
    '日期': 'yyyy-mm-dd',
    '数量': '0.0000',
    '单价': '0.000000',
    '金额': '0.00',
    '汇率': '0.000000',
    '整数': '0',
    '百分比': '0.00',
};

const TABLES = [
    {
        sheet: 'relation_detail',
        table: 'relation_detail',
        domain: '主档',
        cn: '往来对象主档',
        fill: 'FF8E44AD',
        desc: '客户 / 供应商 / 关系人主档；接单、采购导入前必须先建立',
        dedupe: 'bu_no + relation_id',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'relation_id', cn: '往来对象编号', type: '文本', req: true, note: '客户/供应商编码，需唯一', ex: 'C001' },
            { en: 'relation_name', cn: '往来对象名称', type: '文本', req: true, note: '公司全称', ex: '客户A有限公司' },
            { en: 'relation_type', cn: '往来对象类型', type: '文本', req: true, note: '客户 / 供应商 / 关系人', ex: '客户' },
            { en: 'contact_person', cn: '联系人', type: '文本', req: false, note: '主要联系人', ex: '张三' },
            { en: 'contact_phone', cn: '联系电话', type: '文本', req: false, note: '含区号', ex: '13800000000' },
            { en: 'address', cn: '地址', type: '文本', req: false, note: '完整地址', ex: '广东省深圳市南山区XX路1号' },
            { en: 'tax_id', cn: '统一编号/税号', type: '文本', req: false, note: '纳税人识别号', ex: '91440300XXXXXXXXXX' },
            { en: 'inuse_flag', cn: '启用标志', type: '文本', req: false, note: '默认 USE；停用填 NOUSE', ex: 'USE' },
        ],
        samples: [
            ['HM', 'C001', '客户A有限公司', '客户', '张三', '13800000000', '广东省深圳市南山区XX路1号', '91440300XXXXXXXXXX', 'USE'],
            ['HM', 'S001', '供应商X有限公司', '供应商', '李四', '13900000000', '广东省东莞市XX工业区', '91441900XXXXXXXXXX', 'USE'],
        ],
    },
    {
        sheet: 'cams_system_codes',
        table: 'cams_system_codes',
        domain: '参数',
        cn: '系统码表（汇率）',
        fill: 'FF8E44AD',
        desc: '采购 Step2 本币换算所需的币别与汇率；code_type 固定填 CURRENCY',
        dedupe: 'code_type + code_value',
        fields: [
            { en: 'code_type', cn: '码表类型', type: '文本', req: true, note: '本模板填 CURRENCY', ex: 'CURRENCY' },
            { en: 'code_value', cn: '币别代码', type: '文本', req: true, note: 'RMB / USD / HKD 等', ex: 'RMB' },
            { en: 'value_description', cn: '说明', type: '文本', req: false, note: '币别中文名称', ex: '人民币' },
            { en: 'value_number1', cn: '汇率', type: '汇率', req: true, note: '原币→本币汇率，本币填 1', ex: '1' },
            { en: 'inuse_flag', cn: '启用标志', type: '文本', req: false, note: '默认 USE', ex: 'USE' },
        ],
        samples: [
            ['CURRENCY', 'RMB', '人民币', 1, 'USE'],
            ['CURRENCY', 'USD', '美元', 7.1, 'USE'],
        ],
    },
    {
        sheet: 'ermm_erp_so',
        table: 'ermm_erp_so',
        domain: '接单',
        cn: '销售订单（接单）表',
        fill: 'FF1E8449',
        desc: '接单明细；同一订单多物料拆成多行。YYYY/MM/YYYY_MM 由系统依 so_date 自动生成',
        dedupe: 'bu_no + so_nbr + xitems',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'so_nbr', cn: '销售订单号', type: '文本', req: true, note: '同一订单多物料重复此单号', ex: 'SO2510001' },
            { en: 'client_id', cn: '客户编号', type: '文本', req: false, note: '对应 relation_detail.relation_id', ex: 'C001' },
            { en: 'client_name', cn: '客户名称', type: '文本', req: true, note: '公司全称', ex: '客户A有限公司' },
            { en: 'xitems', cn: '物料/产品编号', type: '文本', req: true, note: '第三方料号', ex: 'ITEM001' },
            { en: 'so_date', cn: '接单日期', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-05' },
            { en: 'so_qty', cn: '订单数量', type: '数量', req: true, note: '最多 4 位小数', ex: 1000 },
            { en: 'dn_qty', cn: '已交货数量', type: '数量', req: false, note: '默认 0', ex: 200 },
            { en: 'unit_price', cn: '单价（原币）', type: '单价', req: true, note: '最多 6 位小数', ex: 12.5 },
            { en: 'status', cn: '订单状态', type: '文本', req: false, note: '未交货 / 部分交货 / 结案', ex: '未交货' },
            { en: 'remark', cn: '备注', type: '文本', req: false, note: '自由文本', ex: '10月订单' },
        ],
        samples: [
            ['HM', 'SO2510001', 'C001', '客户A有限公司', 'ITEM001', '2025-10-05', 1000, 200, 12.5, '未交货', '10月订单'],
            ['HM', 'SO2510001', 'C001', '客户A有限公司', 'ITEM002', '2025-10-05', 500, 0, 8.8, '未交货', '10月订单'],
        ],
    },
    {
        sheet: 'ermm_erp_so_dn',
        table: 'ermm_erp_so_dn',
        domain: '接单',
        cn: '销售交货单表',
        fill: 'FF1E8449',
        desc: 'SO 出货/交货记录；so_nbr + xitems 必须存在于 ermm_erp_so',
        dedupe: 'bu_no + so_nbr + xitems + DN_date',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'so_nbr', cn: '销售订单号', type: '文本', req: true, note: '必须存在于 ermm_erp_so', ex: 'SO2510001' },
            { en: 'xitems', cn: '物料/产品编号', type: '文本', req: true, note: '与 SO 行一致', ex: 'ITEM001' },
            { en: 'client_name', cn: '客户名称', type: '文本', req: true, note: '公司全称', ex: '客户A有限公司' },
            { en: 'DN_date', cn: '交货日期', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-15' },
            { en: 'DN_qty', cn: '本次交货数量', type: '数量', req: true, note: '最多 4 位小数', ex: 400 },
            { en: 'so_qty', cn: '订单总数量', type: '数量', req: false, note: '用于核对', ex: 1000 },
        ],
        samples: [
            ['HM', 'SO2510001', 'ITEM001', '客户A有限公司', '2025-10-15', 400, 1000],
            ['HM', 'SO2510001', 'ITEM002', '客户A有限公司', '2025-10-18', 200, 500],
        ],
    },
    {
        sheet: 'ermm_temp_po',
        table: 'ermm_temp_po',
        domain: '采购',
        cn: '采购订单暂存表',
        fill: 'FFD35400',
        desc: '第三方采购订单唯一入口；导入后由系统 Step1 生成正式采购单 ermm_erp_po',
        dedupe: 'bu_no + po_id + xitems + batch_id',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'po_id', cn: '采购订单号', type: '文本', req: true, note: '同一订单多物料重复此单号', ex: 'PO2510001' },
            { en: 'supplier_name', cn: '供应商名称', type: '文本', req: true, note: '公司全称', ex: '供应商X有限公司' },
            { en: 'xitems', cn: '物料编号', type: '文本', req: true, note: '第三方料号', ex: 'ITEM001' },
            { en: 'po_date', cn: '采购日期', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-03' },
            { en: 'po_qty', cn: '采购数量', type: '数量', req: true, note: '最多 4 位小数', ex: 5000 },
            { en: 'unit_price', cn: '采购单价（原币）', type: '单价', req: true, note: '最多 6 位小数', ex: 8.5 },
            { en: 'exchange_rate', cn: '汇率', type: '汇率', req: false, note: '原币→本币，默认 1', ex: 1 },
            { en: 'po_amount', cn: '采购金额（原币）', type: '金额', req: false, note: '留空由系统按 数量×单价 计算', ex: 42500 },
            { en: 'vat_amt', cn: '税额', type: '金额', req: false, note: '默认 0', ex: 5525 },
            { en: 'batch_id', cn: '批次号', type: '文本', req: true, note: '建议 BATCH_YYYYMM，便于整批重跑', ex: 'BATCH_202510' },
        ],
        samples: [
            ['HM', 'PO2510001', '供应商X有限公司', 'ITEM001', '2025-10-03', 5000, 8.5, 1, 42500, 5525, 'BATCH_202510'],
            ['HM', 'PO2510001', '供应商X有限公司', 'ITEM002', '2025-10-03', 2000, 12, 1, 24000, 3120, 'BATCH_202510'],
        ],
    },
    {
        sheet: 'transit_price',
        table: 'transit_price',
        domain: '采购',
        cn: '在途价格表',
        fill: 'FFD35400',
        desc: '在途数量、金额与船期（可选）',
        dedupe: 'bu_no + po_id + xitems',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'xitems', cn: '物料编号', type: '文本', req: true, note: '第三方料号', ex: 'ITEM001' },
            { en: 'item_name', cn: '物料名称', type: '文本', req: false, note: '品名', ex: '原料A' },
            { en: 'qty', cn: '在途数量', type: '数量', req: true, note: '最多 4 位小数', ex: 2000 },
            { en: 'unit_price', cn: '单价（原币）', type: '单价', req: true, note: '最多 6 位小数', ex: 8.5 },
            { en: 'exchange_rate', cn: '汇率', type: '汇率', req: false, note: '默认 1', ex: 1 },
            { en: 'transit_amt', cn: '在途金额', type: '金额', req: false, note: '留空由系统计算', ex: 17000 },
            { en: 'vessel_name', cn: '船名/运输工具', type: '文本', req: false, note: '海运填船名', ex: 'SEA STAR' },
            { en: 'ETD_date', cn: '预计启运日', type: '日期', req: false, note: 'YYYY-MM-DD', ex: '2025-10-10' },
            { en: 'ETA_date', cn: '预计到港日', type: '日期', req: false, note: 'YYYY-MM-DD', ex: '2025-10-25' },
            { en: 'po_id', cn: '关联采购单号', type: '文本', req: false, note: '对应 ermm_temp_po.po_id', ex: 'PO2510001' },
            { en: 'remark', cn: '备注', type: '文本', req: false, note: '自由文本', ex: '' },
        ],
        samples: [
            ['HM', 'ITEM001', '原料A', 2000, 8.5, 1, 17000, 'SEA STAR', '2025-10-10', '2025-10-25', 'PO2510001', ''],
        ],
    },
    {
        sheet: 'e2_xitems_daily_status',
        table: 'e2_xitems_daily_status',
        domain: '采购',
        cn: '每日库存状态表',
        fill: 'FFD35400',
        desc: '库存数量、库龄与减值率（可选）；库存价值/现值/减值损失由系统 Step5 计算',
        dedupe: 'bu_no + stock_date + xitems',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'xitems', cn: '物料编号', type: '文本', req: true, note: '第三方料号', ex: 'ITEM001' },
            { en: 'item_name', cn: '物料名称', type: '文本', req: false, note: '品名', ex: '原料A' },
            { en: 'qty_balance', cn: '库存数量', type: '数量', req: true, note: '最多 4 位小数', ex: 3000 },
            { en: 'unit_price', cn: '单价（原币）', type: '单价', req: true, note: '最多 6 位小数', ex: 8.5 },
            { en: 'exchange_rate', cn: '汇率', type: '汇率', req: false, note: '默认 1', ex: 1 },
            { en: 'stock_date', cn: '库存日期', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-31' },
            { en: 'ageing_days', cn: '库龄天数', type: '整数', req: false, note: '默认 0', ex: 45 },
            { en: 'ageing_category', cn: '库龄分类', type: '文本', req: false, note: '留空由系统按天数归类 A/B/C/D', ex: 'B 31-90天' },
            { en: 'reduce_percentage', cn: '减值率（%）', type: '百分比', req: false, note: '填 13 表示 13%', ex: 5 },
        ],
        samples: [
            ['HM', 'ITEM001', '原料A', 3000, 8.5, 1, '2025-10-31', 45, 'B 31-90天', 5],
            ['HM', 'ITEM002', '原料B', 800, 12, 1, '2025-10-31', 120, 'C 91-180天', 13],
        ],
    },
    {
        sheet: 'mgm_production_details',
        table: 'mgm_production_details',
        domain: '制造',
        cn: '生产明细表',
        fill: 'FF2874A6',
        desc: '生产数量、不良数量、质检结果；YYYY_MM 由系统依 wk_date 自动生成',
        dedupe: 'bu_no + wk_date + xitems + so_nbr',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'wk_date', cn: '生产日期', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-12' },
            { en: 'xitems', cn: '产品/物料编号', type: '文本', req: true, note: '第三方料号', ex: 'PROD001' },
            { en: 'customer_name', cn: '客户名称', type: '文本', req: false, note: '公司全称', ex: '客户A有限公司' },
            { en: 'so_nbr', cn: '关联销售订单号', type: '文本', req: false, note: '对应 ermm_erp_so.so_nbr', ex: 'SO2510001' },
            { en: 'batch_qty', cn: '生产批量/数量', type: '数量', req: true, note: '最多 4 位小数', ex: 800 },
            { en: 'df_qty', cn: '不良数量', type: '数量', req: false, note: '默认 0', ex: 12 },
            { en: 'qc_type', cn: '质检类型/结果', type: '文本', req: false, note: '全检 / 抽检 / 合格', ex: '全检' },
        ],
        samples: [
            ['HM', '2025-10-12', 'PROD001', '客户A有限公司', 'SO2510001', 800, 12, '全检'],
            ['HM', '2025-10-13', 'PROD002', '客户A有限公司', 'SO2510001', 500, 3, '抽检'],
        ],
    },
    {
        sheet: 'ermm_erp_mo',
        table: 'ermm_erp_mo',
        domain: '制造',
        cn: '制造工单主档',
        fill: 'FF2874A6',
        desc: '新增表：制造工单（MO）主档；一行一张工单',
        dedupe: 'bu_no + mo_no',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'mo_no', cn: '制造工单号', type: '文本', req: true, note: '工单唯一编号', ex: 'MO2510001' },
            { en: 'xitems', cn: '产品编号', type: '文本', req: true, note: '要生产的产品料号', ex: 'PROD001' },
            { en: 'item_name', cn: '产品名称', type: '文本', req: false, note: '品名', ex: '产品A' },
            { en: 'plan_qty', cn: '计划生产数量', type: '数量', req: true, note: '最多 4 位小数', ex: 1000 },
            { en: 'completed_qty', cn: '已完工数量', type: '数量', req: false, note: '默认 0', ex: 600 },
            { en: 'scrap_qty', cn: '报废数量', type: '数量', req: false, note: '默认 0', ex: 5 },
            { en: 'start_date', cn: '计划开工日', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-08' },
            { en: 'due_date', cn: '计划完工日', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-20' },
            { en: 'actual_start_date', cn: '实际开工日', type: '日期', req: false, note: 'YYYY-MM-DD', ex: '2025-10-08' },
            { en: 'actual_end_date', cn: '实际完工日', type: '日期', req: false, note: 'YYYY-MM-DD', ex: '' },
            { en: 'mo_status', cn: '工单状态', type: '文本', req: true, note: '开立 / 生产中 / 完工 / 结案 / 取消', ex: '生产中' },
            { en: 'customer_name', cn: '客户名称', type: '文本', req: false, note: '公司全称', ex: '客户A有限公司' },
            { en: 'so_nbr', cn: '关联销售订单号', type: '文本', req: false, note: '对应 ermm_erp_so.so_nbr', ex: 'SO2510001' },
            { en: 'priority', cn: '优先级', type: '文本', req: false, note: '高 / 中 / 低', ex: '高' },
            { en: 'remark', cn: '备注', type: '文本', req: false, note: '自由文本', ex: '' },
        ],
        samples: [
            ['HM', 'MO2510001', 'PROD001', '产品A', 1000, 600, 5, '2025-10-08', '2025-10-20', '2025-10-08', '', '生产中', '客户A有限公司', 'SO2510001', '高', ''],
        ],
    },
    {
        sheet: 'ermm_erp_mo_component',
        table: 'ermm_erp_mo_component',
        domain: '制造',
        cn: '工单用料明细表',
        fill: 'FF2874A6',
        desc: '新增表：工单用料（BOM 展开）明细；一行一个用料行',
        dedupe: 'bu_no + mo_no + line_no',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'mo_no', cn: '制造工单号', type: '文本', req: true, note: '必须存在于 ermm_erp_mo', ex: 'MO2510001' },
            { en: 'line_no', cn: '行号', type: '整数', req: true, note: '同一工单内唯一，从 10 开始', ex: 10 },
            { en: 'component_item', cn: '用料物料编号', type: '文本', req: true, note: '子件料号', ex: 'ITEM001' },
            { en: 'component_name', cn: '用料名称', type: '文本', req: false, note: '品名', ex: '原料A' },
            { en: 'req_qty', cn: '需求用量', type: '数量', req: true, note: '按工单需求量', ex: 1200 },
            { en: 'issued_qty', cn: '已领用量', type: '数量', req: false, note: '默认 0', ex: 800 },
            { en: 'unit', cn: '单位', type: '文本', req: false, note: 'PCS / KG / M 等', ex: 'PCS' },
            { en: 'warehouse', cn: '领料仓库', type: '文本', req: false, note: '仓库名称或代码', ex: '主仓' },
            { en: 'unit_price', cn: '单价（原币）', type: '单价', req: false, note: '最多 6 位小数', ex: 8.5 },
            { en: 'amount', cn: '金额（原币）', type: '金额', req: false, note: '留空由系统按 用量×单价 计算', ex: 10200 },
            { en: 'remark', cn: '备注', type: '文本', req: false, note: '自由文本', ex: '' },
        ],
        samples: [
            ['HM', 'MO2510001', 10, 'ITEM001', '原料A', 1200, 800, 'PCS', '主仓', 8.5, 10200, ''],
            ['HM', 'MO2510001', 20, 'ITEM002', '原料B', 300, 200, 'KG', '主仓', 12, 3600, ''],
        ],
    },
    {
        sheet: 'ermm_erp_routing',
        table: 'ermm_erp_routing',
        domain: '制造',
        cn: '工艺路线/工序表',
        fill: 'FF2874A6',
        desc: '新增表：产品工艺路线与工序；一行一道工序',
        dedupe: 'bu_no + xitems + routing_no + op_seq',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'xitems', cn: '产品编号', type: '文本', req: true, note: '对应 ermm_erp_mo.xitems', ex: 'PROD001' },
            { en: 'routing_no', cn: '工艺路线编号', type: '文本', req: true, note: '同一产品可有多版本', ex: 'RT001' },
            { en: 'op_seq', cn: '工序顺序', type: '整数', req: true, note: '从 10 开始，按 10 递增', ex: 10 },
            { en: 'op_code', cn: '工序编号', type: '文本', req: false, note: '工序代码', ex: 'OP10' },
            { en: 'op_name', cn: '工序名称', type: '文本', req: true, note: '如 裁切 / 组装 / 包装', ex: '裁切' },
            { en: 'work_center', cn: '工作中心/机台', type: '文本', req: false, note: '设备或产线代码', ex: 'CNC-01' },
            { en: 'std_time', cn: '标准工时（分钟）', type: '数量', req: false, note: '单件标准工时', ex: 15 },
            { en: 'setup_time', cn: '准备工时（分钟）', type: '数量', req: false, note: '换线/调机时间', ex: 5 },
            { en: 'yield_rate', cn: '良率（%）', type: '百分比', req: false, note: '填 98 表示 98%', ex: 98 },
            { en: 'is_key_process', cn: '是否关键工序', type: '文本', req: false, note: 'Y / N', ex: 'Y' },
            { en: 'remark', cn: '备注', type: '文本', req: false, note: '自由文本', ex: '' },
        ],
        samples: [
            ['HM', 'PROD001', 'RT001', 10, 'OP10', '裁切', 'CNC-01', 15, 5, 98, 'Y', ''],
            ['HM', 'PROD001', 'RT001', 20, 'OP20', '组装', 'LINE-A', 20, 10, 97, 'N', ''],
        ],
    },
    {
        sheet: 'ermm_erp_work_report',
        table: 'ermm_erp_work_report',
        domain: '制造',
        cn: '报工/产出记录表',
        fill: 'FF2874A6',
        desc: '新增表：每日/每班报工与产出记录；一行一个工单工序班次',
        dedupe: 'bu_no + mo_no + op_seq + wk_date + shift + operator',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'mo_no', cn: '制造工单号', type: '文本', req: true, note: '必须存在于 ermm_erp_mo', ex: 'MO2510001' },
            { en: 'op_seq', cn: '工序顺序', type: '整数', req: true, note: '对应工艺路线 op_seq', ex: 10 },
            { en: 'wk_date', cn: '报工日期', type: '日期', req: true, note: 'YYYY-MM-DD', ex: '2025-10-12' },
            { en: 'xitems', cn: '产品编号', type: '文本', req: false, note: '对应工单产品', ex: 'PROD001' },
            { en: 'work_center', cn: '工作中心/机台', type: '文本', req: false, note: '设备或产线代码', ex: 'CNC-01' },
            { en: 'good_qty', cn: '良品数量', type: '数量', req: true, note: '本班次良品产出', ex: 290 },
            { en: 'scrap_qty', cn: '不良/报废数量', type: '数量', req: false, note: '默认 0', ex: 10 },
            { en: 'rework_qty', cn: '返工数量', type: '数量', req: false, note: '默认 0', ex: 2 },
            { en: 'operator', cn: '作业员', type: '文本', req: false, note: '姓名或工号', ex: '张三' },
            { en: 'shift', cn: '班别', type: '文本', req: false, note: '白班 / 夜班', ex: '白班' },
            { en: 'work_hours', cn: '工时（小时）', type: '数量', req: false, note: '人工工时', ex: 8 },
            { en: 'machine_hours', cn: '机时（小时）', type: '数量', req: false, note: '设备运行工时', ex: 7.5 },
            { en: 'qc_type', cn: '质检类型/结果', type: '文本', req: false, note: '全检 / 抽检 / 合格', ex: '全检' },
            { en: 'remark', cn: '备注', type: '文本', req: false, note: '自由文本', ex: '' },
        ],
        samples: [
            ['HM', 'MO2510001', 10, '2025-10-12', 'PROD001', 'CNC-01', 290, 10, 2, '张三', '白班', 8, 7.5, '全检', ''],
            ['HM', 'MO2510001', 20, '2025-10-12', 'PROD001', 'LINE-A', 300, 5, 0, '李四', '白班', 8, 8, '抽检', ''],
        ],
    },
    {
        sheet: 'ermm_erp_documents',
        table: 'ermm_erp_documents',
        domain: '附件',
        cn: '单据文件表',
        fill: 'FF7F8C8D',
        desc: '采购合约、图纸等附件元数据（可选）；文件本体另行提供',
        dedupe: 'bu_no + doc_type + xitems + doc_name',
        fields: [
            { en: 'bu_no', cn: '公司别', type: '文本', req: true, note: 'HM / HN / SZ', ex: 'HM' },
            { en: 'doc_type', cn: '文件类型', type: '文本', req: true, note: '采购合约 / 图纸 / 其他', ex: '采购合约' },
            { en: 'xitems', cn: '关联编号', type: '文本', req: false, note: '如 PO 编号', ex: 'PO2510001' },
            { en: 'doc_name', cn: '文件名', type: '文本', req: true, note: '含扩展名', ex: 'PO2510001.pdf' },
            { en: 'doc_path', cn: '文件路径', type: '文本', req: false, note: '共享盘或附件目录路径', ex: '\\\\fileserver\\po\\PO2510001.pdf' },
            { en: 'upload_user', cn: '上传人', type: '文本', req: false, note: '姓名或工号', ex: '采购部' },
            { en: 'remark', cn: '备注', type: '文本', req: false, note: '自由文本', ex: '合约扫描件' },
        ],
        samples: [
            ['HM', '采购合约', 'PO2510001', 'PO2510001.pdf', '\\\\fileserver\\po\\PO2510001.pdf', '采购部', '合约扫描件'],
        ],
    },
];

const SYSTEM_TABLES = [
    ['ermm_erp_po', '正式采购订单表', '由 Step1/Step2 从 ermm_temp_po 生成，第三方不要直接填写'],
    ['ermm_arap_detail', '应收应付月底汇总', '由 Step6 汇算产生'],
    ['bh_mgm_tx_detail', '交易明细汇总', '批次加工产出'],
    ['e2_xitems_daily_status_chart', '库存汇总图表', 'Step5 加工产出'],
    ['cams_batch_control', '批次执行控制', '批次管线自动写入'],
    ['login_user_record', '登录记录', '系统自动产生'],
];

// 栏位顺序：按业务流排列
// 业务单位 → 单号/行号 → 日期 → 客户/供应商 → 物料 → 数量 → 单价/汇率/金额 → 状态/属性 → 备注
const FIELD_ORDER = {
    relation_detail: [
        'bu_no', 'relation_id', 'relation_name', 'relation_type',
        'contact_person', 'contact_phone', 'address', 'tax_id', 'inuse_flag',
    ],
    cams_system_codes: ['code_type', 'code_value', 'value_description', 'value_number1', 'inuse_flag'],
    ermm_erp_so: [
        'bu_no', 'so_nbr', 'so_date', 'client_id', 'client_name', 'xitems',
        'so_qty', 'dn_qty', 'unit_price', 'status', 'remark',
    ],
    ermm_erp_so_dn: ['bu_no', 'so_nbr', 'DN_date', 'client_name', 'xitems', 'DN_qty', 'so_qty'],
    ermm_temp_po: [
        'bu_no', 'po_id', 'po_date', 'supplier_name', 'xitems', 'po_qty',
        'unit_price', 'exchange_rate', 'po_amount', 'vat_amt', 'batch_id',
    ],
    transit_price: [
        'bu_no', 'po_id', 'xitems', 'item_name', 'qty', 'unit_price', 'exchange_rate',
        'transit_amt', 'vessel_name', 'ETD_date', 'ETA_date', 'remark',
    ],
    e2_xitems_daily_status: [
        'bu_no', 'xitems', 'item_name', 'stock_date', 'qty_balance', 'unit_price',
        'exchange_rate', 'ageing_days', 'reduce_percentage', 'ageing_category',
    ],
    mgm_production_details: [
        'bu_no', 'wk_date', 'so_nbr', 'xitems', 'customer_name', 'batch_qty', 'df_qty', 'qc_type',
    ],
    ermm_erp_mo: [
        'bu_no', 'mo_no', 'so_nbr', 'xitems', 'item_name', 'customer_name',
        'plan_qty', 'completed_qty', 'scrap_qty', 'start_date', 'due_date',
        'actual_start_date', 'actual_end_date', 'mo_status', 'priority', 'remark',
    ],
    ermm_erp_mo_component: [
        'bu_no', 'mo_no', 'line_no', 'component_item', 'component_name', 'unit',
        'req_qty', 'issued_qty', 'warehouse', 'unit_price', 'amount', 'remark',
    ],
    ermm_erp_routing: [
        'bu_no', 'xitems', 'routing_no', 'op_seq', 'op_code', 'op_name',
        'work_center', 'std_time', 'setup_time', 'yield_rate', 'is_key_process', 'remark',
    ],
    ermm_erp_work_report: [
        'bu_no', 'mo_no', 'op_seq', 'wk_date', 'shift', 'operator', 'xitems', 'work_center',
        'good_qty', 'scrap_qty', 'rework_qty', 'work_hours', 'machine_hours', 'qc_type', 'remark',
    ],
    ermm_erp_documents: ['bu_no', 'doc_type', 'xitems', 'doc_name', 'doc_path', 'upload_user', 'remark'],
};

function orderedFields(t) {
    const order = FIELD_ORDER[t.table];
    if (!order) return t.fields.slice();
    const pos = new Map(order.map((name, i) => [name, i]));
    return t.fields
        .map((f, i) => ({ f, p: pos.has(f.en) ? pos.get(f.en) : order.length + i }))
        .sort((a, b) => a.p - b.p)
        .map(x => x.f);
}

function styleHeader(row, fill) {
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD5D8DC' } },
            left: { style: 'thin', color: { argb: 'FFD5D8DC' } },
            bottom: { style: 'thin', color: { argb: 'FFD5D8DC' } },
            right: { style: 'thin', color: { argb: 'FFD5D8DC' } },
        };
    });
    row.height = 32;
}

function buildReadme(wb) {
    const ws = wb.addWorksheet('00_使用说明', { properties: { tabColor: { argb: 'FF1A5276' } } });
    ws.columns = [
        { width: 6 }, { width: 12 }, { width: 30 }, { width: 26 }, { width: 14 }, { width: 70 },
    ];

    const title = ws.getCell('A1');
    title.value = 'ERMM — 第三方 ERP 资料导入模板（接单 / 采购 / 制造）';
    title.font = { bold: true, size: 18, color: { argb: 'FF1A5276' } };
    title.alignment = { vertical: 'middle' };
    ws.mergeCells('A1:F1');
    ws.getRow(1).height = 34;

    const section = (text) => {
        const r = ws.addRow([text]);
        ws.mergeCells(`A${r.number}:F${r.number}`);
        r.font = { bold: true, size: 12, color: { argb: 'FF1A5276' } };
        r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF5FB' } };
        r.height = 22;
        return r;
    };
    const line = (text) => {
        const r = ws.addRow(['', text]);
        ws.mergeCells(`B${r.number}:F${r.number}`);
        r.alignment = { vertical: 'top', wrapText: true };
        r.height = 20;
        return r;
    };

    ws.addRow(['版本', 'v1.0（含新增 4 张制造表）']);
    ws.addRow(['生成日期', '2026-10-25']);
    ws.addRow(['适用系统', 'ERMM 财务模块 / MySQL 8']);
    ws.addRow([]);

    section('【一、文件结构】');
    line('00_使用说明：本页，资料表清单、导入顺序、格式规范、去重键。');
    line('01_栏位总览：全部资料表与栏位（中英文、类型、必填、说明），供核对。');
    line('其余 Sheet：每张资料表一个工作表，Sheet 名称 = 资料表英文名。');
    line('每个资料表 Sheet 第 1 行为「中文名称 + 英文栏位名」，带 * 为必填；请勿修改第 1 行。');
    line('第 2~3 行为灰色示例数据，正式填报前请删除；第 4 行起填写正式资料。');
    ws.addRow([]);

    section('【二、资料表清单】');
    const hdr = ws.addRow(['序号', '业务域', '资料表（英文）', '中文名称', '第三方填写', '说明']);
    styleHeader(hdr, 'FF2C3E50');
    const TABLE_NOTE = {
        relation_detail: '前置主档，必须先建',
        cams_system_codes: '前置参数：币别与汇率',
        ermm_erp_so: '接单明细',
        ermm_erp_so_dn: '交货单，关联 SO',
        ermm_temp_po: '采购订单唯一入口',
        transit_price: '在途资料（可选）',
        e2_xitems_daily_status: '库存资料（可选）',
        mgm_production_details: '生产明细',
        ermm_erp_mo: '新增：制造工单主档',
        ermm_erp_mo_component: '新增：工单用料明细',
        ermm_erp_routing: '新增：工艺路线/工序',
        ermm_erp_work_report: '新增：报工/产出记录',
        ermm_erp_documents: '附件元数据（可选）',
    };
    TABLES.forEach((t, i) => {
        const r = ws.addRow([i + 1, t.domain, t.table, t.cn, '是', TABLE_NOTE[t.table] || t.desc]);
        r.alignment = { vertical: 'middle', wrapText: true };
        r.height = 20;
        if (i % 2 === 1) {
            r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9F9' } }; });
        }
    });
    ws.addRow([]);

    section('【三、导入顺序】');
    [
        '1. relation_detail（客户 / 供应商主档）',
        '2. cams_system_codes（CURRENCY 币别汇率）',
        '3. ermm_erp_so（接单）→ ermm_erp_so_dn（交货）',
        '4. ermm_temp_po（采购订单）',
        '5. transit_price（在途）/ e2_xitems_daily_status（库存），可选',
        '6. mgm_production_details（生产明细）',
        '7. ermm_erp_mo（工单）→ ermm_erp_mo_component（用料）→ ermm_erp_routing（工艺）→ ermm_erp_work_report（报工）',
        '8. ermm_erp_documents（附件），可选',
        '9. 导入完成后，由系统执行批次管线（Step1~Step7）重算',
    ].forEach(x => line(x));
    ws.addRow([]);

    section('【四、去重键（同一键重复导入会覆盖）】');
    TABLES.forEach(t => line(`${t.table}：${t.dedupe}`));
    ws.addRow([]);

    section('【五、编码与格式规范】');
    [
        '文件格式：.xlsx（UTF-8）；一个 Sheet 对应一张表，Sheet 名称不要改。',
        '表头：第 1 行请勿修改；英文栏位名为导入程序识别依据。',
        '公司别 bu_no：只能填 HM / HN / SZ。',
        '日期：YYYY-MM-DD；空值留白，不要填 0 或 0000-00-00。',
        '数量 4 位小数、单价/汇率 6 位小数、金额 2 位小数；不加千分位和货币符号。',
        '百分比：填数字，如 13 表示 13%。',
        '订单号、物料号请设为文本格式，避免 Excel 转科学计数法或丢失前导零。',
        '一行一笔明细：同一订单多个物料必须拆成多行，单号重复、物料行唯一。',
        '状态值：按模板示例填写，不要自行改成英文代码。',
        '同一批次建议使用同一个 batch_id（采购）或同一月份（接单/制造）。',
    ].forEach(x => line(x));
    ws.addRow([]);

    section('【六、系统自动生成、第三方不需填写的表】');
    SYSTEM_TABLES.forEach(([t, cn, note]) => line(`${t}（${cn}）：${note}`));
    ws.addRow([]);

    section('【七、新增的 4 张制造表】');
    [
        'ermm_erp_mo：制造工单主档，一行一张工单，mo_no 唯一。',
        'ermm_erp_mo_component：工单用料明细，每张工单可有多行，line_no 区分。',
        'ermm_erp_routing：产品工艺路线，同一产品可有多版本、多工序，op_seq 区分。',
        'ermm_erp_work_report：报工/产出记录，按工单 + 工序 + 日期 + 班次 + 作业员记录。',
        '关联关系：工单 mo_no 关联用料与报工；产品 xitems 关联工艺路线；工单可关联销售订单 so_nbr。',
    ].forEach(x => line(x));
    ws.addRow([]);

    section('【八、备注】');
    line('灰色示例行仅用于说明填写格式，正式提交前请全部删除。');
    line('附件文件本体（合约、图纸等）请与 Excel 分开提供，本表只填文件路径与文件名。');
    line('如栏位或业务口径有疑问，请先确认后再批量填报，避免导入后返工。');

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
}

function buildOverview(wb) {
    const ws = wb.addWorksheet('01_栏位总览', { properties: { tabColor: { argb: 'FF8E44AD' } } });
    ws.columns = [
        { width: 10 }, { width: 30 }, { width: 22 }, { width: 24 },
        { width: 20 }, { width: 10 }, { width: 8 }, { width: 60 },
    ];
    const hdr = ws.addRow(['业务域', '资料表（英文）', '中文名称', '栏位（英文）', '栏位（中文）', '类型', '必填', '说明 / 示例']);
    styleHeader(hdr, 'FF2C3E50');

    TABLES.forEach(t => {
        orderedFields(t).forEach(f => {
            const r = ws.addRow([
                t.domain, t.table, t.cn, f.en, f.cn, f.type,
                f.req ? '是' : '否',
                `${f.note}${f.ex !== '' && f.ex !== undefined ? `；示例：${f.ex}` : ''}`,
            ]);
            r.alignment = { vertical: 'middle', wrapText: true };
            r.height = 20;
        });
    });

    ws.autoFilter = { from: 'A1', to: 'H1' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
}

function buildDataSheet(wb, t) {
    const ws = wb.addWorksheet(t.sheet, { properties: { tabColor: { argb: t.fill } } });
    const fields = orderedFields(t);
    const srcIndex = new Map(t.fields.map((f, i) => [f.en, i]));

    // 第 1 行：中文名 + 英文栏位名
    const headers = fields.map(f => `${f.cn}${f.req ? ' *' : ''} ${f.en}`);
    const row = ws.addRow(headers);
    styleHeader(row, t.fill);

    // 栏位说明写入单元格批注
    fields.forEach((f, i) => {
        const cell = ws.getCell(1, i + 1);
        cell.note = [
            `栏位：${f.en}`,
            `中文：${f.cn}`,
            `类型：${f.type}`,
            `必填：${f.req ? '是' : '否'}`,
            `说明：${f.note}`,
            `示例：${f.ex === '' ? '（空）' : f.ex}`,
        ].join('\n');
        const col = ws.getColumn(i + 1);
        col.width = Math.min(34, Math.max(12, f.cn.length * 2 + 2, f.en.length + 4));
        col.style = { numFmt: NUM_FMT[f.type] || '@' };
        col.alignment = { vertical: 'middle', wrapText: true };
    });

    // 第 2~3 行：灰色示例（依新栏位顺序重排示例值）
    (t.samples || []).forEach(sample => {
        const orderedSample = fields.map(f => sample[srcIndex.get(f.en)]);
        const r = ws.addRow(orderedSample);
        r.eachCell(cell => {
            cell.font = { italic: true, color: { argb: 'FF808080' }, size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
            cell.alignment = { vertical: 'middle' };
            cell.border = {
                top: { style: 'hair', color: { argb: 'FFD5D8DC' } },
                left: { style: 'hair', color: { argb: 'FFD5D8DC' } },
                bottom: { style: 'hair', color: { argb: 'FFD5D8DC' } },
                right: { style: 'hair', color: { argb: 'FFD5D8DC' } },
            };
        });
        r.height = 20;
    });

    // 公司别下拉（仅当 A 栏为 bu_no）
    if (fields[0] && fields[0].en === 'bu_no') {
        ws.dataValidations.add('A2:A1000', {
            type: 'list',
            allowBlank: false,
            formulae: ['"HM,HN,SZ"'],
            showErrorMessage: true,
            errorTitle: '公司别错误',
            error: '只能填写 HM / HN / SZ',
            showInputMessage: true,
            promptTitle: '公司别',
            prompt: 'HM / HN / SZ',
        });
    }

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: ws.getCell(1, fields.length).address };
    return ws;
}

async function main() {
    // 校验栏位顺序覆盖完整，避免漏栏位或写错名称
    for (const t of TABLES) {
        const names = new Set(t.fields.map(f => f.en));
        const order = FIELD_ORDER[t.table] || [];
        const missing = t.fields.filter(f => !order.includes(f.en)).map(f => f.en);
        const extra = order.filter(n => !names.has(n));
        if (missing.length || extra.length) {
            throw new Error(`${t.table} 栏位顺序不完整：缺少 [${missing.join(',')}]；多余 [${extra.join(',')}]`);
        }
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERMM Finance Module';
    wb.created = new Date();
    wb.properties.date = new Date();

    buildReadme(wb);
    buildOverview(wb);
    TABLES.forEach(t => buildDataSheet(wb, t));

    if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });

    // 目标文件被 Excel 占用时，改为输出带时间戳的新文件
    let outPath = OUT;
    try {
        await wb.xlsx.writeFile(outPath);
    } catch (e) {
        if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
        outPath = OUT.replace(/\.xlsx$/i, `_${stamp}.xlsx`);
        await wb.xlsx.writeFile(outPath);
        console.warn(`原模板被占用（请在 Excel 中关闭），已另存为: ${outPath}`);
    }

    const size = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`模板已生成: ${outPath}`);
    console.log(`Sheet 数: ${wb.worksheets.length}（含使用说明、栏位总览）`);
    console.log(`资料表数: ${TABLES.length}`);
    console.log(`文件大小: ${size} KB`);
}

main().catch(err => { console.error(err); process.exit(1); });
