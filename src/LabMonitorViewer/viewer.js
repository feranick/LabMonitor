let version = "2025.10.30.1";
let sensorChart;

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

// --- Utility (Copied from your scripts.js) ---
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

// --- Chart Initialization (Copied from your scripts.js) ---
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
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: customTooltipLabel,
                        footer: customTooltipFooter
                    }
                }
            },
            animation: false
        }
    });
}

/**
 * Generates the content for each line item in the tooltip.
 * The custom data (like WBT or related RH/Temp) is fetched from chartDataStore.
 */
function customTooltipLabel(context) {
    const dataIndex = context.dataIndex; // The index of the data point
    const datasetKey = context.dataset.label; // e.g., 'sens1_Temp'
    let lines = [];

    // --- 1. Get the primary value and label (Chart.js default line) ---
    let label = context.dataset.label + ': ' + context.formattedValue;
    lines.push(label); 

    // --- 2. Add extra data based on the dataset being hovered ---
    if (datasetKey.includes('sens1')) {
        // Show Sensor 1 Wet-Bulb Temp (WBT) for all Sensor 1 points
        const wbtValue = chartDataStore.sens1_WBT[dataIndex];
        if (wbtValue !== null) {
            lines.push(`WBT: ${wbtValue} °C`);
        }
        
        // If we're hovering over Temp, show the RH
        if (datasetKey === 'sens1_Temp') {
            const rhValue = chartDataStore.sens1_RH[dataIndex];
            if (rhValue !== null) {
                lines.push(`RH: ${rhValue}%`);
            }
        }
    }
    // similar logic for Sensor 2 here if needed.
    return lines; 
}

function customTooltipFooter(tooltipItems) {
    if (!tooltipItems || tooltipItems.length === 0) {
        return '';
    }
    
    const dataIndex = tooltipItems[0].dataIndex;
    const storedComment = chartDataStore.userComments[dataIndex];
    
    const cleanComment = (storedComment || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
        
    // Check if the stored comment is valid AND not our default placeholder
    if (cleanComment.length > 0 && cleanComment.toUpperCase() !== "NO COMMENT") {
        return [
            '', 
            'User Comment:', 
            `"${cleanComment}"`
        ];
    }
    return ''; 
}

// --- NEW: Function to fetch and process data ---
async function fetchAndDisplayData() {
    const startInput = document.getElementById('startDate').value;
    const endInput = document.getElementById('endDate').value;

    if (!startInput || !endInput) {
        alert("Please select both a start and end date.");
        return;
    }

    // Convert local datetime-local input to ISO strings
    const startDate = new Date(startInput).toISOString();
    const endDate = new Date(endInput).toISOString();

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
            const timestamp = new Date(point.datetime_utc_pico);
            const s1_WBT_string = getWebBulbTemp(point.sens1_Temp, point.sens1_RH, point.sens1_type);

            chartDataStore.labels.push(timestamp);
            chartDataStore.isoLabels.push(point.datetime_utc_pico);
            chartDataStore.sens1_Temp.push(parseFloat(point.sens1_Temp) || null);
            chartDataStore.sens1_RH.push(parseFloat(point.sens1_RH) || null);
            chartDataStore.sens1_WBT.push(parseFloat(s1_WBT_string) || null);
            chartDataStore.sens2_Temp.push(parseFloat(point.sens2_Temp) || null);
            chartDataStore.sens2_RH.push(parseFloat(point.sens2_RH) || null);
            chartDataStore.userComments.push(point.user_comment) || null);
        });

        // 3. Update the chart with all new data
        updateVisibleDatasets();

    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`Error fetching data: ${error.message}`);
    } finally {
        document.getElementById('fetchDataButton').textContent = "Fetch Data";
    }
}

// --- (Copied from your scripts.js) ---
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

// --- (Copied from your scripts.js) ---
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

// --- Export Functions (Copied from your scripts.js) ---
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


// --- NEW: Page Load Event ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("version").textContent = version;
    
    // --- Get Element References ---
    const fetchDataBtn = document.getElementById('fetchDataButton');
    const clearBtn = document.getElementById('clearButton');
    const pngBtn = document.getElementById('savePngButton');
    const csvBtn = document.getElementById('saveCsvButton');
    const checkboxes = document.querySelectorAll('.data-checkbox');

    // --- Initialize the Chart ---
    initChart();
    updateVisibleDatasets(); // Show an empty chart

    // --- Add Event Listeners ---
    fetchDataBtn.addEventListener('click', fetchAndDisplayData);
    clearBtn.addEventListener('click', clearPlot);
    pngBtn.addEventListener('click', exportToPng);
    csvBtn.addEventListener('click', exportToCsv);

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
