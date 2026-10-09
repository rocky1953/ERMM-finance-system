/**
 * 整合模組端到端驗證（一次性腳本）
 * 建立 intg_demo_src / intg_demo_tgt 兩張測試表，
 * 走「資料源→SQL 作業→UPSERT 二次執行」與「Excel 產生→解析→匯入」完整鏈路。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const integ = require('../services/dataIntegrator');

async function main() {
    // 1) 測試表
    await pool.query(`CREATE TABLE IF NOT EXISTS intg_demo_src (
        id INT PRIMARY KEY, cust_name VARCHAR(100), amt DECIMAL(12,2), src_tag VARCHAR(20)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS intg_demo_tgt (
        id INT PRIMARY KEY, cust_name VARCHAR(100), amt DECIMAL(12,2), via VARCHAR(20)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query('TRUNCATE TABLE intg_demo_src');
    await pool.query('TRUNCATE TABLE intg_demo_tgt');
    await pool.query(`INSERT INTO intg_demo_src (id,cust_name,amt,src_tag) VALUES
        (1,'甲公司',1000.5,'SQL'),(2,'乙公司',2345,'SQL'),(3,'丙公司',0.01,'SQL')`);
    console.log('✅ 測試表與來源資料就緒');

    // 2) 資料源（指向本機自身 ERMM_db 模擬第三方）
    const [ex] = await pool.query('SELECT id FROM intg_source WHERE name=?', ['DEMO_SELF']);
    let sourceId;
    const srcBody = {
        name: 'DEMO_SELF', db_type: 'mysql',
        host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
        db_name: process.env.DB_NAME || 'ERMM_db', db_user: process.env.DB_USER || 'root',
        db_password: process.env.DB_PASSWORD || '', charset: 'utf8mb4',
    };
    if (ex.length) {
        sourceId = ex[0].id;
        await pool.query('UPDATE intg_source SET host=?,port=?,db_name=?,db_user=?,db_password=?,charset=?,enabled=1 WHERE id=?',
            [srcBody.host, srcBody.port, srcBody.db_name, srcBody.db_user, srcBody.db_password, srcBody.charset, sourceId]);
    } else {
        const [r] = await pool.query(
            `INSERT INTO intg_source (name,db_type,host,port,db_name,db_user,db_password,charset,enabled,created_by)
             VALUES (?,?,?,?,?,?,?,?,1,'E2E')`,
            [srcBody.name, srcBody.db_type, srcBody.host, srcBody.port, srcBody.db_name, srcBody.db_user, srcBody.db_password, srcBody.charset]);
        sourceId = r.insertId;
    }
    const test = await integ.testSource({ id: sourceId, ...srcBody });
    console.log('✅ 第三方連線測試:', test);

    // 3) SQL 預覽
    const rows = await integ.querySource({ id: sourceId, ...srcBody },
        'SELECT id, cust_name, amt FROM intg_demo_src ORDER BY id', 50);
    console.log('✅ SQL 預覽列數:', rows.length, '首行:', rows[0]);

    // 4) 建立 UPSERT 作業並執行第一次（應 3 新增）
    const [jobs] = await pool.query('SELECT id FROM intg_job WHERE name=?', ['DEMO_JOB']);
    let jobId;
    const jobBody = {
        name: 'DEMO_JOB', channel: 'SQL', source_id: sourceId,
        source_sql: 'SELECT id, cust_name, amt FROM intg_demo_src ORDER BY id',
        target_table: 'intg_demo_tgt',
        column_mapping: JSON.stringify({ id: 'id', cust_name: 'cust_name', amt: 'amt' }),
        key_columns: 'id', write_mode: 'UPSERT', mode: 'ONLINE', schedule: null, enabled: 0,
    };
    if (jobs.length) {
        jobId = jobs[0].id;
        await pool.query(`UPDATE intg_job SET source_id=?,source_sql=?,target_table=?,column_mapping=?,key_columns=?,write_mode=?,mode=?,enabled=0 WHERE id=?`,
            [jobBody.source_id, jobBody.source_sql, jobBody.target_table, jobBody.column_mapping, jobBody.key_columns, jobBody.write_mode, jobBody.mode, jobId]);
    } else {
        const [r] = await pool.query(
            `INSERT INTO intg_job (name,channel,source_id,source_sql,target_table,column_mapping,key_columns,write_mode,mode,enabled,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,0,'E2E')`,
            [jobBody.name, jobBody.channel, jobBody.source_id, jobBody.source_sql, jobBody.target_table, jobBody.column_mapping, jobBody.key_columns, jobBody.write_mode, jobBody.mode]);
        jobId = r.insertId;
    }
    const r1 = await integ.runJob(jobId, { runType: 'MANUAL', triggeredBy: 'E2E' });
    console.log('▶ 第一次執行:', r1);

    // 改來源金額 + 新增一列，再跑（應 1 新增 3 更新）
    await pool.query(`INSERT INTO intg_demo_src VALUES (4,'丁公司',999,'SQL') ON DUPLICATE KEY UPDATE cust_name=VALUES(cust_name),amt=VALUES(amt)`);
    await pool.query(`UPDATE intg_demo_src SET amt=1111.11 WHERE id=1`);
    const r2 = await integ.runJob(jobId, { runType: 'MANUAL', triggeredBy: 'E2E' });
    console.log('▶ 第二次執行:', r2);
    const [tgt] = await pool.query('SELECT * FROM intg_demo_tgt ORDER BY id');
    console.log('✅ 目標表內容:', tgt);

    // 5) Excel 產生 → 解析 → 匯入（經由 HTTP 較麻煩，直接調引擎；Excel 緩衝由 ExcelJS 生成）
    await pool.query('TRUNCATE TABLE intg_demo_tgt');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('客戶');
    ws.addRow(['id', 'cust_name', 'amt']);
    ws.addRow([10, '戊公司', 5000]);
    ws.addRow([11, '己公司', 6000.75]);
    ws.addRow([12, '', 7000]);  // 空字串應轉 null
    const buf = await wb.xlsx.writeBuffer();

    // 模擬路由 parseSheetRows：直接用 ExcelJS 重讀 buffer
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(Buffer.from(buf));
    const ws2 = wb2.getWorksheet('客戶');
    const xlRows = [];
    let header = [];
    ws2.eachRow((row, idx) => {
        const vals = [];
        row.eachCell({ includeEmpty: true }, (c, col) => { vals[col - 1] = c.value; });
        if (idx === 1) header = vals.map(v => String(v ?? '').trim());
        else {
            const o = {}; header.forEach((h, i) => { o[h] = vals[i] ?? ''; });
            xlRows.push(o);
        }
    });
    console.log('✅ Excel 解析列數:', xlRows.length, xlRows);
    const r3 = await integ.importRows(xlRows, {
        targetTable: 'intg_demo_tgt',
        mapping: { id: 'id', cust_name: 'cust_name', amt: 'amt' },
        keyColumns: ['id'], writeMode: 'INSERT',
        fileName: 'demo.xlsx', triggeredBy: 'E2E',
    });
    console.log('▶ Excel 匯入:', r3);
    const [tgt2] = await pool.query('SELECT * FROM intg_demo_tgt ORDER BY id');
    console.log('✅ Excel 匯入後目標表:', tgt2);

    // 6) 日誌
    const [logs] = await pool.query('SELECT id,job_name,channel,run_type,total_rows,insert_rows,update_rows,error_rows,status,duration_ms FROM intg_log ORDER BY id DESC LIMIT 6');
    console.log('✅ 最近日誌:', logs);

    const pass = r1.insert_rows === 3 && r2.insert_rows === 1 && r2.update_rows === 3
        && r3.insert_rows === 3 && r3.error_rows === 0
        && Number(tgt.find(x => x.id === 1).amt) === 1111.11
        && tgt2.find(x => x.id === 12).cust_name === null;
    console.log(pass ? '\n🎉 E2E 全部通過' : '\n❌ E2E 有失敗項');
    process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
