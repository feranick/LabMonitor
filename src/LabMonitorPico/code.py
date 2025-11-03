# **********************************************
# * LabMonitor - Rasperry Pico W
# * v2025.11.1.1
# * By: Nicola Ferralis <feranick@hotmail.com>
# **********************************************

version = "2025.11.2.1-test"

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

# MCP9808 ONLY
import adafruit_mcp9808
MCP_I2C_SCL = board.GP15
MCP_I2C_SDA = board.GP14

# BME680 NS BME280 ONLY
#import adafruit_bme680
from adafruit_bme280 import basic as adafruit_bme280
BME_CLK = board.GP18
BME_MOSI = board.GP19
BME_MISO = board.GP16
BME_OUT = board.GP17

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
            temperature_offset1 = os.getenv("sensor1TemperatureOffset")
            if temperature_offset1 is not None:
                self.sensor1TemperatureOffset = float(temperature_offset1)
            else:
                print("Warning: 'sensor1TemperatureOffset' not found in settings.toml. Using default.")
        except ValueError:
            self.sensor1 = None
            print(f"Warning: Invalid 'sensor1TemperatureOffset' '{sensor1TemperatureOffset}' in settings.toml. Using default.")

        try:
            self.sensor2 = os.getenv("sensor2")
            temperature_offset2 = os.getenv("sensor2TemperatureOffset")
            if temperature_offset2 is not None:
                self.sensor2TemperatureOffset = float(temperature_offset2)
            else:
                print("Warning: 'sensor2TemperatureOffset' not found in settings.toml. Using default.")
        except ValueError:
            self.sensor2 = None
            print(f"Warning: Invalid 'sensor2TemperatureOffset' '{sensor2TemperatureOffset}' in settings.toml. Using default.")

