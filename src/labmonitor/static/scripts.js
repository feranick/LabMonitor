let sensorChart;
let intervalId;
let isCollecting = true;

// This object will store ALL data points, even for hidden datasets.
const chartDataStore = {
    labels: [],       // Array of Date objects (for the chart)
    isoLabels: [],    // Array of ISO strings (for CSV)
    sens1_Temp: [],
    sens1_RH: [],
    sens1_WBT: [],
    sens2_Temp: [],
    sens2_RH: []
};

////////////////////////////////////
// Get and format Date and Time (Copied from original)
//////////////////////////////////// 
function getCurrentDateTimeUTC(UTC) {
    const dateObject = new Date(Math.round(UTC / 1e6));
    return dateObject.toLocaleString();
}

//////////////////////////////////////////////
// Utilities (Copied from original)
//////////////////////////////////////////////
function getWebBulbTemp(temp, rh, type) {
    if (type === 'sensor') {
        const T = parseFloat(temp);
        const RH = parseFloat(rh);
        // Handle invalid inputs (e.g., if parseFloat fails or rh is "--")
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
    }
    else {
        return "--";
    }
}

//////////////////////////////////////////////
// Chart Initialization
//////////////////////////////////////////////
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
                }
            },
            animation: false
        }
    });
}

//////////////////////////////////////////////
// Get Data from Pico (Your function)
//////////////////////////////////////////////
async function fetchData() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching status:', error);
        stopInterval();
        document.getElementById("toggleButton").textContent = "Start (Error)";
        document.getElementById("toggleButton").classList.add("stopped");
    }
}

//////////////////////////////////////////////
// Main Plot Update Logic
//////////////////////////////////////////////
async function updatePlot() {
    if (!isCollecting) return; 

    const data = await fetchData();
    if (!data) return; 

    const timestamp = new Date(Math.round(data.UTC / 1e6));

    // --- 1. Calculate all values ---
    const datetime = getCurrentDateTimeUTC(data.UTC);
    const s1_Temp = parseFloat(data.sens1_Temp) || null;
    const s1_RH = parseFloat(data.sens1_RH) || null;
    const s2_Temp = parseFloat(data.sens2_Temp) || null;
    const s2_RH = parseFloat(data.sens2_RH) || null;
    const s1_WBT_string = getWebBulbTemp(data.sens1_Temp, data.sens1_RH, data.sens1_type);
    const s1_WBT = parseFloat(s1_WBT_string) || null; 


    // --- 2. Store data in our master history object ---
    chartDataStore.labels.push(timestamp);
    chartDataStore.isoLabels.push(timestamp.toISOString());
    chartDataStore.sens1_Temp.push(s1_Temp);
    chartDataStore.sens1_RH.push(s1_RH);
    chartDataStore.sens1_WBT.push(s1_WBT);
    chartDataStore.sens2_Temp.push(s2_Temp);
    chartDataStore.sens2_RH.push(s2_RH);

    // --- 3. Update the chart's shared X-axis ---
    sensorChart.data.labels.push(timestamp);

    // --- 4. Push new data ONLY to active datasets ---
    sensorChart.data.datasets.forEach(dataset => {
        const key = dataset.label;
        if (key === 'sens1_Temp') dataset.data.push(s1_Temp);
        if (key === 'sens1_RH') dataset.data.push(s1_RH);
        if (key === 'sens1_WBT') dataset.data.push(s1_WBT);
        if (key === 'sens2_Temp') dataset.data.push(s2_Temp);
        if (key === 'sens2_RH') dataset.data.push(s2_RH);
    });

    // --- 5. Redraw the chart ---
    sensorChart.update('none'); 

    // --- 6. UPDATE CURRENT MEASUREMENTS ---
    document.getElementById("datetime_current").textContent = datetime;
    document.getElementById("sens1_Temp_current").textContent = data.sens1_Temp + " \u00B0C";
    document.getElementById("sens1_Temp_current").style.color = "#00008B";
    document.getElementById("sens1_RH_current").textContent = data.sens1_RH + "%";
    document.getElementById("sens1_WBT_current").textContent = s1_WBT_string + " \u00B0C"; 
    document.getElementById("sens2_Temp_current").textContent = data.sens2_Temp + " \u00B0C";
    document.getElementById("sens2_Temp_current").style.color = "#00008B";
    document.getElementById("ip_address").textContent = data.ip;
    document.getElementById("version").textContent = data.version;
    if (data.sens1_type != "sensor") {
        document.getElementById("sens1_Temp_current").style.color = "red";
        }
        
    if (data.sens2_type != "sensor") {
        document.getElementById("sens2_Temp_current").style.color = "red";
        }
}

