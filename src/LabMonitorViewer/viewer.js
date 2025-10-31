let version = "2025.10.31.2";
let sensorChart;
let hoveredDataIndex = -1;

// This object will store ALL data points, just like before.
const chartDataStore = {
    labels: [],      // Array of Date objects (for the chart)
    isoLabels: [],   // Array of ISO strings (for CSV)
    sens1_Temp: [],
    sens1_RH: [],
    sens1_WBT: [],
    sens2_Temp: [],
    sens2_RH: [],
    userComments: []
};

// --- Utility ---
function getWebBulbTemp(temp, rh, type) {
    if (type === 'sensor') {
        const T = parseFloat(temp);
        const RH = parseFloat(rh);
        if (isNaN(T) || isNaN(RH)) {
            return "--";
        }
        let term1 = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659));
        let term2 = Math.atan(T + RH);
        let term3 = Math.atan(RH - 1.676331);
        let term4 = 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH);
        let term5 = 4.686035;
        let Tw = term1 + term2 - term3 + term4 - term5;
        return Tw.toFixed(1);
    } else {
        return "--";
    }
}

// --- Chart Initialization ---
function initChart() {
    const ctx = document.getElementById('sensorChart').getContext('2d');
    sensorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], 
            datasets: []
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'second',
                        displayFormats: {
                            second: 'HH:mm:ss'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Value'
                    },
                    beginAtZero: false
                }
            },
            onHover: (event, elements, chart) => {
                if (elements.length > 0) {
                    // Update the global index if an element is hovered
                    hoveredDataIndex = elements[0].index;
                } else {
                    // Reset the global index if the mouse moves off a point
                    hoveredDataIndex = -1;
                }
                // Force a chart redraw to update the plugin text
                chart.draw(); 
            },
            plugins: {
                tooltip: {
                    enabled: false
                },
                legend: {
                    position: 'top',
                },
                zoom: {
                    zoom: {
                        wheel: {
                            enabled: false, // Optional: You can enable this for mouse wheel zoom
                        },
                        pinch: {
                            enabled: false, // Optional: Enable for touch devices
                        },
                        drag: { // This enables the box-select zoom
                            enabled: true, // Start with drag zoom disabled
                            borderColor: 'rgba(60, 60, 60, 0.5)',
                            borderWidth: 1,
                            backgroundColor: 'rgba(60, 60, 60, 0.2)',
                            modifierKey: null,
                        },
                        mode: 'xy', // Zoom only on the X (time) axis
                    },
                    pan: {
                        enabled: true, // Start with pan disabled
                        mode: 'xy',      // Pan only on the X (time) axis
                        modifierKey: null,
                    }
                },
            },
            scales: {
                x: {
                    type: 'time',
                }
            },
            animation: false
        }
    });
}

// --- Function to fetch and process data ---
async function fetchAndDisplayData() {
    const startInput = document.getElementById('startDate').value;
    const endInput = document.getElementById('endDate').value;

    if (!startInput || !endInput) {
        alert("Please select both a start and end date.");
        return;
    }

    // Convert local datetime-local input to ISO strings
    const startDate = new Date(startInput + 'Z').toISOString();
    const endDate = new Date(endInput + 'Z').toISOString();

    const API_ENDPOINT = `/LabMonitorDB/api/get-data?start=${startDate}&end=${endDate}`;
    
    console.log(`Fetching data from: ${API_ENDPOINT}`);
    document.getElementById('fetchDataButton').textContent = "Loading...";

    try {
        const response = await fetch(API_ENDPOINT);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || `Server responded with ${response.status}`);
        }
        
        const dataArray = await response.json();
        console.log(`Received ${dataArray.length} data points.`);

        // 1. Clear existing plot data
        clearPlot();

        // 2. Loop through new data and populate the store
        dataArray.forEach(point => {
            //const timestamp = new Date(point.datetime_utc_pico);
            const timestamp = new Date(Math.round(point.UTC / 1e6));
            const s1_WBT_string = getWebBulbTemp(point.sens1_Temp, point.sens1_RH, point.sens1_type);

            chartDataStore.labels.push(timestamp);
            chartDataStore.isoLabels.push(point.datetime_utc_pico);
            chartDataStore.sens1_Temp.push(parseFloat(point.sens1_Temp) || null);
            chartDataStore.sens1_RH.push(parseFloat(point.sens1_RH) || null);
            chartDataStore.sens1_WBT.push(parseFloat(s1_WBT_string) || null);
            chartDataStore.sens2_Temp.push(parseFloat(point.sens2_Temp) || null);
            chartDataStore.sens2_RH.push(parseFloat(point.sens2_RH) || null);
            chartDataStore.userComments.push(point.user_comment || "");
        });

        // 3. Update the chart with all new data
        updateVisibleDatasets();
        
        // --- NEW: Explicitly Set X-Axis Bounds to Full Data Range ---
        if (chartDataStore.labels.length > 0) {
            const firstTimestamp = chartDataStore.labels[0];
            const lastTimestamp = chartDataStore.labels.at(-1);
            
            // Set the min/max bounds for the X-axis
            sensorChart.options.scales.x.min = firstTimestamp;
            sensorChart.options.scales.x.max = lastTimestamp;

            // Force a chart update to apply the new bounds
            sensorChart.update('none'); // 'none' is often faster for options change

            // Ensure zoom is reset to show the full defined range
            sensorChart.resetZoom();
            console.log("X-Axis bounds set and zoom reset.");
        }

    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`Error fetching data: ${error.message}`);
    } finally {
        document.getElementById('fetchDataButton').textContent = "Fetch Data";
    }
}

