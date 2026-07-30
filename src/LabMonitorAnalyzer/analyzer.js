let version = "2026.07.30.2";
let sensorChart;

// --- Series definitions -------------------------------------------------
// Keys match the CSV headers written by LabMonitor Viewer's CSV export.
// Curves of one dataset share a colour family: the dataset base colour is
// shifted slightly in hue and lightness per series, so a dataset stays
// recognisable at a glance while its individual curves remain separable.
const SERIES = [
    { key: 'sens1_Temp', label: 'S1 Temp', unit: '\u00B0C', dHue:   0, dLight:   0 },
    { key: 'sens2_Temp', label: 'S2 Temp', unit: '\u00B0C', dHue:  16, dLight: -14 },
    { key: 'sens1_WBT',  label: 'S1 WBT',  unit: '\u00B0C', dHue: -16, dLight:  14 },
    { key: 'sens1_RH',   label: 'S1 RH',   unit: '%',       dHue:  30, dLight:  -6 },
    { key: 'sens1_HI',   label: 'S1 HI',   unit: '\u00B0C', dHue: -30, dLight:   6 },
    { key: 'sens2_RH',   label: 'S2 RH',   unit: '%',       dHue:  44, dLight:  22 },
    { key: 'sens3_Temp', label: 'S3 Temp', unit: '\u00B0C', dHue: -44, dLight: -24 },
    { key: 'sens3_RH',   label: 'S3 RH',   unit: '%',       dHue:  58, dLight:  10 }
];
const SERIES_KEYS = SERIES.map(s => s.key);

// One base colour per dataset (colour-blind-friendly qualitative palette).
const PALETTE = ['#d62728', '#1f77b4', '#2ca02c', '#9467bd', '#ff7f0e',
                 '#17becf', '#e377c2', '#7f7f7f', '#bcbd22', '#8c564b'];

const DEFAULT_WIDTH = 2;
const DEFAULT_POINT = 2;

// --- Application state --------------------------------------------------
// Every dataset keeps its samples as *elapsed seconds from its own first
// sample*, so all curves start at time zero no matter when they were taken.
// Offsets are stored in canonical units (seconds for X, data units for Y)
// and converted for display, so switching the time unit never moves a curve.
// `raw` holds the untouched parse result so a crop is always reversible.
const datasets = [];
let activeId = null;
let datasetCounter = 0;
let zoomModeDrag = true;   // true = box-zoom on drag, false = pan on drag

// Pan/zoom is meaningless with an empty chart: scrolling the page with the
// cursor over the canvas would otherwise wheel-zoom the blank axes and leave
// the plot showing an arbitrary fractional range.
function applyZoomAvailability(hasData) {
    const z = sensorChart.options.plugins.zoom;
    z.zoom.wheel.enabled = hasData;
    z.zoom.pinch.enabled = hasData;
    z.zoom.drag.enabled = hasData && zoomModeDrag;
    z.pan.enabled = hasData && !zoomModeDrag;
}

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

function getActive() {
    return datasets.find(d => d.id === activeId) || null;
}

function selectedSeriesKeys() {
    return Array.from(document.querySelectorAll('.data-checkbox'))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.key);
}

// --- Colour utilities ---------------------------------------------------
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

// Shifts a colour within its own family: small hue rotation plus a lightness
// nudge, clamped so nothing washes out to white or collapses to black.
function shiftColor(hex, dHue, dLightPercent) {
    const [r, g, b] = hexToRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    const newL = Math.max(0.22, Math.min(0.72, l + dLightPercent / 100));
    const newS = Math.max(0.25, Math.min(1, s));
    const [nr, ng, nb] = hslToRgb(h + dHue, newS, newL);
    return rgbToHex(nr, ng, nb);
}

function hexToRgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Colour a curve gets when the user has not overridden it.
function defaultCurveColor(ds, key) {
    const meta = SERIES.find(s => s.key === key);
    return shiftColor(ds.baseColor, meta.dHue, meta.dLight);
}

