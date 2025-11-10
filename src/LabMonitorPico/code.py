# **********************************************
# * LabMonitor - Rasperry Pico W
# * Pico driven
# * v2025.11.10.1
# * By: Nicola Ferralis <feranick@hotmail.com>
# **********************************************

version = "2025.11.10.1"

import wifi
import time
import microcontroller
import supervisor
import os
import busio
import board
import digitalio
import socketpool
import ssl
import json

import adafruit_requests
from adafruit_httpserver import Server, MIMETypes, Response, GET, POST, JSONResponse

import adafruit_ntp

from libSensors import SensorDevices

is_acquisition_running = False
last_acquisition_time = 0.0
ACQUISITION_INTERVAL = 30.0

############################
# Initial WiFi/Safe Mode Check
############################
if supervisor.runtime.safe_mode_reason is not None:
    try:
        print("Performing initial WiFi radio state check/reset...")
        if wifi.radio.connected:
            print("Radio was connected, disconnecting first.")
            wifi.radio.stop_station()
            time.sleep(0.5)
            wifi.radio.start_station()

        print("Toggling WiFi radio enabled state...")
        wifi.radio.enabled = False
        time.sleep(1.0)
        wifi.radio.enabled = True
        time.sleep(1.0)
        print("Initial WiFi radio toggle complete.")
    except Exception as e:
        print(f"Error during initial WiFi radio toggle: {e}")

############################
# User variable definitions
############################
class Conf:
    def __init__(self):
        try:
            self.sensor1 = os.getenv("sensor1")
            self.sensor1Pins = stringToArray(os.getenv("sensor1Pins"))
            self.sensor1CorrectTemp = os.getenv("sensor1CorrectTemp")
        except ValueError:
            self.sensor1 = None
            self.sensor1Pins = None
            self.sensor1CorrectTemp = "False"
            print(f"Warning: Invalid settings.toml. Using default.")

        try:
            self.sensor2 = os.getenv("sensor2")
            self.sensor2Pins = stringToArray(os.getenv("sensor2Pins"))
            self.sensor2CorrectTemp = os.getenv("sensor2CorrectTemp")
        except ValueError:
            self.sensor2 = None
            self.sensor2Pins = None
            self.sensor2CorrectTemp = "False"
            print(f"Warning: Invalid settings.toml. Using default.")
            
        try:
            self.sensor3 = os.getenv("sensor3")
            self.sensor3Pins = stringToArray(os.getenv("sensor3Pins"))
            self.sensor3CorrectTemp = os.getenv("sensor3CorrectTemp")
        except ValueError:
            self.sensor3 = None
            self.sensor3Pins = None
            self.sensor3CorrectTemp = "False"
            print(f"Warning: Invalid settings.toml. Using default.")

