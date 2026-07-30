let version = "2026.07.30.1";
let sensorChart;

// --- Series definitions -------------------------------------------------
// Keys match the CSV headers written by LabMonitor Viewer's CSV export.
// Each series gets its own dash pattern so that, within one dataset colour,
// the individual curves stay distinguishable.
const SERIES = [
    { key: 'sens1_Temp', label: 'S1 Temp', unit: '°C', dash: [] },
    { key: 'sens2_Temp', label: 'S2 Temp', unit: '°C', dash: [6, 4] },
    { key: 'sens1_WBT',  label: 'S1 WBT',  unit: '°C', dash: [2, 3] },
    { key: 'sens1_RH',   label: 'S1 RH',   unit: '%',       dash: [9, 3, 2, 3] },
    { key: 'sens1_HI',   label: 'S1 HI',   unit: '°C', dash: [12, 4] },
    { key: 'sens2_RH',   label: 'S2 RH',   unit: '%',       dash: [10, 3, 3, 3] },
    { key: 'sens3_Temp', label: 'S3 Temp', unit: '°C', dash: [1, 4] },
    { key: 'sens3_RH',   label: 'S3 RH',   unit: '%',       dash: [4, 2, 1, 2] }
];
const SERIES_KEYS = SERIES.map(s => s.key);

// Colour-blind-friendly qualitative palette, one colour per dataset.
const PALETTE = [
    [214, 39, 40], [31, 119, 180], [44, 160, 44], [148, 103, 189],
    [255, 127, 14], [23, 190, 207], [227, 119, 194], [127, 127, 127],
    [188, 189, 34], [140, 86, 75]
];

// --- Application state --------------------------------------------------
// Every dataset keeps its samples as *elapsed seconds from its own first
// sample*, so all curves start at time zero no matter when they were taken.
// Offsets are stored in canonical units (seconds for X, data units for Y)
// and converted for display, so switching the time unit never moves a curve.
const datasets = [];   // { id, name, colorIndex, tSec[], series{}, xOffsetSec, yOffset, visible, startTime }
let activeId = null;
let datasetCounter = 0;

function unitDivisor() {
    return parseFloat(document.getElementById('xUnitSelect').value) || 1;
}

function unitLabel() {
    const sel = document.getElementById('xUnitSelect');
    return sel.options[sel.selectedIndex].textContent;
}

function unitShort() {
    const d = unitDivisor();
    return d === 1 ? 's' : (d === 60 ? 'min' : 'h');
}

function rgba(colorIndex, alpha) {
    const c = PALETTE[colorIndex % PALETTE.length];
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

function getActive() {
    return datasets.find(d => d.id === activeId) || null;
}

function selectedSeriesKeys() {
    return Array.from(document.querySelectorAll('.data-checkbox'))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.key);
}

// --- Chart Initialization ----------------------------------------------
function initChart() {
    const ctx = document.getElementById('sensorChart').getContext('2d');
    sensorChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            parsing: false,          // data is already {x, y}
            normalized: true,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Elapsed time (minutes)' }
                },
                y: {
                    title: { display: true, text: 'Value' },
                    beginAtZero: false
                }
            },
            interaction: { mode: 'nearest', intersect: false, axis: 'xy' },
            plugins: {
                tooltip: {
                    enabled: true,
                    callbacks: {
                        title: (items) => `t = ${items[0].parsed.x.toFixed(3)} ${unitShort()}`,
                        label: (item) => `${item.dataset.label}: ${item.parsed.y}`
                    }
                },
                legend: { position: 'top' },
                zoom: {
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        drag: {
                            enabled: true,
                            borderColor: 'rgba(60, 60, 60, 0.5)',
                            borderWidth: 1,
                            backgroundColor: 'rgba(60, 60, 60, 0.2)',
                            modifierKey: null
                        },
                        mode: 'xy'
                    },
                    pan: { enabled: true, mode: 'xy', modifierKey: null }
                }
            },
            animation: false
        }
    });
}

// --- CSV parsing --------------------------------------------------------
function splitCsvLine(line) {
    // Tolerant splitter: honours double quotes so a quoted comment column
    // containing commas cannot corrupt the row.
    const out = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else { field += ch; }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            out.push(field); field = '';
        } else {
            field += ch;
        }
    }
    out.push(field);
    return out;
}

function toNumberOrNull(raw) {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;   // note: 0 is kept, unlike `|| null`
}

