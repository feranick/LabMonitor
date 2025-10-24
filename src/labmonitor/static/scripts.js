let coords = null;

////////////////////////////////////
// Get and format Date and Time
////////////////////////////////////
function getCurrentDateTime() {
    function get_dig(a) {
        if (a<10) {
            secs = "0"+a;}
        else {
            secs = a;}
        return secs;}
        
    let now = new Date();
    month = now.getMonth()+1
    day = now.getDate()
    year = now.getFullYear()
    hours = get_dig(now.getHours())
    minutes = get_dig(now.getMinutes())
    
    if (now.getSeconds()<10) {
        secs = "0"+now.getSeconds();}
    else {
        secs = now.getSeconds();}
        
    formattedTime = hours +":"+minutes+":"+secs;
    formattedDate = month+"/"+day+"/"+year;
    return formattedDate+"      "+formattedTime;
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
async function fetchData() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        return data;
        
    } catch (error) {
        console.error('Error fetching status:', error);
        document.getElementById("warnLabel").textContent = "Error: Check connection.";
        // Re-enable buttons even on error, so user can try again
        document.getElementById("Status").disabled = false;
    }
}
//////////////////////////////////////////////
// Logic when pushing Update Status button
//////////////////////////////////////////////
async function updateStatus() {
    document.getElementById("Status").disabled = true;
    document.getElementById("Status").style.backgroundColor = "#155084";
    document.getElementById("Status").value = "Loading...";
    //document.getElementById("warnLabel").textContent = "Testing";
    
    datetime = getCurrentDateTime();
    data = await fetchData();
    console.log(data);
    
    document.getElementById("Status").style.backgroundColor = "navy";

    document.getElementById("sens1_Temp").textContent = data.sens1_Temp + " \u00B0C";
    document.getElementById("sens1_RH").textContent = data.sens1_RH + "%";
    document.getElementById("sens1_WBT").textContent = getWebBulbTemp(data.sens1_Temp, data.sens1_RH, data.sens1_type) + " \u00B0C";

    document.getElementById("sens2_Temp").textContent = data.sens2_Temp + " \u00B0C";
    //document.getElementById("sens2_RH").textContent = data.sens2_RH + " %";

    document.getElementById("datetime").textContent = datetime;
    document.getElementById("ip_address").textContent = data.ip;
    document.getElementById("version").textContent = data.version;

    //document.getElementById("warnLabel").textContent = "Update Status: \n Ready";
    document.getElementById("Status").value = "Update";
    document.getElementById("warnLabel").textContent = "";
    document.getElementById("Status").disabled = false;
}

document.addEventListener('DOMContentLoaded', updateStatus);
setInterval(updateStatus, 30000, "False");

//////////////////////////////////////////////
// Utilities
//////////////////////////////////////////////
function getWebBulbTemp(temp, rh, type) {
    if (type === 'sensor') {
        const T = parseFloat(temp);
        const RH = parseFloat(rh);
        //const T = parseFloat(document.getElementById(temp).value);
        //const RH = parseFloat(document.getElementById(rh).value);
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