############################
# Server
############################
class LabServer:
    def __init__(self, sensors):
        self.sensors = sensors
        self.ntp = None
        self.server = None
        self.ip = "0.0.0.0"
        
        # Initialize timing for the data loop
        global last_acquisition_time
        last_acquisition_time = time.monotonic()
        
        try:
            self.mongoURL = os.getenv("mongoURL")
            self.mongoSecretKey = os.getenv("mongoSecretKey")
            self.deviceName = os.getenv("deviceName")
            self.certPath = os.getenv("certPath")
            self.isPicoSubmitMongo = os.getenv("isPicoSubmitMongo")
        except:
            self.mongoURL = None
            self.mongoSecretKey = None
            self.deviceName = None
            self.certPath = None
            self.isPicoSubmitMongo = "False"
            
        try:
            self.connect_wifi()
            self.setup_server()
            self.setup_ntp()
            print("\nDevice IP:", self.ip, "\nListening...")
        except RuntimeError as err:
            print(f"Initialization error: {err}")
            self.fail_reboot()
        except Exception as e:
            print(f"Unexpected critical error: {e}")
            self.fail_reboot()

    def fail_reboot(self):
        print("Rebooting in 5 seconds due to error...")
        time.sleep(5)
        self.reboot()

    def connect_wifi(self):
        ssid = os.getenv('CIRCUITPY_WIFI_SSID')
        password = os.getenv('CIRCUITPY_WIFI_PASSWORD')
        if ssid is None or password is None:
            raise RuntimeError("WiFi credentials not found.")

        MAX_WIFI_ATTEMPTS = 5
        attempt_count = 0
        time.sleep(5)
        while not wifi.radio.connected:
            if attempt_count >= MAX_WIFI_ATTEMPTS:
                raise RuntimeError("Failed to connect to WiFi after multiple attempts.")
            print(f"\nConnecting to WiFi (attempt {attempt_count + 1}/{MAX_WIFI_ATTEMPTS})...")
            try:
                wifi.radio.connect(ssid, password)
                time.sleep(2)
            except ConnectionError as e:
                print(f"WiFi Connection Error: {e}")
                time.sleep(5)
            except Exception as e:
                print(f"WiFi other connect error: {e}")
                time.sleep(3)
            attempt_count += 1

        if wifi.radio.connected:
            self.ip = str(wifi.radio.ipv4_address)
            print("WiFi Connected!")
        else:
            raise RuntimeError("Failed to connect to WiFi.")

    def setup_server(self):
        pool = socketpool.SocketPool(wifi.radio)
        self.server = Server(pool, debug=True)
        
        ### Original setup - no local submission
        #self.requests = adafruit_requests.Session(pool, ssl.create_default_context())
        
        ### Submission from Pico with certificate handling
        ssl_context = ssl.create_default_context()
        ROOT_CA_CERT = self.readCert(self.certPath)
        try:
            ssl_context.load_verify_locations(cadata=ROOT_CA_CERT)
            print("Custom Root CA successfully loaded.")
        except Exception as e:
            print(f"Failed to load certificate: {e}")
        self.requests = adafruit_requests.Session(pool, ssl_context)

        # --- Routes ---

        # Root Route: Serves static/index.html
        @self.server.route("/")
        def base_route(request):
            return self._serve_static_file(request, 'static/index.html')
            
        @self.server.route("/simple.html")
        def base_route(request):
            return self._serve_static_file(request, 'static/simple.html')

        # --- Acquisition Control Route ---
        @self.server.route("/api/control", methods=[POST])
        def api_control(request):
            global is_acquisition_running, last_acquisition_time, ACQUISITION_INTERVAL
            
            try:
                data = request.json()
                command = data.get("command", "").lower()
                new_interval = data.get("interval")
                
                # --- Update Interval if provided and valid ---
                if new_interval is not None and isinstance(new_interval, (int, float)) and new_interval >= 1:
                    ACQUISITION_INTERVAL = float(new_interval)
                    print(f"Acquisition interval updated to: {ACQUISITION_INTERVAL}s")

                if command == "start":
                    if not is_acquisition_running:
                        is_acquisition_running = True
                        last_acquisition_time = time.monotonic() # Reset timer on start
                        print("Acquisition: STARTED")
                    message = "Acquisition is now running."
                    
                elif command == "stop":
                    is_acquisition_running = False
                    print("Acquisition: STOPPED")
                    message = "Acquisition is now stopped."
                    
                else:
                    return JSONResponse(request, {"success": False, "message": "Invalid command. Use 'start' or 'stop'."}, status=400)
                    
                return JSONResponse(request, {"success": True, "status": self.get_acquisition_status(), "interval": ACQUISITION_INTERVAL})

            except Exception as e:
                print(f"Error in /api/control: {e}")
                return JSONResponse(request, {"success": False, "message": f"Server error: {e}"}, status=500)

        # --- Acquisition Status Route (for UI sync) ---
        @self.server.route("/api/acquisition_status", methods=[GET])
        def api_acquisition_status(request):
            status_data = {"status": self.get_acquisition_status(), "interval": ACQUISITION_INTERVAL}
            print(f"status: {status_data['status']}")
            return JSONResponse(request, status_data)

        @self.server.route("/api/status", methods=[GET])
        def api_status(request):
            data_dict = self.assembleJson()
            
            print("\nSensor collected data:")
            print("-" * 40)
            print(f"{data_dict}\n")
        
            try:
                submitMongo = request.query_params.get("submitMongo")
            except AttributeError:
                submitMongo = request.args.get("submitMongo")
                                
            if submitMongo.lower() == 'true' and self.isPicoSubmitMongo.lower() == 'true':
                print("\nSubmitting data to MongoDB")
                url = self.mongoURL+"/LabMonitorDB/api/submit-sensor-data"
                self.sendDataMongo(url, data_dict)

            headers = {"Content-Type": "application/json"}

            # Return the response using the compatible Response constructor
            return Response(request, json.dumps(data_dict), headers=headers)

        @self.server.route("/scripts.js")
        def icon_route(request):
            return self._serve_static_file(request, 'static/scripts.js')
            
        @self.server.route("/simple.js")
        def icon_route(request):
            return self._serve_static_file(request, 'static/simple.js')

        @self.server.route("/manifest.json")
        def icon_route(request):
            return self._serve_static_file(request, 'static/manifest.json')

        @self.server.route("/favicon.ico")
        def favicon_route(request):
            return self._serve_static_file(request, 'static/favicon.ico', content_type="image/x-icon")

        # If using a PNG for an app icon:
        @self.server.route("/icon192.png")
        def icon_route(request):
            return self._serve_static_file(request, 'static/icon192.png', content_type="image/png")

        @self.server.route("/icon.png")
        def icon_route(request):
            return self._serve_static_file(request, 'static/icon.png', content_type="image/png")

        # Start the server
        self.server.start(host=self.ip, port=80)

    def _serve_static_file(self, request, filepath, content_type="text/html"):
        """Manually reads a file and returns an HTTP response with a customizable content type."""

        # Determine if the file should be read in binary mode
        is_binary = filepath.endswith(('.ico', '.png'))
        mode = "rb" if is_binary else "r"
        encoding = None if is_binary else 'utf-8'

        try:
            with open(filepath, mode, encoding=encoding) as f:
                content = f.read()

            headers = {"Content-Type": content_type}

            # The Response object handles both text (str) and binary (bytes) content
            return Response(request, content, headers=headers)

        except OSError as e:
            # Handle File Not Found or other OS errors
            print(f"Error opening or reading file {filepath}: {e}")
            try:
                # The response content here should be simple text
                return Response(request, "File Not Found", {}, 404)
            except Exception as e2:
                print(f"Could not set 404 status: {e2}")
                return Response(request, "File Not Found. Check console.")

    def serve_forever(self):
        global is_acquisition_running, last_acquisition_time
        
        while True:
            # 1. Check/Handle WiFi
            if not wifi.radio.connected:
                print("WiFi connection lost. Rebooting...")
                self.reboot()

            try:
                self.server.poll() 
            except (BrokenPipeError, OSError) as e:
                if isinstance(e, OSError) and e.args[0] not in (32, 104):
                    print(f"Unexpected OSError in server poll: {e}")
                elif isinstance(e, BrokenPipeError):
                    pass
            except Exception as e:
                print(f"Unexpected critical error in server poll: {e}")

            # 3. Check Acquisition Timer (NON-BLOCKING)
            if is_acquisition_running:
                current_time = time.monotonic()
                if (current_time - last_acquisition_time) >= ACQUISITION_INTERVAL:
                    print(f"\nScheduled acquisition triggered at {current_time:.2f}")
                    print("-" * 40)
                    
                    # Your existing logic from /api/status, but without the HTTP wrapper
                    data_dict = self.assembleJson()
                    #print(data_dict)
                    
                    # Log to MongoDB if configured for Pico submission
                    if self.isPicoSubmitMongo.lower() == 'true':
                        print("\nSubmitting scheduled data to MongoDB")
                        url = self.mongoURL + "/LabMonitorDB/api/submit-sensor-data"
                        self.sendDataMongo(url, data_dict)
                    
                    last_acquisition_time = current_time # Reset the timer

            time.sleep(0.01)
            
    # --- Helper method to get current status ---
    def get_acquisition_status(self):
        global is_acquisition_running
        return "running" if is_acquisition_running else "stopped"
            
    def readCert(self, file_path):
        #file_path = "static/cert/cert.txt"
        certificate_content = ""

        try:
            # Open the file in read mode ('r')
            with open(file_path, 'r') as file:
                # Read the entire content of the file into the variable
                certificate_content = file.read()
    
            print("File read successfully.")
            # Optional: Print the content to verify
            # print(certiicate_content)
            return certificate_content

        except OSError as e:
            # Handle the case where the file or directory doesn't exist
            print(f"Error opening or reading file at {file_path}: {e}")
            return None
            
    def assembleJson(self):
        sensData1 = self.sensors.getData(self.sensors.envSensor1, self.sensors.envSensor1Name, self.sensors.sensor1CorrectTemp)
        sensData2 = self.sensors.getData(self.sensors.envSensor2, self.sensors.envSensor2Name, self.sensors.sensor2CorrectTemp)
        sensData3 = self.sensors.getData(self.sensors.envSensor3, self.sensors.envSensor3Name, self.sensors.sensor3CorrectTemp)

        UTC = self.getUTC()

        data_dict = {
            "sens1_Temp": sensData1['temperature'],
            "sens1_RH": sensData1['RH'],
            "sens1_P": sensData1['pressure'],
            "sens1_HI": sensData1['HI'],
            "sens1_type": sensData1['type'],
            "sens2_Temp": sensData2['temperature'],
            "sens2_RH": sensData2['RH'],
            "sens2_P": sensData2['pressure'],
            "sens2_HI": sensData2['HI'],
            "sens2_type": sensData2['type'],
            "sens3_Temp": sensData3['temperature'],
            "sens3_RH": sensData3['RH'],
            "sens3_P": sensData3['pressure'],
            "sens3_HI": sensData3['HI'],
            "sens3_type": sensData3['type'],
            "ip": self.ip,
            "version": version,
            "libSensors_version": self.sensors.sensDev.version,
            "UTC": UTC,
            "mongoURL": self.mongoURL,
            "mongoSecretKey" : self.mongoSecretKey,
            "device_name" : self.deviceName,
            "isPicoSubmitMongo" : self.isPicoSubmitMongo,
            }
        return data_dict
            
    ############################
    # Set up time/date
    ############################
    def setup_ntp(self):
        try:
            self.ntp = adafruit_ntp.NTP(socketpool.SocketPool(wifi.radio), tz_offset=0)
        except Exception as e:
            print(f"Failed to setup NTP: {e}")

    def getUTC(self):
        try:
            return self.ntp.utc_ns
        except Exception as e:
            print(f"Error converting NTP time: {e}")
            return 0

    def reboot(self):
        time.sleep(2)
        microcontroller.reset()
        
    #####################################################
    # Submit to Mongo DB
    # Currently disabled as handled by JS on client side.
    #####################################################
    
    def sendDataMongo(self, url, data):
        print("-" * 40)
        print(f"Attempting to POST data to: {url}")
        print(f"Payload: {json.dumps(data)}")
        
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        if self.mongoSecretKey:
            headers['Authorization'] = f'Bearer {self.mongoSecretKey}'
        
        try:
            response = self.requests.post(
                url,
                json=data,
                headers=headers,
                timeout=10 # Set a timeout for the request
            )

            # Check for success (HTTP 200 series status code)
            if response.status_code in [200, 201]:
                print("Data successfully sent!")
                print("Server Response:", response.text)
            else:
                print(f"Server returned status code: {response.status_code}")
                try:
                    # Try to print JSON error response if available
                    print("Server Error Details:", response.json())
                except:
                    # Fallback to printing raw text
                    print("Server Error Text:", response.text)

            response.close() # Crucial: always close the response object

        except Exception as e:
            print(f"An error occurred during the POST request: {e}")
    