// Parses a Viewer-exported CSV into a dataset object.
// Throws on unusable input so the caller can report the offending file.
function parseCsvText(text, fileName) {
    const clean = text.replace(/^﻿/, '');            // strip BOM
    const lines = clean.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('file contains no data rows');

    const header = splitCsvLine(lines[0]).map(h => h.trim());
    let tsCol = header.findIndex(h => h.toLowerCase() === 'timestamp');
    if (tsCol === -1) tsCol = 0;   // fall back to the first column

    // Map every known series key to its column index, when present.
    const colOf = {};
    SERIES_KEYS.forEach(key => {
        const idx = header.findIndex(h => h === key);
        if (idx !== -1) colOf[key] = idx;
    });
    if (Object.keys(colOf).length === 0) {
        throw new Error('no recognised sensor columns (expected e.g. sens1_Temp)');
    }

    const rows = [];
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i]);
        const ms = Date.parse(cells[tsCol]);
        if (!Number.isFinite(ms)) { skipped++; continue; }
        const values = {};
        SERIES_KEYS.forEach(key => {
            values[key] = (key in colOf) ? toNumberOrNull(cells[colOf[key]]) : null;
        });
        rows.push({ ms: ms, values: values });
    }
    if (rows.length === 0) throw new Error('no rows with a parsable timestamp');

    rows.sort((a, b) => a.ms - b.ms);
    const t0 = rows[0].ms;

    const ds = {
        id: ++datasetCounter,
        name: fileName,
        colorIndex: datasetCounter - 1,
        tSec: rows.map(r => (r.ms - t0) / 1000),   // starts at exactly 0
        series: {},
        xOffsetSec: 0,
        yOffset: 0,
        visible: true,
        startTime: new Date(t0),
        skippedRows: skipped
    };
    SERIES_KEYS.forEach(key => {
        ds.series[key] = rows.map(r => r.values[key]);
    });
    // Remember which series actually carry data, to keep the legend clean.
    ds.availableKeys = SERIES_KEYS.filter(k => ds.series[k].some(v => v !== null));
    return ds;
}

async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const problems = [];
    let added = 0;

    for (const file of files) {
        try {
            const text = await file.text();
            const ds = parseCsvText(text, file.name);
            datasets.push(ds);
            activeId = ds.id;
            added++;
        } catch (e) {
            problems.push(`${file.name}: ${e.message}`);
        }
    }

    if (added > 0) {
        renderDatasetList();
        syncOffsetInputs();
        rebuildChart();
        sensorChart.resetZoom();
    }
    if (problems.length > 0) {
        alert('Could not load:\n' + problems.join('\n'));
    }
}

// --- Dataset list / active selection -----------------------------------
function renderDatasetList() {
    const table = document.getElementById('datasetList');
    const select = document.getElementById('activeDatasetSelect');

    if (datasets.length === 0) {
        table.innerHTML = '<tr><td class="empty-note">No datasets loaded. Use “Load CSV…” or drop files on the plot.</td></tr>';
        select.innerHTML = '<option value="">— none —</option>';
        document.getElementById('activeLabel').textContent = 'No dataset loaded';
        setOffsetControlsEnabled(false);
        return;
    }

    let html = '<tr><th></th><th>File</th><th>Points</th><th>Duration</th><th>X off</th><th>Y off</th><th>Show</th><th></th></tr>';
    datasets.forEach(ds => {
        const dur = ds.tSec.at(-1) / unitDivisor();
        const isActive = ds.id === activeId;
        html += `<tr class="${isActive ? 'active-row' : ''}" data-id="${ds.id}">
            <td><span class="swatch" style="background:${rgba(ds.colorIndex, 1)}"></span></td>
            <td><span class="ds-name" title="${escapeHtml(ds.name)} — starts ${ds.startTime.toLocaleString()}">${escapeHtml(ds.name)}</span></td>
            <td class="ds-meta">${ds.tSec.length}</td>
            <td class="ds-meta">${dur.toFixed(2)} ${unitShort()}</td>
            <td class="ds-meta">${(ds.xOffsetSec / unitDivisor()).toFixed(3)}</td>
            <td class="ds-meta">${ds.yOffset.toFixed(3)}</td>
            <td><input type="checkbox" class="ds-visible" data-id="${ds.id}" ${ds.visible ? 'checked' : ''}></td>
            <td><button class="row-btn ds-remove" data-id="${ds.id}" title="Remove this dataset">&times;</button></td>
        </tr>`;
    });
    table.innerHTML = html;

    // Row click selects the active dataset (ignoring clicks on the controls).
    table.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.addEventListener('click', (ev) => {
            if (ev.target.closest('input, button')) return;
            setActive(parseInt(tr.dataset.id, 10));
        });
    });
    table.querySelectorAll('.ds-visible').forEach(cb => {
        cb.addEventListener('change', () => {
            const ds = datasets.find(d => d.id === parseInt(cb.dataset.id, 10));
            if (ds) { ds.visible = cb.checked; rebuildChart(); }
        });
    });
    table.querySelectorAll('.ds-remove').forEach(btn => {
        btn.addEventListener('click', () => removeDataset(parseInt(btn.dataset.id, 10)));
    });

    select.innerHTML = datasets
        .map(ds => `<option value="${ds.id}" ${ds.id === activeId ? 'selected' : ''}>${escapeHtml(ds.name)}</option>`)
        .join('');

    const act = getActive();
    document.getElementById('activeLabel').textContent = act ? `Active: ${act.name}` : 'No dataset selected';
    setOffsetControlsEnabled(!!act);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function setOffsetControlsEnabled(enabled) {
    ['xOffsetInput', 'yOffsetInput', 'xMinusButton', 'xPlusButton',
     'yMinusButton', 'yPlusButton', 'resetOffsetsButton', 'zeroAlignButton']
        .forEach(id => { document.getElementById(id).disabled = !enabled; });
}