############################
# Server
############################
class LabServer:
    def __init__(self, sensors):
        self.sensors = sensors
        self.ntp = None
        self.server = None
        self.ip = "0.0.0.0"
        
        try:
            self.mongoURL = os.getenv("mongoURL")
            self.mongoSecretKey = os.getenv("mongoSecretKey")
            self.deviceName = os.getenv("deviceName")
            self.certPath = os.getenv("certPath")
        except:
            self.mongoURL = None
            self.mongoSecretKey = None
            self.deviceName = None
            self.certPath = None
            
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

        # Status Check Route (Placeholder)
        @self.server.route("/status", methods=[GET])
        def update_status(request):
            # Use simplified Response for 200 OK
            return Response(request, "OK")

        @self.server.route("/api/status", methods=[GET])
        def api_status(request):
            data_dict = self.assembleJson()
            print(data_dict)
        
            try:
                submitMongo = request.query_params.get("submitMongo")
            except AttributeError:
                submitMongo = request.args.get("submitMongo")
                
            if submitMongo.lower() == 'true':
                print("Submitting data to MongoDB")
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
        while True:
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

            time.sleep(0.01)
            
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
        sensData1 = self.sensors.getData(self.sensors.envSensor1, self.sensors.envSensorName1, self.sensors.temp_offset1)
        sensData2 = self.sensors.getData(self.sensors.envSensor2, self.sensors.envSensorName2, self.sensors.temp_offset2)

        UTC = self.getUTC()

        data_dict = {
            "sens1_Temp": sensData1['temperature'],
            "sens1_RH": sensData1['RH'],
            "sens1_P": sensData1['pressure'],
            "sens1_type": sensData1['type'],
            "sens2_Temp": sensData2['temperature'],
            "sens2_RH": sensData2['RH'],
            "sens2_P": sensData2['pressure'],
            "sens2_type": sensData2['type'],
            "ip": self.ip,
            "version": version,
            "UTC": UTC,
            "mongoURL": self.mongoURL,
            "mongoSecretKey" : self.mongoSecretKey,
            "device_name" : self.deviceName,
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
        self.envSensor1 = None
        self.envSensor2 = None
        self.envSensorName1 = conf.sensor1
        self.envSensorName2 = conf.sensor2

        self.temp_offset1 = conf.sensor1TemperatureOffset
        self.temp_offset2 = conf.sensor2TemperatureOffset

        self.envSensor1 = self.initSensor(self.envSensor1, conf.sensor1)
        self.envSensor2 = self.initSensor(self.envSensor2, conf.sensor2)

        if self.envSensor1 != None:
            self.avDeltaT = microcontroller.cpu.temperature - self.envSensor1.temperature
        else:
            self.avDeltaT = 0

        self.numTimes = 1

    def initSensor(self, envSensor, envSensorName):
        try:
            if envSensorName == "MCP9808":
                envSensor = self.initMCP9808()
            if envSensorName == "BME280":
                envSensor = self.initBME280()
            if envSensorName == "BME680":
                envSensor = self.initBME680()
            print(f"Temperature sensor ({envSensorName}) found and initialized.")
            return envSensor
        except Exception as e:
            print(f"Failed to initialize enironmental sensor: {e}")

    def initMCP9808(self):
        i2c = busio.I2C(MCP_I2C_SCL, MCP_I2C_SDA)
        envSensor = adafruit_mcp9808.MCP9808(i2c)
        return envSensor

    def getEnvDataMCP9808(self, envSensor):
        return {'temperature': str(envSensor.temperature), 'RH': '--', 'pressure': '--'}

    def initBME280(self):
        spi = busio.SPI(BME_CLK, MISO=BME_MISO, MOSI=BME_MOSI)
        bme_cs = digitalio.DigitalInOut(BME_OUT)
        envSensor = adafruit_bme280.Adafruit_BME280_SPI(spi, bme_cs)
        return envSensor

    def getEnvDataBME280(self, envSensor):
        return {'temperature': str(envSensor.temperature), 'RH': str(envSensor.relative_humidity), 'pressure': str(envSensor.pressure)}

    def initBME680(self):
        spi = busio.SPI(BME_CLK, MISO=BME_MISO, MOSI=BME_MOSI)
        bme_cs = digitalio.DigitalInOut(BME_OUT)
        envSensor = adafruit_bme680.Adafruit_BME680_SPI(spi, bme_cs)
        return envSensor

    def getEnvDataBME680(self, envSensor):
        return {'temperature': str(envSensor.temperature), 'RH': str(envSensor.humidity), 'pressure': str(envSensor.pressure)}

    def getData(self, envSensor, envSensorName, temp_offset):
        t_cpu = microcontroller.cpu.temperature
        if not envSensor:
            print(f"{envSensorName} not initialized. Using CPU temp with estimated offset.")
            if self.numTimes > 1 and self.avDeltaT != 0 :
                return {'temperature': f"{round(t_cpu - self.avDeltaT, 1)}", 'RH': '--', 'pressure': '--', 'type': 'CPU adj.'}
            else:
                return {'temperature': f"{round(t_cpu, 1)} ", 'RH': '--', 'pressure': '--', 'type': 'CPU raw'}
        try:
            envSensorData = self.getSensorData(envSensor, envSensorName)

            t_envSensor = float(envSensorData['temperature']) + temp_offset
            if envSensorName == "MCP9808":
                rh_envSensor = "--"
                p_envSensor = "--"
            else:
                rh_envSensor = round(float(envSensorData['RH']),1)
                p_envSensor = int(float(envSensorData['pressure']))

            delta_t = t_cpu - t_envSensor
            if self.numTimes >= 2e+1:
                self.numTimes = int(1e+1)
            self.avDeltaT = (self.avDeltaT * self.numTimes + delta_t)/(self.numTimes+1)
            self.numTimes += 1
            print(f"Av. CPU/MCP T diff: {self.avDeltaT} {self.numTimes}")
            time.sleep(0.5)
            return {'temperature': f"{round(t_envSensor,1)}", 'RH': f"{rh_envSensor}", 'pressure': f"{p_envSensor}", 'type': 'sensor'}
        except:
            print(f"{envSensorName} not available. Av CPU/MCP T diff: {self.avDeltaT}")
            time.sleep(0.5)
            return {'temperature': f"{round(t_cpu-self.avDeltaT, 1)}", 'RH': '--', 'pressure': '--', 'type': 'CPU adj'}

    def getSensorData(self, envSensor, envSensorName):
        if envSensorName == "MCP9808":
            sensorData = self.getEnvDataMCP9808(envSensor)
        elif envSensorName == "BME280":
            sensorData = self.getEnvDataBME280(envSensor)
        elif envSensorName == "BME680":
            sensorData = self.getEnvDataBME680(envSensor)
        return sensorData

############################
# Main
############################
def main():
    conf = Conf()
    sensors = Sensors(conf)
    server = LabServer(sensors)

    server.serve_forever()

main()