############################
# Control, Sensors
############################
class Sensors:
    def __init__(self, conf):
        self.sensDev = SensorDevices()
        self.envSensor1 = None
        self.envSensor2 = None
        self.envSensor3 = None
        self.envSensor1Name = conf.sensor1
        self.envSensor2Name = conf.sensor2
        self.envSensor3Name = conf.sensor3
        self.envSensor1Pins = conf.sensor1Pins
        self.envSensor2Pins = conf.sensor2Pins
        self.envSensor3Pins = conf.sensor3Pins
        self.sensor1CorrectTemp = conf.sensor1CorrectTemp
        self.sensor2CorrectTemp = conf.sensor2CorrectTemp
        self.sensor3CorrectTemp = conf.sensor3CorrectTemp
        
        self.envSensor1 = self.sensDev.initSensor(conf.sensor1, conf.sensor1Pins)
        self.envSensor2 = self.sensDev.initSensor(conf.sensor2, conf.sensor2Pins)
        self.envSensor3 = self.sensDev.initSensor(conf.sensor3, conf.sensor3Pins)

        if self.envSensor1 != None:
            self.avDeltaT = microcontroller.cpu.temperature - self.envSensor1.temperature
        else:
            self.avDeltaT = 0

        self.numTimes = 1
        
    def getData(self, envSensor, envSensorName, correctTemp):
        t_cpu = microcontroller.cpu.temperature
        if not envSensor:
            print(f"{envSensorName} not initialized. Using CPU temp with estimated offset.")
            if self.numTimes > 1 and self.avDeltaT != 0 :
                return {'temperature': f"{round(t_cpu - self.avDeltaT, 1)}",
                        'RH': '--',
                        'pressure': '--',
                        'HI': '--',
                        'type': 'CPU adj.'}
            else:
                return {'temperature': f"{round(t_cpu, 1)} ",
                        'RH': '--',
                        'pressure': '--',
                        'HI': '--',
                        'type': 'CPU raw'}
        try:
            envSensorData = self.sensDev.getSensorData(envSensor, envSensorName, correctTemp)
            delta_t = t_cpu - float(envSensorData['temperature'])
            if self.numTimes >= 2e+1:
                self.numTimes = int(1e+1)
            self.avDeltaT = (self.avDeltaT * self.numTimes + delta_t)/(self.numTimes+1)
            self.numTimes += 1
            print(f"Av. CPU/MCP T diff: {self.avDeltaT} {self.numTimes}")
            time.sleep(0.5)
            return envSensorData
        except:
            print(f"{envSensorName} not available. Av CPU/MCP T diff: {self.avDeltaT}")
            time.sleep(0.5)
            return {'temperature': f"{round(t_cpu-self.avDeltaT, 1)}",
                    'RH': '--',
                    'pressure': '--',
                    'HI': '--',
                    'type': 'CPU adj'}
            
############################
# Utilities
############################
def stringToArray(string):
    if string is not None:
        number_strings = (
        string.replace(" ", "")
            .split(',')
        )
        array = [int(p) for p in number_strings]
        return array
    else:
        print("Warning: Initial string-array not found in settings.toml")
        return []

############################
# Main
############################
def main():
    conf = Conf()
    sensors = Sensors(conf)
    server = LabServer(sensors)

    server.serve_forever()

main()
