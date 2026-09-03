/**
 * 批次管線頁面
 */
registerPage('batch', async (c) => {
    const steps = [
        { id: 1, name: t('batch.step1') },
        { id: 2, name: t('batch.step2') },
        { id: 3, name: t('batch.step3') },
        { id: 4, name: t('batch.step4') },
        { id: 5, name: t('batch.step5') },
        { id: 6, name: t('batch.step6') },
        { id: 7, name: t('batch.step7') }
    ];
    c.innerHTML = `
        <div class="card">
            <div class="card-title">${t('batch.title')}</div>
            <div class="step-progress">
                ${steps.map(s => `<div class="step-item" id="step${s.id}">
                    <div class="step-circle">${s.id}</div>
                    <div class="step-label">${s.name}</div>
                </div>`).join('')}
            </div>
            <div class="toolbar">
                <button class="btn btn-success" onclick="runAllBatch()">🚀 ${t('batch.run_all')}</button>
                <button class="btn btn-primary" onclick="runStep(1)">${t('batch.run_step')}</button>
                <div class="spacer"></div>
                <label style="font-size:0.85em;color:#7f8c8d">${t('topbar.month')}</label>
                <input type="month" id="batchMonth" value="${State.YYYY_MM.replace('/','-')}" style="padding:6px;border:1px solid #ddd;border-radius:6px;">
            </div>
            <div id="batchLog" style="background:#1e1e1e;color:#0f0;padding:15px;border-radius:8px;font-family:Consolas,monospace;font-size:0.85em;max-height:400px;overflow-y:auto;margin-top:15px;">
                <div>=== ${t('batch.log')} ===</div>
                <div>${t('batch.waiting')}</div>
            </div>
        </div>
    `;
});

function batchLog(msg, type = 'info') {
    const el = document.getElementById('batchLog');
    const colors = { info: '#0f0', success: '#27ae60', error: '#e74c3c', warn: '#f39c12' };
    const time = new Date().toLocaleTimeString();
    el.innerHTML += `<div style="color:${colors[type]}">[${time}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
}

function setStepStatus(step, status) {
    const el = document.getElementById(`step${step}`);
    if (!el) return;
    el.classList.remove('done', 'active', 'error');
    el.classList.add(status);
}

async function runStep(stepId) {
    const ym = document.getElementById('batchMonth')?.value.replace('-', '/') || State.YYYY_MM;
    batchLog(`▶ Step ${stepId}...`);
    setStepStatus(stepId, 'active');
    try {
        const res = await API.post(`/api/batch/step${stepId}`, { bu_no: State.bu_no, YYYY_MM: ym });
        batchLog(`✅ Step ${stepId}: ${res.message}`, 'success');
        setStepStatus(stepId, 'done');
        return true;
    } catch(e) {
        batchLog(`❌ Step ${stepId}: ${e.message}`, 'error');
        setStepStatus(stepId, 'error');
        return false;
    }
}

async function runAllBatch() {
    for (let i = 1; i <= 7; i++) {
        for (let j = 1; j < i; j++) setStepStatus(j, 'done');
        const ok = await runStep(i);
        if (!ok) { batchLog('⚠️ ' + t('batch.interrupted'), 'warn'); return; }
    }
    batchLog('🎉 ' + t('batch.done'), 'success');
}