function setActive(id) {
    if (activeId === id) return;
    activeId = id;
    renderDatasetList();
    syncOffsetInputs();
    rebuildChart();
}

function removeDataset(id) {
    const idx = datasets.findIndex(d => d.id === id);
    if (idx === -1) return;
    datasets.splice(idx, 1);
    if (activeId === id) {
        activeId = datasets.length ? datasets[Math.min(idx, datasets.length - 1)].id : null;
    }
    renderDatasetList();
    syncOffsetInputs();
    rebuildChart();
}

function clearAll() {
    if (datasets.length === 0) return;
    datasets.length = 0;
    activeId = null;
    renderDatasetList();
    syncOffsetInputs();
    rebuildChart();
    console.log('All datasets cleared.');
}

// --- Offsets ------------------------------------------------------------
function syncOffsetInputs() {
    const ds = getActive();
    document.getElementById('xOffsetInput').value = ds ? (ds.xOffsetSec / unitDivisor()) : 0;
    document.getElementById('yOffsetInput').value = ds ? ds.yOffset : 0;
}

function applyOffsetsFromInputs() {
    const ds = getActive();
    if (!ds) return;
    const x = parseFloat(document.getElementById('xOffsetInput').value);
    const y = parseFloat(document.getElementById('yOffsetInput').value);
    ds.xOffsetSec = (Number.isFinite(x) ? x : 0) * unitDivisor();
    ds.yOffset = Number.isFinite(y) ? y : 0;
    renderDatasetList();
    rebuildChart();
}

function nudge(axis, direction) {
    const ds = getActive();
    if (!ds) return;
    if (axis === 'x') {
        const step = parseFloat(document.getElementById('xStepInput').value);
        ds.xOffsetSec += direction * (Number.isFinite(step) ? step : 0) * unitDivisor();
    } else {
        const step = parseFloat(document.getElementById('yStepInput').value);
        ds.yOffset += direction * (Number.isFinite(step) ? step : 0);
    }
    syncOffsetInputs();
    renderDatasetList();
    rebuildChart();
}

function resetOffsets() {
    const ds = getActive();
    if (!ds) return;
    ds.xOffsetSec = 0;
    ds.yOffset = 0;
    syncOffsetInputs();
    renderDatasetList();
    rebuildChart();
}

// Puts the active dataset's first plotted sample at the origin: x back to 0
// and the first valid value of the reference series shifted to y = 0.
function zeroAlign() {
    const ds = getActive();
    if (!ds) return;
    const keys = selectedSeriesKeys().filter(k => ds.availableKeys.includes(k));
    const refKey = keys[0] || ds.availableKeys[0];
    if (!refKey) return;
    const firstValue = ds.series[refKey].find(v => v !== null);
    ds.xOffsetSec = 0;
    ds.yOffset = Number.isFinite(firstValue) ? -firstValue : 0;
    syncOffsetInputs();
    renderDatasetList();
    rebuildChart();
}

// --- Plotting -----------------------------------------------------------
function seriesPoints(ds, key) {
    const div = unitDivisor();
    const t = ds.tSec;
    const vals = ds.series[key];
    const pts = [];
    for (let i = 0; i < t.length; i++) {
        if (vals[i] === null) continue;   // gaps stay gaps
        pts.push({ x: (t[i] + ds.xOffsetSec) / div, y: vals[i] + ds.yOffset });
    }
    return pts;
}

