let version = "2026.08.08.3";
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

// Matches the Viewer's export: a blank comment cell inherits the comment of
// the previous row, and this sentinel ends a run.
const NO_COMMENT_TOKEN = 'NO COMMENT';

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
let emptyFramePinned = false;   // true while the blank 0..1 frame is forced
// Legend visibility, keyed "<datasetId>|<seriesKey>". Chart.js tracks hidden
// state by dataset index and by object identity, both of which change on every
// rebuild, so it has to live here to survive one.
const hiddenCurves = new Set();

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

// Lowest palette entry not already in use, so removing and re-adding a
// dataset cannot produce two identically coloured curves.
function nextFreeColor() {
    const used = new Set(datasets.map(d => d.baseColor));
    return PALETTE.find(c => !used.has(c)) || PALETTE[datasets.length % PALETTE.length];
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
        point: Number.isFinite(override.point) ? override.point : DEFAULT_POINT,
        name: override.name || ''
    };
}

// Text shown in the legend: the user's own wording if they set one, otherwise
// "<dataset label> - <series>".
function defaultCurveLabel(ds, key) {
    const meta = SERIES.find(s => s.key === key);
    return `${ds.label} - ${meta.label}`;
}

function curveLabel(ds, key) {
    const name = (ds.styles[key] || {}).name;
    return (name && name.trim()) ? name.trim() : defaultCurveLabel(ds, key);
}

// Renames the curve behind a legend entry (double-click on the legend).
function renameCurveAt(datasetIndex) {
    const d = sensorChart.data.datasets[datasetIndex];
    if (!d) return;
    const ds = datasets.find(x => x.id === d._dsId);
    if (!ds) return;
    const proposed = window.prompt(
        'Legend text for this curve (leave empty to restore the default):',
        curveLabel(ds, d._key));
    if (proposed === null) return;                 // cancelled
    ds.styles[d._key] = Object.assign({}, ds.styles[d._key], { name: proposed.trim() });
    if (ds.id !== activeId) setActive(ds.id);
    renderCurveStyles();
    rebuildChart();
}

// --- Comments -----------------------------------------------------------
// Collapses the per-row comments back into runs: one entry per stretch of rows
// carrying the same text. Two identical texts separated by a gap stay separate.
function commentRuns(ds) {
    return runsFromComments(ds && ds.comments);
}

function runsFromComments(comments) {
    const runs = [];
    if (!comments) return runs;
    const ds = { comments: comments };
    const n = ds.comments.length;
    let i = 0;
    while (i < n) {
        const text = ds.comments[i];
        if (text === '') { i++; continue; }
        let j = i;
        while (j + 1 < n && ds.comments[j + 1] === text) j++;
        runs.push({ start: i, end: j, text: text });
        i = j + 1;
    }
    return runs;
}

function hasComments(ds) {
    return !!ds && !!ds.comments && ds.comments.some(c => c !== '');
}

function commentMarkersOn() {
    const cb = document.getElementById('showCommentsCheckbox');
    return cb ? cb.checked : true;
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
            // Object data is parsed by Chart.js so that null y values become
            // genuine gaps rather than NaN pixels.
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
                        label: (item) => `${item.dataset.label}: ${item.parsed.y}`,
                        afterBody: (items) => {
                            const d = items[0] && items[0].dataset;
                            const ds = d && datasets.find(x => x.id === d._dsId);
                            const c = ds && ds.comments && ds.comments[items[0].dataIndex];
                            return c ? ['', c] : [];
                        }
                    }
                },
                legend: {
                    position: 'top',
                    // Remember hiding per dataset+series instead of per index.
                    onClick: (ev, item, legend) => {
                        const d = legend.chart.data.datasets[item.datasetIndex];
                        if (!d) return;
                        const id = `${d._dsId}|${d._key}`;
                        if (hiddenCurves.has(id)) hiddenCurves.delete(id);
                        else hiddenCurves.add(id);
                        rebuildChart();
                    }
                },
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

// Column matching is deliberately forgiving so that files written by the
// Viewer, by this Analyzer, and by earlier Analyzer versions (which prefixed
// every header with the dataset label) all load. A column counts as `key` if
// it equals it or ends with it after a space or underscore separator.
function findColumn(header, key) {
    const lower = header.map(h => h.toLowerCase());
    const k = key.toLowerCase();
    let idx = lower.indexOf(k);
    if (idx !== -1) return idx;
    return lower.findIndex(h => h.endsWith(' ' + k) || h.endsWith('_' + k));
}

// Recognises an elapsed-time column and how to convert it to seconds, e.g.
// "elapsed_s", "time_min", "<label> time_h".
const ELAPSED_UNITS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
                        min: 60, mins: 60, minute: 60, minutes: 60,
                        h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };

function findElapsedColumn(header) {
    for (let i = 0; i < header.length; i++) {
        const m = header[i].toLowerCase().match(/(?:^|[ _])(?:elapsed|time)[ _]?([a-z]+)$/);
        if (m && Object.prototype.hasOwnProperty.call(ELAPSED_UNITS, m[1])) {
            return { index: i, multiplier: ELAPSED_UNITS[m[1]] };
        }
    }
    return null;
}

