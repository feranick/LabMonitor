let coords = null;
let intervalId;
let isCollecting = false;
let submitToMongo = true;

////////////////////////////////////
// Get and format Date and Time
////////////////////////////////////   
function getCurrentDateTimeUTC(UTC) {
    const dateObject = new Date(Math.round(UTC/1e6));
    return dateObject.toLocaleString();
    }

////////////////////////////////////
// Get feed from DB - generic
////////////////////////////////////
async function getFeed(url) {
    const res = await fetch(url);
    const obj = await res.json();
    return obj;
    }

//////////////////////////////////////////////
// Ger Local Data from Pico
//////////////////////////////////////////////
async function fetchData(flag) {
    try {
        url = '/api/status?submitMongo='+flag
        console.log(`Requesting data with: `+ url);
        const response = await fetch(url);
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
// Logic when pushing Update Status button
//////////////////////////////////////////////
async function updateStatus(flag) {
    document.getElementById("Status").disabled = true;
    document.getElementById("Status").value = "Loading...";
    //document.getElementById("warnLabel").textContent = "Testing";
    
    const data = await fetchData(flag);
    if (!data) return;
    console.log(data);
    
    datetime = getCurrentDateTimeUTC(data.UTC);
    
    document.getElementById("sens1_Temp").textContent = data.sens1_Temp + " \u00B0C";
    document.getElementById("sens1_Temp").style.color = "#00008B";
    document.getElementById("sens1_RH").textContent = data.sens1_RH + "%";
    document.getElementById("sens1_WBT").textContent = getWetBulbTemp(data.sens1_Temp, data.sens1_RH, data.sens1_type) + " \u00B0C";

    document.getElementById("sens2_Temp").textContent = data.sens2_Temp + " \u00B0C";
    document.getElementById("sens2_Temp").style.color = "#00008B";
    document.getElementById("sens3_Temp").textContent = data.sens3_Temp + " \u00B0C";
    document.getElementById("sens3_Temp").style.color = "#00008B";
    
    //document.getElementById("sens2_RH").textContent = data.sens2_RH + " %";
    if (data.sens1_type != "sensor") {
        document.getElementById("sens1_Temp").style.color = "red";
        }
        
    if (data.sens2_type != "sensor") {
        document.getElementById("sens2_Temp").style.color = "red";
        }
        
    if (data.sens2_type != "sensor") {
        document.getElementById("sens3_Temp").style.color = "red";
        }

    document.getElementById("datetime").textContent = datetime;
    document.getElementById("ip_address").textContent = data.ip;
    document.getElementById("version").textContent = data.version;

    //document.getElementById("warnLabel").textContent = "Update Status: \n Ready";
    document.getElementById("Status").value = "Update";
    document.getElementById("warnLabel").textContent = "";
    document.getElementById("Status").disabled = false;
}

//document.addEventListener('DOMContentLoaded', updateStatus, "false");
document.addEventListener('DOMContentLoaded', function() {

    const refreshRateInput = document.getElementById("refreshRate");
    const pUIBtn = document.getElementById('plotterUIBtn');
    
    updateStatus(false);
    
    const startOrRestartInterval = () => {
        if (intervalId) {
            clearInterval(intervalId);
            console.log("Stopped old interval.");
        }
        const rawValue = parseInt(refreshRateInput.value, 10) || 10;
        const refreshRate = rawValue * 1000;
        intervalId = setInterval(() => updateStatus("false"), refreshRate);
        //intervalId = setInterval(updateStatus, refreshRate, "False");
        console.log(`Set new refresh rate to: ${refreshRate / 1000} seconds`);
    };
    
    pUIBtn.addEventListener('click', function() {
        window.location.href = '/';
    });
    
    startOrRestartInterval();
    refreshRateInput.addEventListener('input', startOrRestartInterval);
});

//setInterval(updateStatus, 30000, "False");

//////////////////////////////////////////////
// Utilities
//////////////////////////////////////////////
function getWetBulbTemp(temp, rh, type) {
    if (type === 'sensor') {
        const T = parseFloat(temp);
        const RH = parseFloat(rh);
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

function getColor(value, ranges, defaultColor = 'white') {
    // Iterate through the array of range definitions
    for (const range of ranges) {
        if (value >= range.min && value <= range.max) {
            return range.color; // Return the color for the first matching range
        }
    }
    return defaultColor;
}