function rebuildChart() {
    const keys = selectedSeriesKeys();
    const chartDatasets = [];

    datasets.forEach(ds => {
        if (!ds.visible) return;
        const isActive = ds.id === activeId;
        keys.forEach(key => {
            if (!ds.availableKeys.includes(key)) return;
            const meta = SERIES.find(s => s.key === key);
            chartDatasets.push({
                label: `${ds.name} · ${meta.label}`,
                data: seriesPoints(ds, key),
                borderColor: rgba(ds.colorIndex, isActive ? 1 : 0.45),
                backgroundColor: rgba(ds.colorIndex, isActive ? 1 : 0.45),
                borderDash: meta.dash,
                borderWidth: isActive ? 2.5 : 1.5,
                pointRadius: isActive ? 2 : 1,
                fill: false,
                tension: 0.1,
                spanGaps: true,
                order: isActive ? 0 : 1,
                _dsId: ds.id,
                _key: key
            });
        });
    });

    sensorChart.data.datasets = chartDatasets;
    sensorChart.options.scales.x.title.text = `Elapsed time (${unitLabel()})`;
    sensorChart.update();
}

// Rescales the x-axis view (and offset inputs) when the time unit changes,
// so the visible window keeps showing the same data.
function changeXUnit(previousDivisor) {
    const div = unitDivisor();
    const x = sensorChart.options.scales.x;
    const factor = previousDivisor / div;
    if (Number.isFinite(x.min)) x.min = x.min * factor;
    if (Number.isFinite(x.max)) x.max = x.max * factor;
    syncOffsetInputs();
    renderDatasetList();
    rebuildChart();
}

// --- Export -------------------------------------------------------------
// When "Full data" is unchecked only the visible x window is exported,
// mirroring the Viewer's behaviour.
function visibleXRange() {
    const full = document.getElementById('fullDataCheckbox').checked;
    if (full) return { min: -Infinity, max: Infinity, full: true };
    const x = sensorChart.scales.x;
    if (!x) return { min: -Infinity, max: Infinity, full: true };
    return { min: x.min, max: x.max, full: false };
}

function exportToPng() {
    sensorChart.options.plugins.title = { display: true, text: 'LabMonitor Analyzer' };
    sensorChart.update('none');

    // Composite onto white; the chart canvas itself is transparent.
    const src = sensorChart.canvas;
    const tmp = document.createElement('canvas');
    tmp.width = src.width;
    tmp.height = src.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = 'white';
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(src, 0, 0);

    const link = document.createElement('a');
    link.href = tmp.toDataURL('image/png');
    link.download = new Date().toISOString() + '_analyzer-plot.png';
    link.click();

    sensorChart.options.plugins.title = { display: false };
    sensorChart.update('none');
}

// Datasets rarely share a sampling grid, so the combined CSV writes one
// block of columns per dataset side by side instead of interpolating.
function buildCombinedCsv() {
    const keys = selectedSeriesKeys();
    const range = visibleXRange();
    const div = unitDivisor();
    const active = datasets.filter(ds => ds.visible);

    if (active.length === 0 || keys.length === 0) return null;

    const blocks = [];
    active.forEach(ds => {
        const cols = keys.filter(k => ds.availableKeys.includes(k));
        if (cols.length === 0) return;
        const rows = [];
        for (let i = 0; i < ds.tSec.length; i++) {
            const x = (ds.tSec[i] + ds.xOffsetSec) / div;
            if (x < range.min || x > range.max) continue;
            rows.push([x].concat(cols.map(k => {
                const v = ds.series[k][i];
                return v === null ? '' : (v + ds.yOffset);
            })));
        }
        blocks.push({ ds: ds, cols: cols, rows: rows });
    });

    const nonEmpty = blocks.filter(b => b.rows.length > 0);
    if (nonEmpty.length === 0) return null;

    const header = [];
    nonEmpty.forEach(b => {
        header.push(`${b.ds.name} time_${unitShort()}`);
        b.cols.forEach(k => header.push(`${b.ds.name} ${k}`));
    });

    const maxRows = Math.max(...nonEmpty.map(b => b.rows.length));
    const lines = [header.join(',')];
    for (let r = 0; r < maxRows; r++) {
        const cells = [];
        nonEmpty.forEach(b => {
            const row = b.rows[r];
            if (row) cells.push(...row);
            else cells.push(...new Array(b.cols.length + 1).fill(''));
        });
        lines.push(cells.join(','));
    }
    return { text: lines.join('\n') + '\n', blocks: nonEmpty, full: range.full };
}

