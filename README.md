# LabMonitor

Uses a Raspberyy Pico to monitor environmental data (temperature, relative humidity and pressure) from two sensors, with web-based UI. Different operational versions are avalable.

## Real-time single measurement

This displays the current measurements by redirecting the browser to the device `URL/simple.html`.

## Real-time multi measurement plotter with data saving

For more sophistcated measurements, when directing the browser to the device URL, in addition to the current measurements, periodic measurements can be acquired and plotted. The plot has zooming/panning/saving capability and the data can be saved as CSV. Optionally, the data can be saved to a remote server running `mongoDB`. The remote served needs to be set up to allow the PICO to interact with the database via `pymongo` and `flask`. Refer to the README.md inside `src/LabMonitorServer` for details. 

The data that is saved in the database can be retrieved remotely using the `LabMonitorViewer`