// --- Update Visible DataSets ---
function updateVisibleDatasets() {
    const checkboxes = document.querySelectorAll('.data-checkbox');
    const newDatasets = [];

    checkboxes.forEach(cb => {
        if (cb.checked) {
            const key = cb.dataset.key; 
            const color = cb.dataset.color;
            
            newDatasets.push({
                label: key,
                data: chartDataStore[key],
                borderColor: color,
                backgroundColor: color,
                fill: false,
                tension: 0.1,
                pointRadius: 2
            });
        }
    });

    sensorChart.data.datasets = newDatasets;
    sensorChart.data.labels = chartDataStore.labels; 
    sensorChart.update();
}

// --- Clear Plot ---
function clearPlot() {
    chartDataStore.labels = [];
    chartDataStore.isoLabels = [];
    chartDataStore.sens1_Temp = [];
    chartDataStore.sens1_RH = [];
    chartDataStore.sens1_WBT = [];
    chartDataStore.sens2_Temp = [];
    chartDataStore.sens2_RH = [];

    sensorChart.data.labels = [];
    sensorChart.data.datasets.forEach(dataset => {
        dataset.data = [];
    });
    sensorChart.update();
    console.log("Plot cleared.");
}

// --- Export Functions ---
function exportToPng() {
    const link = document.createElement('a');
    sensorChart.options.animation = false;
    sensorChart.options.plugins.title = { display: true, text: 'LabMonitor Sensor Data' };
    sensorChart.update();
    sensorChart.options.plugins.backgroundColor = 'white';

    link.href = sensorChart.toBase64Image();
    link.download = chartDataStore.isoLabels.at(-1)+'_sensor-plot.png';
    link.click();

    sensorChart.options.plugins.title = { display: false };
    sensorChart.options.plugins.backgroundColor = null;
    sensorChart.update();
}

