/**
 * ERMM 財務模組 - Express 後端主入口
 * Node.js + Express + MySQL2
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { testConnection } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 請求日誌
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} → ${res.statusCode} (${ms}ms)`);
    });
    next();
});

// ======= 路由引入 =======
const systemRoutes = require('./routes/system');
const arapRoutes = require('./routes/arap');
const invoiceRoutes = require('./routes/invoice');
const cashRoutes = require('./routes/cash');
const bankRoutes = require('./routes/bank');
const payRoutes = require('./routes/pay');
const checkRoutes = require('./routes/check');
const summaryRoutes = require('./routes/summary');
const batchRoutes = require('./routes/batch');
const reportRoutes = require('./routes/report');
const riskRoutes = require('./routes/risk');
const forecastRoutes = require('./routes/forecast');
const poRoutes = require('./routes/po');
const soRoutes = require('./routes/so');
const kpiRoutes = require('./routes/kpi');
const branchRoutes = require('./routes/branch');
const relationRoutes = require('./routes/relation');
const monthlyRoutes = require('./routes/monthly');
const accountRoutes = require('./routes/account');
const batchCtrlRoutes = require('./routes/batchCtrl');
const dnRoutes = require('./routes/dn');
const userRoutes = require('./routes/user');
const tempPoRoutes = require('./routes/tempPo');
const xitemsRoutes = require('./routes/xitems');
const kpiQueryRoutes = require('./routes/kpiQuery');

// ======= 路由註冊 =======
app.use('/api/system', systemRoutes);
app.use('/api/arap', arapRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/cash', cashRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/pay', payRoutes);
app.use('/api/check', checkRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/risk', riskRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/po', poRoutes);
app.use('/api/so', soRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/branch', branchRoutes);
app.use('/api/relation', relationRoutes);
app.use('/api/monthly', monthlyRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/batch-ctrl', batchCtrlRoutes);
app.use('/api/dn', dnRoutes);
app.use('/api/user', userRoutes);
app.use('/api/temp-po', tempPoRoutes);
app.use('/api/xitems', xitemsRoutes);
app.use('/api/kpi-query', kpiQueryRoutes);

// ======= API 健康檢查 =======
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        service: 'ERMM Finance Module',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            system: '/api/system/*',
            arap: '/api/arap/*',
            invoice: '/api/invoice/*',
            cash: '/api/cash/*',
            bank: '/api/bank/*',
            pay: '/api/pay/*',
            check: '/api/check/*',
            summary: '/api/summary/*',
            batch: '/api/batch/*',
            report: '/api/report/*',
            risk: '/api/risk/*',
            forecast: '/api/forecast/*'
        }
    });
});

// ======= 靜態頁面 (前端 SPA) =======
// 關閉 JS / HTML / CSS 快取（開發期，避免瀏覽器吃舊版）
app.use((req, res, next) => {
    if (req.url.match(/\.(html|js|css)(\?|$)/)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false }));

// 根路徑 → 前端首頁
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ======= 錯誤處理 =======
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        timestamp: new Date().toISOString()
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.url}`
    });
});

// ======= 啟動 =======
async function start() {
    const ok = await testConnection();
    if (!ok) {
        console.error('❌ 資料庫連線失敗，服務未啟動');
        process.exit(1);
    }
    app.listen(PORT, () => {
        console.log(`\n🚀 ERMM 財務模組 API 已啟動: http://localhost:${PORT}`);
        console.log(`📖 API 文件: http://localhost:${PORT}/api/health`);
    });
}

// 只在直接執行時啟動 (測試時 require 不會觸發)
if (require.main === module) {
    start();
}

module.exports = app;
