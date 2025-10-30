let sensorChart;
let intervalId;
let isCollecting = false;
let submitToMongo = true;

// This object will store ALL data points, even for hidden datasets.
const chartDataStore = {
    labels: [],       // Array of Date objects (for the chart)
    isoLabels: [],    // Array of ISO strings (for CSV)
    sens1_Temp: [],
    sens1_RH: [],
    sens1_WBT: [],
    sens2_Temp: [],
    sens2_RH: [],
    userComments: []
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
                    callbacks: {
                        label: customTooltipLabel, // Keep your existing label function
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
async function updatePlot(flag) {
    if (!isCollecting  && flag) return;

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
    
    const commentElement = document.getElementById('userComment');
    let userComment = "No comment"; // Default value

    if (commentElement && commentElement.value) {
        userComment = commentElement.value.trim();
        if (userComment === "") {
            userComment = "No comment";
        }
    }
    
    console.log(userComment);
    
    // --- 2. UPDATE CURRENT MEASUREMENTS ---
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
    
    if (flag == true) {
        // --- 3. Store data in our master history object ---
        chartDataStore.labels.push(timestamp);
        chartDataStore.isoLabels.push(timestamp.toISOString());
        chartDataStore.sens1_Temp.push(s1_Temp);
        chartDataStore.sens1_RH.push(s1_RH);
        chartDataStore.sens1_WBT.push(s1_WBT);
        chartDataStore.sens2_Temp.push(s2_Temp);
        chartDataStore.sens2_RH.push(s2_RH);
        chartDataStore.userComments.push(userComment);

        // --- 4. Update the chart's shared X-axis ---
        sensorChart.data.labels.push(timestamp);

        // --- 5. Push new data ONLY to active datasets ---
        sensorChart.data.datasets.forEach(dataset => {
            const key = dataset.label;
            if (key === 'sens1_Temp') dataset.data.push(s1_Temp);
            if (key === 'sens1_RH') dataset.data.push(s1_RH);
            if (key === 'sens1_WBT') dataset.data.push(s1_WBT);
            if (key === 'sens2_Temp') dataset.data.push(s2_Temp);
            if (key === 'sens2_RH') dataset.data.push(s2_RH);
        });

        // --- 6. Redraw the chart ---
        sensorChart.update('none');
    
        // Clean data and submit to MongoDB
        if (document.getElementById('submitMongo-checkbox').checked) {
            submitData(data);
            }
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
    
    updatePlot(true);
    //intervalId = setInterval(updatePlot, refreshRate);
    intervalId = setInterval( () => {
        updatePlot(true);
        },
        refreshRate
    );
    console.log(`Interval started with rate: ${refreshRate}ms`);
}

function stopInterval() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log("Interval stopped.");
    }
}

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

//////////////////////////////////////////////
// Clones the data and removes sensitive keys.
// @param {object} data - The data object received from the Pico.
// @returns {object} The cleaned data object ready for submission.
//////////////////////////////////////////////
function cleanAndAugmentData(data) {
    const cleanData = { ...data };
    
    const EXCLUDED_KEYS = ["mongoURL"];
    EXCLUDED_KEYS.forEach(key => {
        delete cleanData[key];
    });
    
    const comment = document.getElementById('userComment').value.trim();
    if (comment) {
        cleanData['user_comment'] = comment;
    } else {
        cleanData['user_comment'] = "";
    }
            
    cleanData['client_submission_time'] = Date.now();
    return cleanData;
}

//////////////////////////////////////////////
// Submits the CLEANED JSON data to the defined server endpoint using the Fetch API.
// @param {object} data - The sensor data object to send.
//////////////////////////////////////////////
async function submitData(data) {
    const cleanData = cleanAndAugmentData(data);
    console.log(cleanData);
    const FLASK_API_PATH = "/LabMonitorDB/api/submit-sensor-data";
    const SERVER_BASE_URL = data.mongoURL;
    const FULL_ENDPOINT_URL = SERVER_BASE_URL + FLASK_API_PATH;
            
    console.log(`Submitting data to ${FULL_ENDPOINT_URL}...`);

    const maxRetries = 3;
    let success = false;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(FULL_ENDPOINT_URL, {
                method: 'POST',
                headers: {
                'Content-Type': 'application/json',
                },
                body: JSON.stringify(cleanData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`Success! Data sent to server endpoint. Response: ${JSON.stringify(result)}`);
                success = true;
                break;
            } else {
                console.error(`Attempt ${attempt + 1}: Server responded with status ${response.status}`);
                if (attempt < maxRetries - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

        } catch (error) {
            console.error(`Attempt ${attempt + 1}: Network error during submission:`, error);
            if (attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    if (!success) {
        console.log(`Error: Failed to submit data after ${maxRetries} attempts. Check server endpoint and console for details.`);
    }
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
    
    // --- Get/Display current data ---
    updatePlot(false);

    // --- Set up initial datasets ---
    updateVisibleDatasets();

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

    // Clear Button
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