function exportToCsv() {
    if (datasets.length === 0) {
        alert('No data to export. Load a CSV first.');
        return;
    }
    const result = buildCombinedCsv();
    if (!result) {
        alert('Nothing to export.\nCheck that a series is selected and that data falls inside the visible range,\nor tick "Full data".');
        return;
    }
    const total = result.blocks.reduce((n, b) => n + b.rows.length, 0);
    console.log(`Exporting ${total} rows from ${result.blocks.length} dataset(s) (${result.full ? 'full data' : 'visible range'}).`);

    const blob = new Blob([result.text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = new Date().toISOString() + '_analyzer-data.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// --- Pan / zoom ---------------------------------------------------------
function toggleZoomMode() {
    const isPanEnabled = sensorChart.options.plugins.zoom.pan.enabled;
    sensorChart.options.plugins.zoom.pan.enabled = !isPanEnabled;
    sensorChart.options.plugins.zoom.zoom.drag.enabled = isPanEnabled;

    const canvas = document.getElementById('sensorChart');
    const zoomButton = document.getElementById('zoomButton');

    if (sensorChart.options.plugins.zoom.zoom.drag.enabled) {
        zoomButton.textContent = 'Zoom (Click to Pan)';
        zoomButton.style.backgroundColor = '#006400';
        zoomButton.style.borderColor = '#006400';
        canvas.style.cursor = 'crosshair';
    } else {
        zoomButton.textContent = 'Pan (Click to Zoom)';
        zoomButton.style.backgroundColor = '#155084';
        zoomButton.style.borderColor = '#155084';
        canvas.style.cursor = 'move';
    }
    sensorChart.update('none');
}

function resetZoom() {
    sensorChart.options.scales.x.min = undefined;
    sensorChart.options.scales.x.max = undefined;
    sensorChart.resetZoom();
    console.log('Zoom reset.');
}

// --- Page Load Event ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('version').textContent = version;

    const fileInput = document.getElementById('fileInput');
    const chartContainer = document.getElementById('chartContainer');
    const xUnitSelect = document.getElementById('xUnitSelect');

    initChart();
    toggleZoomMode();          // initialise button label/state
    renderDatasetList();

    // --- Loading files ---
    document.getElementById('loadCsvButton').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        handleFiles(fileInput.files);
        fileInput.value = '';   // allow re-loading the same file
    });

    ['dragenter', 'dragover'].forEach(ev => {
        chartContainer.addEventListener(ev, e => {
            e.preventDefault();
            chartContainer.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach(ev => {
        chartContainer.addEventListener(ev, () => chartContainer.classList.remove('dragover'));
    });
    chartContainer.addEventListener('drop', e => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    });

    // --- Dataset selection ---
    document.getElementById('activeDatasetSelect').addEventListener('change', function () {
        setActive(parseInt(this.value, 10));
    });
    document.getElementById('clearButton').addEventListener('click', clearAll);

    // --- Offsets ---
    document.getElementById('xOffsetInput').addEventListener('change', applyOffsetsFromInputs);
    document.getElementById('yOffsetInput').addEventListener('change', applyOffsetsFromInputs);
    document.getElementById('xMinusButton').addEventListener('click', () => nudge('x', -1));
    document.getElementById('xPlusButton').addEventListener('click', () => nudge('x', +1));
    document.getElementById('yMinusButton').addEventListener('click', () => nudge('y', -1));
    document.getElementById('yPlusButton').addEventListener('click', () => nudge('y', +1));
    document.getElementById('resetOffsetsButton').addEventListener('click', resetOffsets);
    document.getElementById('zeroAlignButton').addEventListener('click', zeroAlign);

    // Arrow keys nudge the active dataset while the plot has focus.
    chartContainer.addEventListener('keydown', e => {
        const map = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowDown: ['y', -1], ArrowUp: ['y', 1] };
        const action = map[e.key];
        if (!action || !getActive()) return;
        e.preventDefault();
        nudge(action[0], action[1]);
    });

    // --- Axis unit ---
    let previousDivisor = unitDivisor();
    xUnitSelect.addEventListener('change', () => {
        changeXUnit(previousDivisor);
        previousDivisor = unitDivisor();
    });

    // --- View + export ---
    document.getElementById('zoomButton').addEventListener('click', toggleZoomMode);
    document.getElementById('resetZoomButton').addEventListener('click', resetZoom);
    document.getElementById('savePngButton').addEventListener('click', exportToPng);
    document.getElementById('saveCsvButton').addEventListener('click', exportToCsv);

    // --- Series selection ---
    document.querySelectorAll('.data-checkbox').forEach(cb => {
        cb.addEventListener('change', rebuildChart);
    });
});