function curveStyle(ds, key) {
    const override = ds.styles[key] || {};
    return {
        color: override.color || defaultCurveColor(ds, key),
        width: Number.isFinite(override.width) ? override.width : DEFAULT_WIDTH,
        point: Number.isFinite(override.point) ? override.point : DEFAULT_POINT
    };
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
    const clean = text.replace(/^\uFEFF/, '');            // strip BOM
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

    const tSec = rows.map(r => (r.ms - t0) / 1000);   // starts at exactly 0
    const series = {};
    SERIES_KEYS.forEach(key => { series[key] = rows.map(r => r.values[key]); });

    const ds = {
        id: ++datasetCounter,
        name: fileName,
        label: fileName.replace(/\.csv$/i, ''),
        colorIndex: datasetCounter - 1,
        baseColor: PALETTE[(datasetCounter - 1) % PALETTE.length],
        styles: {},                 // per-series {color, width, point} overrides
        tSec: tSec,
        series: series,
        raw: { tSec: tSec.slice(), series: series, startMs: t0 },
        xOffsetSec: 0,
        yOffset: 0,
        visible: true,
        cropped: false,
        startTime: new Date(t0),    // wall-clock time of the current t = 0
        skippedRows: skipped
    };
    // Keep the raw series arrays independent of the working copies.
    ds.raw.series = {};
    SERIES_KEYS.forEach(key => { ds.raw.series[key] = series[key].slice(); });

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
        refreshAll();
        sensorChart.resetZoom();
    }
    if (problems.length > 0) {
        alert('Could not load:\n' + problems.join('\n'));
    }
}