function exportToCsv() {
    const headers = ['timestamp', 'sens1_Temp', 'sens1_RH', 'sens1_WBT', 'sens2_Temp', 'sens2_RH'];
    let csvContent = "data:text/csv;charset=utf-8," + headers.join(',') + "\n";

    for (let i = 0; i < chartDataStore.isoLabels.length; i++) {
        const row = [
            chartDataStore.isoLabels[i],
            chartDataStore.sens1_Temp[i],
            chartDataStore.sens1_RH[i],
            chartDataStore.sens1_WBT[i], 
            chartDataStore.sens2_Temp[i],
            chartDataStore.sens2_RH[i]
        ];
        csvContent += row.join(',') + "\n";
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', chartDataStore.isoLabels.at(-1)+'_sensor-data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Function to toggle between Pan and Box Zoom modes
function toggleZoomMode() {
    const isPanEnabled = sensorChart.options.plugins.zoom.pan.enabled;
    
    // Toggle the drag zoom setting
    sensorChart.options.plugins.zoom.pan.enabled = !isPanEnabled;
    
    // Disable pan mode when drag zoom is enabled
    sensorChart.options.plugins.zoom.zoom.drag.enabled = isPanEnabled;
    
    const canvas = document.getElementById('sensorChart');
    const zoomButton = document.getElementById('zoomButton');
    
    if (sensorChart.options.plugins.zoom.zoom.drag.enabled) {
        // CURRENT Mode: Drag-to-Zoom
        zoomButton.textContent = "Zoom (Click to Pan)";
        zoomButton.style.backgroundColor = '#006400'; // Green
        zoomButton.style.borderColor = '#006400';
        canvas.style.cursor = 'crosshair';
        console.log("Drag Zoom mode activated.");
    } else {
        // CURRENT Mode: Pan
        zoomButton.textContent = "Pan (Click to Zoom)";
        zoomButton.style.backgroundColor = '#155084'; // Blue
        zoomButton.style.borderColor = '#155084';
        canvas.style.cursor = 'move'; // For Pan
        console.log("Pan mode activated.");
    }

    sensorChart.update('none'); 
}

// Function to reset the zoom
function resetZoom() {
    sensorChart.resetZoom();
    console.log("Zoom reset.");
}

// --- Page Load Event ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("version").textContent = version;
    
    // --- Get Element References ---
    const fetchDataBtn = document.getElementById('fetchDataButton');
    const clearBtn = document.getElementById('clearButton');
    const pngBtn = document.getElementById('savePngButton');
    const csvBtn = document.getElementById('saveCsvButton');
    const zoomBtn = document.getElementById('zoomButton');
    const resetZoomBtn = document.getElementById('resetZoomButton'); 
    const checkboxes = document.querySelectorAll('.data-checkbox');
    
    const canvas = document.getElementById('sensorChart');

    // --- Initialize the Chart ---
    initChart();
    updateVisibleDatasets(); 

    // Initialize the Zoom button text and state
    toggleZoomMode();

    // --- Add Event Listeners ---
    fetchDataBtn.addEventListener('click', fetchAndDisplayData);
    clearBtn.addEventListener('click', clearPlot);
    pngBtn.addEventListener('click', exportToPng);
    csvBtn.addEventListener('click', exportToCsv);
    zoomBtn.addEventListener('click', toggleZoomMode); // NEW
    resetZoomBtn.addEventListener('click', resetZoom); // NEW

    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateVisibleDatasets);
    });

    // --- Set default date range (e.g., last 24 hours) ---
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 1); // 24 hours ago

    // Format for datetime-local input (YYYY-MM-DDTHH:MM)
    const toLocalISOString = (date) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
        return localISOTime;
    };

    document.getElementById('startDate').value = toLocalISOString(startDate);
    document.getElementById('endDate').value = toLocalISOString(endDate);
});

const FixedInfoPlugin = {
    id: 'fixedInfoDisplay',
    afterDraw(chart, args, options) {
        if (hoveredDataIndex === -1) {
            return; // Only draw if a point is hovered
        }

        const ctx = chart.ctx;
        const { chartArea, width, height } = chart;
        
        // --- Get Data for the Hovered Index ---
        const index = hoveredDataIndex;
        const timeLabel = chartDataStore.labels[index]?.toLocaleTimeString() || "N/A";
        const temp1 = chartDataStore.sens1_Temp[index];
        const wbt1 = chartDataStore.sens1_WBT[index];
        const rh1 = chartDataStore.sens1_RH[index];
        const temp2 = chartDataStore.sens2_Temp[index];
        const comment = (chartDataStore.userComments[index] || "").trim();

        // --- Prepare Text Lines ---
        let lines = [
            `Time: ${timeLabel}`,
            `S1 Temp: ${temp1 !== null ? temp1 + ' °C' : '--'}`,
            `S1 WBT: ${wbt1 !== null ? wbt1 + ' °C' : '--'}`,
            `S1 RH: ${rh1 !== null ? rh1 + ' %' : '--'}`,
            `S2 Temp: ${temp2 !== null ? temp2 + ' °C' : '--'}`,
        ];
        
        // Add comment only if it exists and isn't the default placeholder
        if (comment.length > 0 && comment.toUpperCase() !== "NO COMMENT") {
            lines.push(`Comment: "${comment}"`);
        }

        // --- Draw the Box ---
        const lineHeight = 18;
        const padding = 10;
        const boxWidth = 250;
        const boxHeight = (lines.length * lineHeight) + (padding * 2);
        
        // Position the box in the bottom-left corner
        const x = chartArea.left;
        const y = chartArea.bottom - boxHeight;

        // Draw background box
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(x, y, boxWidth, boxHeight);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(x, y, boxWidth, boxHeight);

        // --- Draw the Text ---
        ctx.font = '14px sans-serif';
        ctx.fillStyle = 'black';
        ctx.textAlign = 'left';
        
        lines.forEach((line, i) => {
            ctx.fillText(
                line, 
                x + padding, 
                y + padding + (i * lineHeight) + 14 // 14 for font height adjustment
            );
        });
    }
};

// Register the plugin
Chart.register(FixedInfoPlugin);