// Parses a Viewer- or Analyzer-exported CSV into a dataset object.
// Throws on unusable input so the caller can report the offending file.
function parseCsvText(text, fileName) {
    const clean = text.replace(/^\uFEFF/, '');            // strip BOM
    const lines = clean.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('file contains no data rows');

    const header = splitCsvLine(lines[0]).map(h => h.trim());

    // Absolute time column, if the file has one.
    let tsCol = header.findIndex(h => h.toLowerCase() === 'timestamp'
                                   || h.toLowerCase().endsWith(' timestamp')
                                   || h.toLowerCase().endsWith('_timestamp'));
    // Elapsed-time column, used when there is no usable timestamp.
    const elapsed = findElapsedColumn(header);

    if (tsCol === -1 && !elapsed) {
        // Last resort: treat column 0 as a timestamp if it parses as a date.
        const first = splitCsvLine(lines[1])[0];
        // Require date-like punctuation: Date.parse('12.5') happily returns
        // Dec 2001, which would turn an elapsed-time column into years.
        if (/\d{4}-\d{2}-\d{2}|[T:]/.test(first) && Number.isFinite(Date.parse(first))) {
            tsCol = 0;
        }
    }
    if (tsCol === -1 && !elapsed) {
        throw new Error('no timestamp or elapsed-time column found');
    }

    // Map every known series key to its column index, when present.
    const colOf = {};
    SERIES_KEYS.forEach(key => {
        const idx = findColumn(header, key);
        if (idx !== -1) colOf[key] = idx;
    });
    if (Object.keys(colOf).length === 0) {
        throw new Error('no recognised sensor columns (expected e.g. sens1_Temp)');
    }

    // Free-text comment column, written by Viewer 2026.08.06 and later.
    const commentCol = findColumn(header, 'comment');

    const rows = [];
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i]);
        let sec;
        if (tsCol !== -1) {
            const ms = Date.parse(cells[tsCol]);
            if (!Number.isFinite(ms)) { skipped++; continue; }
            sec = ms / 1000;
        } else {
            const raw = toNumberOrNull(cells[elapsed.index]);
            if (raw === null) { skipped++; continue; }
            sec = raw * elapsed.multiplier;
        }
        if (!Number.isFinite(sec)) { skipped++; continue; }
        const values = {};
        SERIES_KEYS.forEach(key => {
            values[key] = (key in colOf) ? toNumberOrNull(cells[colOf[key]]) : null;
        });
        rows.push({
            sec: sec,
            values: values,
            comment: commentCol === -1 ? '' : String(cells[commentCol] || '').trim()
        });
    }
    if (rows.length === 0) throw new Error('no rows with a parsable time column');

    rows.sort((a, b) => a.sec - b.sec);
    const startSec = rows[0].sec;

    const tSec = rows.map(r => r.sec - startSec);   // starts at exactly 0
    const series = {};
    SERIES_KEYS.forEach(key => { series[key] = rows.map(r => r.values[key]); });

    // Expand the run-length encoding into one comment per row: blank inherits
    // the running comment, the sentinel ends it. Done after the time sort, so
    // the fill follows the same order the writer used.
    const comments = [];
    let running = '';
    rows.forEach(r => {
        if (r.comment === '') {
            // inherit whatever is running
        } else if (r.comment.toUpperCase() === NO_COMMENT_TOKEN) {
            running = '';
        } else {
            running = r.comment;
        }
        comments.push(running);
    });

    // Absolute start time is only known when the file carried timestamps.
    const startMs = (tsCol !== -1) ? startSec * 1000 : null;

    const ds = {
        id: ++datasetCounter,
        name: fileName,
        label: fileName.replace(/\.csv$/i, ''),
        baseColor: nextFreeColor(),
        styles: {},                 // per-series {color, width, point} overrides
        tSec: tSec,
        series: series,
        comments: comments,
        raw: { tSec: tSec.slice(), series: series, comments: comments.slice(), startMs: startMs },
        xOffsetSec: 0,
        yOffset: 0,
        visible: true,
        cropped: false,
        startTime: startMs === null ? null : new Date(startMs),  // wall clock at t = 0
        skippedRows: skipped
    };
    // Keep the raw series arrays independent of the working copies.
    ds.raw.series = {};
    SERIES_KEYS.forEach(key => { ds.raw.series[key] = series[key].slice(); });

    ds.availableKeys = SERIES_KEYS.filter(k => ds.series[k].some(v => v !== null));
    return ds;
}

function looksLikeSession(file, text) {
    return /\.json$/i.test(file.name) || text.trimStart().startsWith('{');
}