//////////////////////////////////////////////
// Show/Hide Datasets based on Checkboxes
//////////////////////////////////////////////
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

//////////////////////////////////////////////
// Interval (Timer) Controls
//////////////////////////////////////////////
function startInterval() {
    stopInterval(); 
    
    const rateInput = document.getElementById("refreshRate");
    const refreshRate = (parseInt(rateInput.value, 10) || 30) * 1000;
    
    updatePlot(); 
    intervalId = setInterval(updatePlot, refreshRate);
    console.log(`Interval started with rate: ${refreshRate}ms`);
}

function stopInterval() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log("Interval stopped.");
    }
}

// --- NEW FUNCTION ---
//////////////////////////////////////////////
// Clear Plot Data
//////////////////////////////////////////////
function clearPlot() {
    // 1. Clear the master data store
    chartDataStore.labels = [];
    chartDataStore.isoLabels = [];
    chartDataStore.sens1_Temp = [];
    chartDataStore.sens1_RH = [];
    chartDataStore.sens1_WBT = [];
    chartDataStore.sens2_Temp = [];
    chartDataStore.sens2_RH = [];

    // 2. Clear the chart's visible data
    sensorChart.data.labels = [];
    sensorChart.data.datasets.forEach(dataset => {
        dataset.data = [];
    });

    // 3. Redraw the empty chart
    sensorChart.update();
    console.log("Plot cleared.");
}
// --- END NEW FUNCTION ---


//////////////////////////////////////////////
// Export Functions
//////////////////////////////////////////////
function exportToPng() {
    const link = document.createElement('a');
    sensorChart.options.animation = false;
    sensorChart.options.plugins.title = { display: true, text: 'LabMonitor Sensor Data' };
    sensorChart.update();
    sensorChart.options.plugins.backgroundColor = 'white';

    link.href = sensorChart.toBase64Image();
    link.download = 'sensor-plot.png';
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
    link.setAttribute('download', 'sensor-data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


//////////////////////////////////////////////
// Page Load Event
//////////////////////////////////////////////
document.addEventListener('DOMContentLoaded', () => {
    // --- Get Element References ---
    const toggleBtn = document.getElementById('toggleButton');
    const clearBtn = document.getElementById('clearButton'); // <-- NEW
    const refreshInput = document.getElementById('refreshRate');
    const pngBtn = document.getElementById('savePngButton');
    const csvBtn = document.getElementById('saveCsvButton');
    const checkboxes = document.querySelectorAll('.data-checkbox');
    const sUIBtn = document.getElementById('simpleUIBtn');
    
    // --- Initialize the Chart ---
    initChart();

    // --- Set up initial datasets ---
    updateVisibleDatasets();

    // --- Start Data Collection ---
    isCollecting = true;
    startInterval();

    // --- Add Event Listeners ---
    
    // Start/Stop Button
    toggleBtn.addEventListener('click', () => {
        isCollecting = !isCollecting;
        if (isCollecting) {
            toggleBtn.textContent = 'Stop';
            toggleBtn.classList.remove('stopped');
            startInterval();
        } else {
            toggleBtn.textContent = 'Start';
            toggleBtn.classList.add('stopped');
            stopInterval();
        }
    });

    // Clear Button (NEW)
    clearBtn.addEventListener('click', clearPlot);

    // Refresh Rate Input
    refreshInput.addEventListener('change', () => {
        if (isCollecting) {
            startInterval();
        }
    });

    // Checkboxes
    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateVisibleDatasets);
    });

    // Export Buttons
    pngBtn.addEventListener('click', exportToPng);
    csvBtn.addEventListener('click', exportToCsv);
    
    sUIBtn.addEventListener('click', function() {
        window.location.href = '/simple.html';
    });
    
});
