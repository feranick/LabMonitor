# LabMonitor

LabMonitor uses a Raspberry Pi Pico (Pico W / Pico 2 W, running CircuitPython) to monitor
environmental data — temperature, relative humidity, and pressure — from up to three sensors,
with a web-based UI. Measurements can be viewed live, plotted over time, exported locally as
CSV/PNG, and optionally pushed to a remote MongoDB server for long-term storage and later
retrieval. Several operational modes are available, described below.

## Components

The project is organized under `src/`:

- **`LabMonitorPico/`** — CircuitPython firmware (`code.py`), device configuration
  (`settings.toml`), bundled libraries (`lib/`), and the web UI served from the device
  (`static/`, including `index.html` and `simple.html`).
- **`LabMonitorViewer/`** — a standalone web page (`index.html` + `viewer.js`) for retrieving
  and plotting historical data from the remote database.
- **`LabMonitorServer/`** — the remote server side: a Flask / `pymongo` WSGI application,
  Apache configuration, and setup notes. See `src/LabMonitorServer/README.md`.
- **`libSensors/`** — the shared sensor abstraction library (`libSensors.py`) and sensor
  calibration data.
- **`Settings_writer/`** — a helper (`settings_writer_LM.py`) for generating the Pico
  `settings.toml`.
- **`Utilities/`** — small tools, e.g. a RAM checker.
- **`old/`** — a previous, client-driven implementation, kept for reference.

## Operational modes

### Real-time single measurement

Directing a browser to `URL/simple.html` displays the current measurements only, in a minimal
view.

### Real-time multi-measurement plotter with data saving

Directing a browser to the device URL shows the current measurements and, in addition, lets you
acquire and plot periodic measurements. The plot supports zooming, panning, and export: data can
be saved locally as CSV, or the plot as PNG. Optionally, each acquisition is also pushed to a
remote MongoDB server.

The remote server must be set up to accept data from the Pico via `pymongo` and `flask`; refer to
`src/LabMonitorServer/README.md` for details. Data stored in the database can later be retrieved
and plotted with the **LabMonitorViewer**.

## Sensors

Up to three sensors can be configured (`sensor1`, `sensor2`, `sensor3`) in `settings.toml`.
Supported models:

- **BME280** — temperature, humidity, pressure
- **BME680** — temperature, humidity, pressure, gas
- **AHT21** — temperature, humidity
- **ENS160 + AHT21** — air quality with temperature, humidity
- **MCP9808** — temperature
- **MAX31865** — RTD amplifier, temperature

When sensor 1 provides both temperature and humidity, the UI also derives the wet-bulb
temperature and heat index.

## Notable behavior

- **Persistent state across reboots.** The acquisition run/stop state, the user comment, and the
  acquisition interval are stored in the Pico's non-volatile memory (NVM) and restored
  automatically after a reset or power cycle. An unattended device therefore resumes acquiring on
  its own following a transient network drop or power blip, instead of sitting idle until someone
  re-starts it manually.
- **CPU-fallback filtering.** If a sensor fails to return a reading, the firmware falls back to
  the Pico's internal CPU temperature (optionally offset-corrected) so the device keeps
  responding. These CPU-based fallback values are flagged and are **not** submitted to the
  database — neither by the scheduled push nor by the browser page — so spurious fallback spikes
  don't pollute stored data. The live on-device display still shows them (flagged) as an
  indication that a sensor is misbehaving. Fallback readings are identified by a type label
  beginning with `CPU`.
- **Integer-nanosecond scheduling.** Acquisition timing uses `time.monotonic_ns()` to avoid
  floating-point precision drift over long uptimes.

## Configuration

Device settings live in `src/LabMonitorPico/settings.toml`:

- Wi-Fi credentials and CircuitPython web-workflow settings
- `overclock` — enable CPU overclocking (supported on both RP2040 / Pico W and RP2350 / Pico 2 W)
- `sensorN_name`, `sensorN_pins`, `sensorN_correct_temp` for each of the three sensor slots
  (set the name to `"None"` to disable a slot)
- `mongo_url`, `mongo_secret_key`, `cert_path` — remote server connection and TLS certificate
- `device_name` — identifier stored with each record and selectable in the Viewer
- `is_pico_submit_mongo` — enable or disable remote submission

Pin formats: I2C is `SCL,SDA`; SPI is `SCK,MOSI,MISO,CS` (equivalently `CLK,TX,RX,CS`).

`settings.toml` can be generated with `src/Settings_writer/settings_writer_LM.py`.

## Device web endpoints

Served by the Pico:

- `/` — full plotter UI
- `/simple.html` — single-measurement view
- `/api/status` — current sensor readings as JSON (optionally triggers a MongoDB submission)
- `/api/control` — start/stop acquisition, set interval and comment (POST)
- `/api/acquisition_status` — current acquisition state, interval, and comment

## Requirements

- Raspberry Pi Pico W or Pico 2 W running CircuitPython
- The bundled CircuitPython libraries under `src/LabMonitorPico/lib/` (Adafruit sensor drivers,
  HTTP server, NTP, and requests)
- Optional remote storage: a server running MongoDB with the Flask / `pymongo` application in
  `src/LabMonitorServer/`

## Installation (Pico)

1. Flash CircuitPython onto the Pico.
2. Copy the contents of `src/LabMonitorPico/` to the device: `code.py`, `settings.toml`, `lib/`,
   and `static/`.
3. Edit `settings.toml` with your Wi-Fi, sensor, and (optional) remote-server details.
4. Reset the device; it connects to Wi-Fi and serves its UI at the assigned address.

## License

GPL-3.0. See [`LICENSE`](LICENSE).