async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const problems = [];
    let added = 0;

    // A session describes the whole workspace, so it is loaded on its own.
    if (files.length >= 1) {
        const first = files[0];
        const text = await first.text();
        if (looksLikeSession(first, text)) {
            if (files.length > 1) {
                alert('Load the session file on its own: it replaces the whole workspace.');
                return;
            }
            if (datasets.length > 0 &&
                !confirm('Loading a session replaces every dataset currently loaded. Continue?')) {
                return;
            }
            try {
                loadSessionText(text, first.name);
            } catch (e) {
                alert(`Could not load session:\n${first.name}: ${e.message}`);
            }
            return;
        }
    }

    for (const file of files) {
        try {
            const text = await file.text();
            const ds = parseCsvText(text, file.name);
            if (ds.skippedRows > 0) {
                console.warn(`${file.name}: ${ds.skippedRows} row(s) skipped (unparsable time column).`);
            }
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
             + '<th>X off</th><th>Y off</th><th>Starts</th><th>Notes</th><th>Show</th><th></th></tr>';
    datasets.forEach(ds => {
        const dur = ds.tSec.at(-1) / unitDivisor();
        const isActive = ds.id === activeId;
        const cropTag = ds.cropped
            ? ` <span class="tag-crop" title="Cropped: ${ds.raw.tSec.length} points in the file">CROP</span>` : '';
        html += `<tr class="${isActive ? 'active-row' : ''}" data-id="${ds.id}">
            <td><span class="swatch" style="background:${ds.baseColor}"></span></td>
            <td><span class="ds-name" title="${escapeHtml(ds.name)}">${escapeHtml(ds.label)}</span>${cropTag}</td>
            <td class="ds-meta" title="${ds.skippedRows} row(s) skipped while loading">${ds.tSec.length}${ds.skippedRows ? '*' : ''}</td>
            <td class="ds-meta">${dur.toFixed(2)} ${unitShort()}</td>
            <td class="ds-meta">${(ds.xOffsetSec / unitDivisor()).toFixed(3)}</td>
            <td class="ds-meta">${ds.yOffset.toFixed(3)}</td>
            <td class="ds-meta">${ds.startTime ? ds.startTime.toLocaleTimeString() : 'relative'}</td>
            <td class="ds-meta">${commentRuns(ds).length || '-'}</td>
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
            <input type="text" class="curve-name" data-key="${key}" value="${escapeHtml(st.name)}"
                   placeholder="${escapeHtml(defaultCurveLabel(ds, key))}"
                   title="Legend text. Empty = dataset label + series name.">
            <label title="Line width in px">line
                <input type="number" class="curve-width" data-key="${key}" value="${st.width}" min="0" max="10" step="0.5">
            </label>
            <label title="Point radius in px (0 hides the markers)">pt
                <input type="number" class="curve-point" data-key="${key}" value="${st.point}" min="0" max="10" step="0.5">
            </label>
        </div>`;
    }).join('');

    // Live updates without re-rendering the panel, so focus is never stolen.
    host.querySelectorAll('.curve-name').forEach(inp => {
        inp.addEventListener('change', () => setCurveStyle(inp.dataset.key, { name: inp.value.trim() }));
    });
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

// Comment table for the active dataset; clicking a row frames that run.
function renderCommentList() {
    const host = document.getElementById('commentList');
    const ds = getActive();

    if (!ds) {
        host.innerHTML = '<div class="empty-note">Load a dataset to see its comments.</div>';
        return;
    }
    const runs = commentRuns(ds);
    if (runs.length === 0) {
        host.innerHTML = '<div class="empty-note">No comments in this dataset'
            + (ds.comments && ds.comments.length ? '.' : ' (the file has no comment column).') + '</div>';
        return;
    }

    const div = unitDivisor();
    let html = '<table id="commentTable"><tr><th>Start</th><th>Duration</th><th>Clock</th><th>Comment</th></tr>';
    runs.forEach((run, i) => {
        const t0 = ds.tSec[run.start] / div;
        const dur = (ds.tSec[run.end] - ds.tSec[run.start]) / div;
        const clock = ds.startTime
            ? new Date(ds.startTime.getTime() + ds.tSec[run.start] * 1000).toLocaleTimeString()
            : '-';
        html += `<tr data-run="${i}" title="Click to frame this comment in the plot">
            <td class="ds-meta">${t0.toFixed(2)} ${unitShort()}</td>
            <td class="ds-meta">${dur.toFixed(2)} ${unitShort()}</td>
            <td class="ds-meta">${clock}</td>
            <td>${escapeHtml(run.text)}</td>
        </tr>`;
    });
    html += '</table>';
    host.innerHTML = html;

    host.querySelectorAll('tr[data-run]').forEach(tr => {
        tr.addEventListener('click', () => zoomToRun(runs[parseInt(tr.dataset.run, 10)]));
    });
}

// Frames one comment run on the x axis, with a little margin either side.
function zoomToRun(run) {
    const ds = getActive();
    if (!ds || !run) return;
    const div = unitDivisor();
    const a = (ds.tSec[run.start] + ds.xOffsetSec) / div;
    const b = (ds.tSec[run.end] + ds.xOffsetSec) / div;
    const span = Math.max(b - a, (ds.tSec.at(-1) / div) * 0.02, 1e-6);
    sensorChart.options.scales.x.min = a - span * 0.15;
    sensorChart.options.scales.x.max = b + span * 0.15;
    sensorChart.update();
}

// Redraws every dependent piece of UI plus the chart.
function refreshAll() {
    renderDatasetList();
    setControlsEnabled();
    syncOffsetInputs();
    renderCurveStyles();
    renderCommentList();
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
    SERIES_KEYS.forEach(k => hiddenCurves.delete(`${id}|${k}`));
    if (activeId === id) {
        activeId = datasets.length ? datasets[Math.min(idx, datasets.length - 1)].id : null;
    }
    refreshAll();
}

function clearAll() {
    if (datasets.length === 0) return;
    datasets.length = 0;
    activeId = null;
    hiddenCurves.clear();
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
    if (!ds.visible) {
        alert('The active dataset is hidden, so the visible range does not describe it.\nTick its "Show" box before cropping.');
        return;
    }
    const x = sensorChart.scales.x;
    if (!x || !Number.isFinite(x.min) || !Number.isFinite(x.max)) return;

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
    const newComments = keep.map(i => ds.comments[i]);

    // The wall-clock time that the new t = 0 corresponds to.
    if (ds.startTime) ds.startTime = new Date(ds.startTime.getTime() + tStart * 1000);
    ds.tSec = newT;
    ds.series = newSeries;
    ds.comments = newComments;
    ds.availableKeys = SERIES_KEYS.filter(k => ds.series[k].some(v => v !== null));
    ds.cropped = true;
    if (!('xOffsetSec' in ds.raw)) ds.raw.xOffsetSec = ds.xOffsetSec;  // for Reset Crop
    ds.xOffsetSec = 0;   // the crop itself re-zeroes time

    console.log(`Cropped "${ds.label}" to ${newT.length} points, new t=0 at `
                + (ds.startTime ? ds.startTime.toISOString() : `+${tStart}s (relative)`) + '.');
    refreshAll();
    resetZoom();
}

function resetCrop() {
    const ds = getActive();
    if (!ds || !ds.cropped) return;
    ds.tSec = ds.raw.tSec.slice();
    ds.series = {};
    SERIES_KEYS.forEach(key => { ds.series[key] = ds.raw.series[key].slice(); });
    ds.comments = ds.raw.comments.slice();
    ds.availableKeys = SERIES_KEYS.filter(k => ds.series[k].some(v => v !== null));
    ds.startTime = ds.raw.startMs === null ? null : new Date(ds.raw.startMs);
    ds.cropped = false;
    ds.xOffsetSec = Number.isFinite(ds.raw.xOffsetSec) ? ds.raw.xOffsetSec : 0;
    delete ds.raw.xOffsetSec;
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
        // null is kept as null so a dropout renders as a gap, not a straight
        // line interpolated across it.
        pts.push({
            x: (t[i] + ds.xOffsetSec) / div,
            y: vals[i] === null ? null : vals[i] + ds.yOffset
        });
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
            const st = curveStyle(ds, key);
            // Inactive datasets keep their colours but are drawn translucent,
            // so the active one reads as the foreground curve.
            const color = isActive ? st.color : hexToRgba(st.color, 0.4);
            chartDatasets.push({
                label: curveLabel(ds, key),
                data: seriesPoints(ds, key),
                borderColor: color,
                backgroundColor: color,
                borderWidth: st.width,
                pointRadius: st.point,
                fill: false,
                tension: 0.1,
                spanGaps: false,          // a dropout is drawn as a break
                hidden: hiddenCurves.has(`${ds.id}|${key}`),
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
        // Release the pinned empty frame, but otherwise leave the axis limits
        // alone: the zoom plugin keeps the current zoom/pan window in exactly
        // these options, so clearing them here would undo every zoom whenever
        // an offset, colour or checkbox changed.
        if (emptyFramePinned) {
            x.min = undefined; x.max = undefined;
            y.min = undefined; y.max = undefined;
            emptyFramePinned = false;
        }
    } else {
        // Pin a clean, predictable empty frame and drop any zoom state.
        if (sensorChart.resetZoom) sensorChart.resetZoom('none');
        x.min = 0; x.max = 1;
        y.min = 0; y.max = 1;
        emptyFramePinned = true;
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
    renderCommentList();
    rebuildChart();
}

// --- Session save / load ------------------------------------------------
// A session is a single self-contained JSON file holding every loaded dataset
// (including hidden ones and the uncropped originals), all offsets, crop state,
// per-curve colours, sizes and custom legend names, comments, and the global UI
// state. Reloading one restores the workspace exactly as it was saved.
const SESSION_FORMAT = 'LabMonitorAnalyzer.session';
const SESSION_VERSION = 1;

// Time is stored to millisecond precision - the resolution it was parsed at -
// so the JSON stays free of float noise.
function packTimes(tSec) {
    return tSec.map(t => Math.round(t * 1000) / 1000);
}

// Only series that carry data are written; the rest are all-null by definition.
function packSeries(ds, source) {
    const out = {};
    SERIES_KEYS.forEach(key => {
        const arr = source[key];
        if (arr && arr.some(v => v !== null)) out[key] = arr;
    });
    return out;
}

function unpackSeries(stored, n) {
    const out = {};
    SERIES_KEYS.forEach(key => {
        const arr = stored && stored[key];
        out[key] = Array.isArray(arr)
            ? arr.map(v => (v === null || v === undefined || v === '') ? null : Number(v))
            : new Array(n).fill(null);
    });
    return out;
}

function expandComments(runs, n) {
    const out = new Array(n).fill('');
    (runs || []).forEach(r => {
        const start = Math.max(0, r[0] | 0);
        const end = Math.min(n - 1, r[1] | 0);
        for (let i = start; i <= end; i++) out[i] = String(r[2]);
    });
    return out;
}

function buildSession() {
    return {
        format: SESSION_FORMAT,
        formatVersion: SESSION_VERSION,
        app: version,
        saved: new Date().toISOString(),
        ui: {
            xUnit: document.getElementById('xUnitSelect').value,
            xStep: document.getElementById('xStepInput').value,
            yStep: document.getElementById('yStepInput').value,
            activeId: activeId,
            series: selectedSeriesKeys(),
            hiddenCurves: Array.from(hiddenCurves),
            showComments: document.getElementById('showCommentsCheckbox').checked,
            fullData: document.getElementById('fullDataCheckbox').checked,
            applyOffsets: document.getElementById('applyOffsetsCheckbox').checked
        },
        datasets: datasets.map(ds => {
            const entry = {
                id: ds.id,
                name: ds.name,
                label: ds.label,
                baseColor: ds.baseColor,
                styles: ds.styles,
                xOffsetSec: ds.xOffsetSec,
                yOffset: ds.yOffset,
                visible: ds.visible,
                cropped: ds.cropped,
                skippedRows: ds.skippedRows || 0,
                startMs: ds.startTime ? ds.startTime.getTime() : null,
                tSec: packTimes(ds.tSec),
                series: packSeries(ds, ds.series),
                commentRuns: runsFromComments(ds.comments).map(r => [r.start, r.end, r.text])
            };
            // The untouched original is only worth storing once it differs.
            if (ds.cropped) {
                entry.raw = {
                    startMs: ds.raw.startMs,
                    xOffsetSec: Number.isFinite(ds.raw.xOffsetSec) ? ds.raw.xOffsetSec : 0,
                    tSec: packTimes(ds.raw.tSec),
                    series: packSeries(ds, ds.raw.series),
                    commentRuns: runsFromComments(ds.raw.comments).map(r => [r.start, r.end, r.text])
                };
            }
            return entry;
        })
    };
}

function saveSession() {
    if (datasets.length === 0) {
        alert('Nothing to save yet. Load a CSV first.');
        return;
    }
    const text = JSON.stringify(buildSession());
    downloadText(text, stampForFileName(new Date()) + '_analyzer-session.json',
                 'application/json;charset=utf-8');
    console.log(`Session saved: ${datasets.length} dataset(s), ${text.length} bytes.`);
}

// Rebuilds one dataset from its stored entry. Throws with a specific message,
// so a corrupt file names the dataset that is at fault.
function datasetFromSession(entry, index) {
    const where = `dataset ${index + 1}${entry && entry.label ? ` ("${entry.label}")` : ''}`;
    if (!entry || !Array.isArray(entry.tSec) || entry.tSec.length === 0) {
        throw new Error(`${where}: missing or empty time array`);
    }
    const n = entry.tSec.length;
    const tSec = entry.tSec.map(Number);
    if (!tSec.every(Number.isFinite)) throw new Error(`${where}: non-numeric time value`);

    const series = unpackSeries(entry.series, n);
    const badKey = SERIES_KEYS.find(k => series[k].length !== n);
    if (badKey) throw new Error(`${where}: series "${badKey}" has ${series[badKey].length} values but ${n} time points`);

    const comments = expandComments(entry.commentRuns, n);
    const startMs = (entry.startMs === null || entry.startMs === undefined) ? null : Number(entry.startMs);

    const ds = {
        id: Number(entry.id) || (++datasetCounter),
        name: entry.name || entry.label || 'session dataset',
        label: entry.label || entry.name || 'dataset',
        baseColor: entry.baseColor || nextFreeColor(),
        styles: (entry.styles && typeof entry.styles === 'object') ? entry.styles : {},
        tSec: tSec,
        series: series,
        comments: comments,
        xOffsetSec: Number(entry.xOffsetSec) || 0,
        yOffset: Number(entry.yOffset) || 0,
        visible: entry.visible !== false,
        cropped: !!entry.cropped,
        startTime: startMs === null ? null : new Date(startMs),
        skippedRows: Number(entry.skippedRows) || 0
    };

    if (entry.raw && Array.isArray(entry.raw.tSec)) {
        const rn = entry.raw.tSec.length;
        ds.raw = {
            tSec: entry.raw.tSec.map(Number),
            series: unpackSeries(entry.raw.series, rn),
            comments: expandComments(entry.raw.commentRuns, rn),
            startMs: (entry.raw.startMs === null || entry.raw.startMs === undefined) ? null : Number(entry.raw.startMs),
            xOffsetSec: Number(entry.raw.xOffsetSec) || 0
        };
    } else {
        // Never cropped, or saved without the original: the working copy is it.
        ds.raw = {
            tSec: tSec.slice(),
            series: unpackSeries(entry.series, n),
            comments: comments.slice(),
            startMs: startMs
        };
        ds.cropped = false;
    }

    ds.availableKeys = SERIES_KEYS.filter(k => ds.series[k].some(v => v !== null));
    return ds;
}

function loadSessionText(text, fileName) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('not valid JSON');
    }
    if (!data || data.format !== SESSION_FORMAT) {
        throw new Error('not a LabMonitor Analyzer session file');
    }
    if (Number(data.formatVersion) > SESSION_VERSION) {
        throw new Error(`session format v${data.formatVersion} is newer than this Analyzer (v${SESSION_VERSION}); update the app`);
    }
    if (!Array.isArray(data.datasets) || data.datasets.length === 0) {
        throw new Error('session contains no datasets');
    }

    const restored = data.datasets.map(datasetFromSession);   // may throw

    // Only past validation do we touch the current workspace.
    datasets.length = 0;
    hiddenCurves.clear();
    restored.forEach(ds => datasets.push(ds));
    datasetCounter = Math.max(datasetCounter, ...restored.map(d => d.id));

    const ui = data.ui || {};
    if (ui.xUnit) document.getElementById('xUnitSelect').value = ui.xUnit;
    if (ui.xStep !== undefined) document.getElementById('xStepInput').value = ui.xStep;
    if (ui.yStep !== undefined) document.getElementById('yStepInput').value = ui.yStep;
    if (Array.isArray(ui.series)) {
        document.querySelectorAll('.data-checkbox').forEach(cb => {
            cb.checked = ui.series.includes(cb.dataset.key);
        });
    }
    (ui.hiddenCurves || []).forEach(k => hiddenCurves.add(k));
    if (ui.showComments !== undefined) document.getElementById('showCommentsCheckbox').checked = !!ui.showComments;
    if (ui.fullData !== undefined) document.getElementById('fullDataCheckbox').checked = !!ui.fullData;
    if (ui.applyOffsets !== undefined) document.getElementById('applyOffsetsCheckbox').checked = !!ui.applyOffsets;

    activeId = datasets.some(d => d.id === ui.activeId) ? ui.activeId : datasets[0].id;

    refreshAll();
    resetZoom();
    console.log(`Session "${fileName}" restored: ${datasets.length} dataset(s), saved ${data.saved || 'unknown'} by app ${data.app || '?'}.`);
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
    link.download = stampForFileName(new Date()) + '_analyzer-plot.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    sensorChart.options.plugins.title = { display: false };
    sensorChart.update('none');
}

// One CSV per visible dataset, in exactly the format the loader expects:
// a `timestamp` column (when the absolute start time is known), an
// `elapsed_s` column, then the plain series keys. Never label-prefixed, so an
// exported file can always be loaded straight back in.
function buildDatasetCsv(ds, range, applyOffsets) {
    const keys = selectedSeriesKeys().filter(k => ds.availableKeys.includes(k));
    if (keys.length === 0) return null;

    const div = unitDivisor();
    const xShift = applyOffsets ? ds.xOffsetSec : 0;
    const yShift = applyOffsets ? ds.yOffset : 0;
    const hasClock = !!ds.startTime;

    // Only carry the comment column when the exported rows actually have one.
    let anyComment = false;
    const header = (hasClock ? ['timestamp'] : []).concat(['elapsed_s'], keys);
    const lines = [];
    let count = 0;
    let previousComment = null;

    for (let i = 0; i < ds.tSec.length; i++) {
        // Range test uses plotted coordinates, which always include offsets.
        const xPlotted = (ds.tSec[i] + ds.xOffsetSec) / div;
        if (xPlotted < range.min || xPlotted > range.max) continue;

        const elapsed = ds.tSec[i] + xShift;
        const cells = [];
        if (hasClock) cells.push(new Date(ds.startTime.getTime() + elapsed * 1000).toISOString());
        cells.push(elapsed);
        keys.forEach(k => {
            const v = ds.series[k][i];
            cells.push(v === null ? '' : (v + yShift));
        });

        // Same run-length encoding the Viewer writes, so the file reloads here
        // and reads the same way anywhere else that understands the format.
        const comment = (ds.comments && ds.comments[i]) || '';
        if (comment !== '') anyComment = true;
        cells.push(encodeCommentCell(comment, previousComment));
        previousComment = comment;

        lines.push(cells);
        count++;
    }
    if (count === 0) return null;

    if (anyComment) header.push('comment');
    const body = lines.map(cells => {
        const row = anyComment ? cells : cells.slice(0, -1);
        return row.map(csvCell).join(',');
    });
    return { text: [header.join(',')].concat(body).join('\n') + '\n', rows: count, keys: keys };
}

// Colons are illegal in filenames on Windows and get mangled elsewhere.
function stampForFileName(date) {
    return (date || new Date()).toISOString().replace(/:/g, '-');
}

// Quotes a field only when it needs it, so numbers stay bare.
function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Cell to write for `current` given the previous exported row's comment:
// blank when unchanged (the reader forward-fills), the sentinel when a run
// ends, and always explicit on the first row.
function encodeCommentCell(current, previous) {
    if (previous === null) return current;
    if (current === previous) return '';
    return current === '' ? NO_COMMENT_TOKEN : current;
}

function safeFileName(s) {
    return String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dataset';
}

function downloadText(text, fileName, mime) {
    const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportToCsv() {
    if (datasets.length === 0) {
        alert('No data to export. Load a CSV first.');
        return;
    }
    const shown = datasets.filter(ds => ds.visible);
    if (shown.length === 0) {
        alert('No visible dataset to export.');
        return;
    }
    const range = visibleXRange();
    const applyOffsets = document.getElementById('applyOffsetsCheckbox').checked;

    const files = [];
    shown.forEach(ds => {
        const built = buildDatasetCsv(ds, range, applyOffsets);
        if (built) files.push({ ds: ds, built: built });
    });

    if (files.length === 0) {
        alert('Nothing to export.\nCheck that a series is selected and that data falls inside the visible range,\nor tick "Full data".');
        return;
    }

    // Each dataset becomes its own file: a single side-by-side sheet could not
    // be loaded back, since datasets do not share a sampling grid.
    files.forEach((f, i) => {
        const name = `${stampForFileName(f.ds.startTime)}_${safeFileName(f.ds.label)}_analyzer-data.csv`;
        // Browsers throttle bursts of programmatic downloads; keep them spaced.
        setTimeout(() => downloadText(f.built.text, name), i * 600);
        console.log(`Exporting "${f.ds.label}": ${f.built.rows} rows`
            + ` (${range.full ? 'full data' : 'visible range'}, offsets ${applyOffsets ? 'applied' : 'not applied'}) -> ${name}`);
    });
}

// --- HDF5 export --------------------------------------------------------
// NOTE ON DTYPES: h5wasm uses single-letter type codes, where '<d' is float64
// and '<f' is float32. Passing numpy-style '<f8' silently yields float32, which
// costs enough precision to corrupt epoch-millisecond timestamps.
const H5_F64 = '<d';

// libhdf5 compiled to WebAssembly, pulled from the CDN the first time the
// button is used so the page keeps loading fast (and still works offline for
// everything else). Pinned, like the other libraries.
const H5WASM_URL = 'https://cdn.jsdelivr.net/npm/h5wasm@0.10.3/dist/esm/hdf5_hl.js';
let h5wasmPromise = null;

function loadH5wasm() {
    if (!h5wasmPromise) {
        h5wasmPromise = import(H5WASM_URL).then(async (mod) => {
            const h5 = mod.default || mod;
            const Module = await h5.ready;
            return { h5: h5, FS: Module.FS };
        }).catch(err => {
            h5wasmPromise = null;            // let the next click retry
            throw err;
        });
    }
    return h5wasmPromise;
}

// HDF5 object names cannot contain '/', and duplicates would collide.
function uniqueGroupName(label, taken) {
    let base = String(label || 'dataset').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    if (base === '') base = 'dataset';
    let name = base;
    let n = 2;
    while (taken.has(name)) name = `${base}_${n++}`;
    taken.add(name);
    return name;
}

function downloadBytes(bytes, fileName, mime) {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One group per visible dataset, one dataset per selected series, with the
// curve's styling and legend text attached as attributes. HDF5 has no null, so
// gaps are written as NaN.
function writeHdf5(h5, FS, memName) {
    const keys = selectedSeriesKeys();
    const range = visibleXRange();
    const div = unitDivisor();
    const applyOffsets = document.getElementById('applyOffsetsCheckbox').checked;
    const shown = datasets.filter(ds => ds.visible);

    const f = new h5.File(memName, 'w');
    let written = 0;
    try {
        f.create_attribute('format', 'LabMonitorAnalyzer.hdf5');
        f.create_attribute('format_version', 1);
        f.create_attribute('app_version', version);
        f.create_attribute('created', new Date().toISOString());
        f.create_attribute('missing_value', 'NaN');
        f.create_attribute('offsets_applied', applyOffsets ? 1 : 0);
        f.create_attribute('range', range.full ? 'full data' : 'visible range');

        const taken = new Set();
        shown.forEach(ds => {
            const cols = keys.filter(k => ds.availableKeys.includes(k));
            if (cols.length === 0) return;

            const xShift = applyOffsets ? ds.xOffsetSec : 0;
            const yShift = applyOffsets ? ds.yOffset : 0;

            const idx = [];
            for (let i = 0; i < ds.tSec.length; i++) {
                const xPlotted = (ds.tSec[i] + ds.xOffsetSec) / div;
                if (xPlotted >= range.min && xPlotted <= range.max) idx.push(i);
            }
            if (idx.length === 0) return;

            const name = uniqueGroupName(ds.label, taken);
            f.create_group(name);
            const g = f.get(name);

            g.create_attribute('label', ds.label);
            g.create_attribute('source_file', ds.name);
            g.create_attribute('base_color', ds.baseColor);
            g.create_attribute('x_offset_s', ds.xOffsetSec, null, H5_F64);
            g.create_attribute('y_offset', ds.yOffset, null, H5_F64);
            g.create_attribute('offsets_applied', applyOffsets ? 1 : 0);
            g.create_attribute('cropped', ds.cropped ? 1 : 0);
            g.create_attribute('n_points', idx.length);
            g.create_attribute('start_time', ds.startTime ? ds.startTime.toISOString() : '');

            const elapsed = Float64Array.from(idx, i => ds.tSec[i] + xShift);
            g.create_dataset({ name: 'elapsed_s', data: elapsed, shape: [idx.length], dtype: H5_F64 });
            g.get('elapsed_s').create_attribute('units', 'seconds');

            if (ds.startTime) {
                const t0 = ds.startTime.getTime();
                const stamps = Float64Array.from(idx, i => t0 + (ds.tSec[i] + xShift) * 1000);
                g.create_dataset({ name: 'timestamp_ms', data: stamps, shape: [idx.length], dtype: H5_F64 });
                g.get('timestamp_ms').create_attribute('units', 'milliseconds since 1970-01-01T00:00:00Z');
            }

            cols.forEach(key => {
                const meta = SERIES.find(s => s.key === key);
                const st = curveStyle(ds, key);
                const values = Float64Array.from(idx, i => {
                    const v = ds.series[key][i];
                    return v === null ? NaN : v + yShift;
                });
                g.create_dataset({ name: key, data: values, shape: [idx.length], dtype: H5_F64 });
                const d = g.get(key);
                d.create_attribute('units', meta.unit);
                d.create_attribute('legend', curveLabel(ds, key));
                d.create_attribute('color', st.color);
                d.create_attribute('line_width', st.width, null, H5_F64);
                d.create_attribute('point_size', st.point, null, H5_F64);
            });

            const comments = idx.map(i => (ds.comments && ds.comments[i]) || '');
            if (comments.some(c => c !== '')) {
                g.create_dataset({ name: 'comment', data: comments, shape: [idx.length] });
                g.get('comment').create_attribute('description',
                    'per-sample comment, empty string where none applies');
            }
            written++;
        });
    } finally {
        f.close();
    }
    return written;
}

async function exportToHdf5() {
    if (datasets.length === 0) {
        alert('No data to export. Load a CSV first.');
        return;
    }
    const btn = document.getElementById('saveH5Button');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing...';

    const memName = 'analyzer-export.h5';
    try {
        const { h5, FS } = await loadH5wasm();
        const written = writeHdf5(h5, FS, memName);
        if (written === 0) {
            alert('Nothing to export.\nCheck that a dataset is visible, a series is selected,\nand that data falls inside the visible range, or tick "Full data".');
            return;
        }
        const bytes = FS.readFile(memName);
        downloadBytes(bytes, stampForFileName(new Date()) + '_analyzer-data.h5', 'application/x-hdf5');
        console.log(`HDF5 written: ${written} group(s), ${bytes.length} bytes.`);
    } catch (e) {
        console.error(e);
        alert('HDF5 export failed:\n' + (e && e.message ? e.message : e)
            + '\n\nThe HDF5 writer is fetched from a CDN the first time it is used, so this'
            + '\nneeds the page to be served over http(s) with network access.');
    } finally {
        try { FSUnlink(memName); } catch (ignored) { /* nothing to clean up */ }
        btn.disabled = false;
        btn.textContent = label;
    }
}

// Removes the scratch file from the in-memory filesystem, if it is there.
function FSUnlink(memName) {
    if (!h5wasmPromise) return;
    h5wasmPromise.then(({ FS }) => {
        try { FS.unlink(memName); } catch (ignored) { /* already gone */ }
    });
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

// --- Comment markers on the plot ---------------------------------------
// Drawn for the active dataset only: with several datasets loaded, every run
// of every file would bury the curves.
const CommentMarkersPlugin = {
    id: 'commentMarkers',
    afterDatasetsDraw(chart) {
        const ds = getActive();
        if (!ds || !ds.visible || !commentMarkersOn()) return;
        const runs = commentRuns(ds);
        if (runs.length === 0) return;

        const xScale = chart.scales.x;
        const area = chart.chartArea;
        if (!xScale || !area) return;

        const div = unitDivisor();
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '11px sans-serif';
        ctx.textBaseline = 'top';

        runs.forEach((run, i) => {
            const px = xScale.getPixelForValue((ds.tSec[run.start] + ds.xOffsetSec) / div);
            if (!Number.isFinite(px) || px < area.left || px > area.right) return;

            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = hexToRgba(ds.baseColor, 0.8);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, area.top);
            ctx.lineTo(px, area.bottom);
            ctx.stroke();
            ctx.setLineDash([]);

            const text = run.text.length > 24 ? run.text.slice(0, 23) + '...' : run.text;
            const w = ctx.measureText(text).width + 8;
            const ty = area.top + 4 + (i % 3) * 16;      // stagger, to limit overlap
            const tx = (px + 3 + w > area.right) ? px - w - 3 : px + 3;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
            ctx.fillRect(tx, ty, w, 14);
            ctx.strokeStyle = hexToRgba(ds.baseColor, 0.6);
            ctx.strokeRect(tx, ty, w, 14);
            ctx.fillStyle = '#222222';
            ctx.fillText(text, tx + 4, ty + 2);
        });
        ctx.restore();
    }
};
Chart.register(CommentMarkersPlugin);

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

    // Chart.js has no legend double-click hook, so hit-test the legend boxes
    // ourselves. The two single clicks that precede it toggle visibility twice,
    // leaving it unchanged.
    document.getElementById('sensorChart').addEventListener('dblclick', (ev) => {
        const legend = sensorChart.legend;
        if (!legend || !legend.legendHitBoxes) return;
        const rect = sensorChart.canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        for (let i = 0; i < legend.legendHitBoxes.length; i++) {
            const b = legend.legendHitBoxes[i];
            if (px >= b.left && px <= b.left + b.width && py >= b.top && py <= b.top + b.height) {
                ev.preventDefault();
                renameCurveAt(legend.legendItems[i].datasetIndex);
                return;
            }
        }
    });

    // --- Dataset selection ---
    document.getElementById('activeDatasetSelect').addEventListener('change', function () {
        setActive(parseInt(this.value, 10));
    });
    document.getElementById('clearButton').addEventListener('click', clearAll);
    document.getElementById('saveSessionButton').addEventListener('click', saveSession);

    // --- Label + colours ---
    document.getElementById('dsLabelInput').addEventListener('change', function () {
        const ds = getActive();
        if (!ds) return;
        ds.label = this.value.trim() || ds.name.replace(/\.csv$/i, '');
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
    document.getElementById('saveH5Button').addEventListener('click', exportToHdf5);

    // --- Series selection ---
    document.getElementById('showCommentsCheckbox').addEventListener('change', () => sensorChart.update());

    document.querySelectorAll('.data-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            renderCurveStyles();
            rebuildChart();
        });
    });
});