// --- Dataset list / active selection -----------------------------------
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function renderDatasetList() {
    const table = document.getElementById('datasetList');
    const select = document.getElementById('activeDatasetSelect');

    if (datasets.length === 0) {
        table.innerHTML = '<tr><td class="empty-note">No datasets loaded. Use "Load CSV..." or drop files on the plot.</td></tr>';
        select.innerHTML = '<option value="">&mdash; none &mdash;</option>';
        return;
    }

    let html = '<tr><th></th><th>Dataset</th><th>Points</th><th>Duration</th>'
             + '<th>X off</th><th>Y off</th><th>Starts</th><th>Show</th><th></th></tr>';
    datasets.forEach(ds => {
        const dur = ds.tSec.at(-1) / unitDivisor();
        const isActive = ds.id === activeId;
        const cropTag = ds.cropped
            ? ` <span class="tag-crop" title="Cropped: ${ds.raw.tSec.length} points in the file">CROP</span>` : '';
        html += `<tr class="${isActive ? 'active-row' : ''}" data-id="${ds.id}">
            <td><span class="swatch" style="background:${ds.baseColor}"></span></td>
            <td><span class="ds-name" title="${escapeHtml(ds.name)}">${escapeHtml(ds.label)}</span>${cropTag}</td>
            <td class="ds-meta">${ds.tSec.length}</td>
            <td class="ds-meta">${dur.toFixed(2)} ${unitShort()}</td>
            <td class="ds-meta">${(ds.xOffsetSec / unitDivisor()).toFixed(3)}</td>
            <td class="ds-meta">${ds.yOffset.toFixed(3)}</td>
            <td class="ds-meta">${ds.startTime.toLocaleTimeString()}</td>
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
        .map(ds => `<option value="${ds.id}" ${ds.id === activeId ? 'selected' : ''}>${escapeHtml(ds.label)}</option>`)
        .join('');
}

function setControlsEnabled() {
    const ds = getActive();
    ['xOffsetInput', 'yOffsetInput', 'xMinusButton', 'xPlusButton',
     'yMinusButton', 'yPlusButton', 'resetOffsetsButton', 'zeroAlignButton',
     'dsLabelInput', 'baseColorInput', 'resetStylesButton', 'cropButton']
        .forEach(id => { document.getElementById(id).disabled = !ds; });
    document.getElementById('resetCropButton').disabled = !ds || !ds.cropped;

    const label = document.getElementById('activeLabel');
    label.textContent = ds
        ? `Active: ${ds.label}${ds.cropped ? ' (cropped)' : ''}`
        : 'No dataset loaded';
    document.getElementById('dsLabelInput').value = ds ? ds.label : '';
    document.getElementById('baseColorInput').value = ds ? ds.baseColor : '#d62728';
}

// Per-curve colour / line width / point size for the active dataset.
function renderCurveStyles() {
    const host = document.getElementById('curveStyleList');
    const ds = getActive();
    if (!ds) {
        host.innerHTML = '<div class="empty-note">Load a dataset to adjust curve colours and sizes.</div>';
        return;
    }
    const keys = selectedSeriesKeys().filter(k => ds.availableKeys.includes(k));
    if (keys.length === 0) {
        host.innerHTML = '<div class="empty-note">No selected series carries data in this dataset.</div>';
        return;
    }

    host.innerHTML = keys.map(key => {
        const meta = SERIES.find(s => s.key === key);
        const st = curveStyle(ds, key);
        return `<div class="curve-row">
            <input type="color" class="curve-color" data-key="${key}" value="${st.color}" title="Curve colour">
            <span class="curve-label">${meta.label}</span>
            <label title="Line width in px">line
                <input type="number" class="curve-width" data-key="${key}" value="${st.width}" min="0" max="10" step="0.5">
            </label>
            <label title="Point radius in px (0 hides the markers)">pt
                <input type="number" class="curve-point" data-key="${key}" value="${st.point}" min="0" max="10" step="0.5">
            </label>
        </div>`;
    }).join('');

    // Live updates without re-rendering the panel, so focus is never stolen.
    host.querySelectorAll('.curve-color').forEach(inp => {
        inp.addEventListener('input', () => setCurveStyle(inp.dataset.key, { color: inp.value }));
    });
    host.querySelectorAll('.curve-width').forEach(inp => {
        inp.addEventListener('input', () => setCurveStyle(inp.dataset.key, { width: parseFloat(inp.value) }));
    });
    host.querySelectorAll('.curve-point').forEach(inp => {
        inp.addEventListener('input', () => setCurveStyle(inp.dataset.key, { point: parseFloat(inp.value) }));
    });
}

function setCurveStyle(key, patch) {
    const ds = getActive();
    if (!ds) return;
    ds.styles[key] = Object.assign({}, ds.styles[key], patch);
    rebuildChart();
}

function resetCurveStyles() {
    const ds = getActive();
    if (!ds) return;
    ds.styles = {};
    renderCurveStyles();
    rebuildChart();
}

// Redraws every dependent piece of UI plus the chart.
function refreshAll() {
    renderDatasetList();
    setControlsEnabled();
    syncOffsetInputs();
    renderCurveStyles();
    rebuildChart();
}

function setActive(id) {
    if (activeId === id) return;
    activeId = id;
    refreshAll();
}

function removeDataset(id) {
    const idx = datasets.findIndex(d => d.id === id);
    if (idx === -1) return;
    datasets.splice(idx, 1);
    if (activeId === id) {
        activeId = datasets.length ? datasets[Math.min(idx, datasets.length - 1)].id : null;
    }
    refreshAll();
}

function clearAll() {
    if (datasets.length === 0) return;
    datasets.length = 0;
    activeId = null;
    refreshAll();
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

// --- Crop to view -------------------------------------------------------
// Keeps only the samples of the active dataset that fall inside the current
// x-axis window, then restarts their elapsed time at zero. Non-destructive:
// ds.raw still holds the full file, so Reset Crop always works.
function cropToView() {
    const ds = getActive();
    if (!ds) return;
    const x = sensorChart.scales.x;
    if (!x) return;

    // Plotted x = (tSec + xOffsetSec) / divisor  =>  invert for tSec limits.
    const div = unitDivisor();
    const tMin = x.min * div - ds.xOffsetSec;
    const tMax = x.max * div - ds.xOffsetSec;

    const keep = [];
    for (let i = 0; i < ds.tSec.length; i++) {
        if (ds.tSec[i] >= tMin && ds.tSec[i] <= tMax) keep.push(i);
    }
    if (keep.length < 2) {
        alert('The visible range contains fewer than two points of the active dataset.\nZoom out a little and try again.');
        return;
    }
    if (keep.length === ds.tSec.length) {
        alert('The whole dataset is already visible, so there is nothing to crop.');
        return;
    }

    const tStart = ds.tSec[keep[0]];
    const newT = keep.map(i => ds.tSec[i] - tStart);
    const newSeries = {};
    SERIES_KEYS.forEach(key => { newSeries[key] = keep.map(i => ds.series[key][i]); });

    // The wall-clock time that the new t = 0 corresponds to.
    ds.startTime = new Date(ds.startTime.getTime() + tStart * 1000);
    ds.tSec = newT;
    ds.series = newSeries;
    ds.availableKeys = SERIES_KEYS.filter(k => ds.series[k].some(v => v !== null));
    ds.cropped = true;
    ds.xOffsetSec = 0;   // the crop itself re-zeroes time

    console.log(`Cropped "${ds.label}" to ${newT.length} points, new t=0 at ${ds.startTime.toISOString()}.`);
    refreshAll();
    resetZoom();
}

function resetCrop() {
    const ds = getActive();
    if (!ds || !ds.cropped) return;
    ds.tSec = ds.raw.tSec.slice();
    ds.series = {};
    SERIES_KEYS.forEach(key => { ds.series[key] = ds.raw.series[key].slice(); });
    ds.availableKeys = SERIES_KEYS.filter(k => ds.series[k].some(v => v !== null));
    ds.startTime = new Date(ds.raw.startMs);
    ds.cropped = false;
    ds.xOffsetSec = 0;
    refreshAll();
    resetZoom();
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
            const st = curveStyle(ds, key);
            // Inactive datasets keep their colours but are drawn translucent,
            // so the active one reads as the foreground curve.
            const color = isActive ? st.color : hexToRgba(st.color, 0.4);
            chartDatasets.push({
                label: `${ds.label} - ${meta.label}`,
                data: seriesPoints(ds, key),
                borderColor: color,
                backgroundColor: color,
                borderWidth: st.width,
                pointRadius: st.point,
                fill: false,
                tension: 0.1,
                spanGaps: true,
                order: isActive ? 0 : 1,
                _dsId: ds.id,
                _key: key
            });
        });
    });

    const hasData = chartDatasets.length > 0;
    const x = sensorChart.options.scales.x;
    const y = sensorChart.options.scales.y;

    if (hasData) {
        // Let Chart.js autoscale to the data (unless the user has zoomed).
        x.min = undefined; x.max = undefined;
        y.min = undefined; y.max = undefined;
    } else {
        // Pin a clean, predictable empty frame and drop any zoom state.
        if (sensorChart.resetZoom) sensorChart.resetZoom('none');
        x.min = 0; x.max = 1;
        y.min = 0; y.max = 1;
    }
    applyZoomAvailability(hasData);

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
    const shown = datasets.filter(ds => ds.visible);

    if (shown.length === 0 || keys.length === 0) return null;

    const blocks = [];
    shown.forEach(ds => {
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
        header.push(`${b.ds.label} time_${unitShort()}`);
        b.cols.forEach(k => header.push(`${b.ds.label} ${k}`));
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
    zoomModeDrag = !zoomModeDrag;
    applyZoomAvailability(sensorChart.data.datasets.length > 0);

    const canvas = document.getElementById('sensorChart');
    const zoomButton = document.getElementById('zoomButton');

    if (zoomModeDrag) {
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
    if (sensorChart.data.datasets.length === 0) return;
    sensorChart.options.scales.x.min = undefined;
    sensorChart.options.scales.x.max = undefined;
    sensorChart.options.scales.y.min = undefined;
    sensorChart.options.scales.y.max = undefined;
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
    zoomModeDrag = false;
    toggleZoomMode();          // flips to drag-zoom and sets the button label
    refreshAll();

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

    // --- Label + colours ---
    document.getElementById('dsLabelInput').addEventListener('change', function () {
        const ds = getActive();
        if (!ds) return;
        ds.label = this.value.trim() || ds.name;
        renderDatasetList();
        rebuildChart();
    });
    document.getElementById('baseColorInput').addEventListener('input', function () {
        const ds = getActive();
        if (!ds) return;
        ds.baseColor = this.value;
        ds.styles = {};          // re-derive the whole family from the new base
        renderDatasetList();
        renderCurveStyles();
        rebuildChart();
    });
    document.getElementById('resetStylesButton').addEventListener('click', resetCurveStyles);

    // --- Offsets ---
    document.getElementById('xOffsetInput').addEventListener('change', applyOffsetsFromInputs);
    document.getElementById('yOffsetInput').addEventListener('change', applyOffsetsFromInputs);
    document.getElementById('xMinusButton').addEventListener('click', () => nudge('x', -1));
    document.getElementById('xPlusButton').addEventListener('click', () => nudge('x', +1));
    document.getElementById('yMinusButton').addEventListener('click', () => nudge('y', -1));
    document.getElementById('yPlusButton').addEventListener('click', () => nudge('y', +1));
    document.getElementById('resetOffsetsButton').addEventListener('click', resetOffsets);
    document.getElementById('zeroAlignButton').addEventListener('click', zeroAlign);

    // --- Crop ---
    document.getElementById('cropButton').addEventListener('click', cropToView);
    document.getElementById('resetCropButton').addEventListener('click', resetCrop);

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
        cb.addEventListener('change', () => {
            renderCurveStyles();
            rebuildChart();
        });
    });
});
