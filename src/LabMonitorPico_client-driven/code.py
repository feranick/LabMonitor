# **********************************************
# * LabMonitor - Rasperry Pico W
# * Client driven
# * v2026.03.19.1
# * By: Nicola Ferralis <ferralis@mit.edu>
# **********************************************

version = "2025.12.12.1-client-driven"

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
from adafruit_httpserver import Server, MIMETypes, Response, GET, POST, JSONResponse, FileResponse
import adafruit_ntp

from libSensors import SensorDevices, overclock

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
            overclock(os.getenv("overclock"))
        except:
            overclock("False")
    
        try:
            self.sensor1_name = os.getenv("sensor1_name")
            self.sensor1_pins = stringToArray(os.getenv("sensor1_pins"))
            self.sensor1_correct_temp = os.getenv("sensor1_correct_temp")
        except ValueError:
            self.sensor1_name = None
            self.sensor1_pins = None
            self.sensor1_correct_temp = "False"
            print(f"Warning: Invalid settings.toml. Using default.")

        try:
            self.sensor2_name = os.getenv("sensor2_name")
            self.sensor2_pins = stringToArray(os.getenv("sensor2_pins"))
            self.sensor2_correct_temp = os.getenv("sensor2_correct_temp")
        except ValueError:
            self.sensor2_name = None
            self.sensor2_pins = None
            self.sensor2_correct_temp = "False"
            print(f"Warning: Invalid settings.toml. Using default.")
            
        try:
            self.sensor3_name = os.getenv("sensor3_name")
            self.sensor3_pins = stringToArray(os.getenv("sensor3_pins"))
            self.sensor3_correct_temp = os.getenv("sensor3_correct_temp")
        except ValueError:
            self.sensor3_name = None
            self.sensor3_pins = None
            self.sensor3_correct_temp = "False"
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
        
        try:
            self.mongo_url = os.getenv("mongo_url")
            self.mongo_secret_key = os.getenv("mongo_secret_key")
            self.device_name = os.getenv("device_name")
            self.cert_path = os.getenv("cert_path")
            self.is_pico_submit_mongo = os.getenv("is_pico_submit_mongo")
        except:
            self.mongo_url = None
            self.mongo_secret_key = None
            self.device_name = None
            self.cert_path = None
            self.is_pico_submit_mongo = "False"
            
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
        
        ### Submission from Pico with certificate handling
        ssl_context = ssl.create_default_context()
        ROOT_CA_CERT = self.readCert(self.cert_path)
        try:
            ssl_context.load_verify_locations(cadata=ROOT_CA_CERT)
            print("Custom Root CA successfully loaded.")
        except Exception as e:
            print(f"Failed to load certificate: {e}")
        self.requests = adafruit_requests.Session(pool, ssl_context)

        # --- Routes ---

        @self.server.route("/")
        def base_route(request):
            return self._serve_static_file(request, 'static/index.html')

        @self.server.route("/api/status", methods=[GET])
        def api_status(request):
            data_dict = self.assembleJson()
            print(data_dict)
        
            try:
                submitMongo = request.query_params.get("submitMongo")
            except AttributeError:
                submitMongo = request.args.get("submitMongo")
                                
            if submitMongo.lower() == 'true' and self.isPicoSubmitMongo.lower() == 'true':
                print("Submitting data to MongoDB")
                url = self.mongo_url+"/LabMonitorDB/api/submit-sensor-data"
                self.sendDataMongo(url, data_dict)

            headers = {"Content-Type": "application/json"}
            return Response(request, json.dumps(data_dict), headers=headers)

        @self.server.route("/scripts.js")
        def icon_route(request):
            return self._serve_static_file(request, 'static/scripts.js')
            
        @self.server.route("/simple.html")
        def base_route(request):
            return self._serve_static_file(request, 'static/simple.html')
            
        @self.server.route("/simple.js")
        def icon_route(request):
            return self._serve_static_file(request, 'static/simple.js')

        @self.server.route("/manifest.json")
        def icon_route(request):
            return self._serve_static_file(request, 'static/manifest.json')

        @self.server.route("/favicon.ico")
        def favicon_route(request):
            return self._serve_static_file(request, 'static/favicon.ico', content_type="image/x-icon")

        @self.server.route("/icon192.png")
        def icon_route(request):
            return self._serve_static_file(request, 'static/icon192.png', content_type="image/png")

        @self.server.route("/icon.png")
        def icon_route(request):
            return self._serve_static_file(request, 'static/icon.png', content_type="image/png")

        self.server.start(host=self.ip, port=80)

    def _serve_static_file(self, request, filepath, content_type=None):
        """Streams a file from flash memory using FileResponse to prevent memory fragmentation."""
        try:
            os.stat(filepath)
            if content_type:
                return FileResponse(request, filepath, content_type=content_type)
            return FileResponse(request, filepath)

        except OSError as e:
            print(f"Error locating or accessing file {filepath}: {e}")
            return Response(request, "File Not Found", status=404)

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
        certificate_content = ""
        try:
            with open(file_path, 'r') as file:
                certificate_content = file.read()
    
            print("File read successfully.")
            return certificate_content

        except OSError as e:
            print(f"Error opening or reading file at {file_path}: {e}")
            return None
            
    def assembleJson(self):
        sensData1 = self.sensors.getData(self.sensors.envSensor1, self.sensors.envSensor1_name, self.sensors.sensor1_correct_temp)
        sensData2 = self.sensors.getData(self.sensors.envSensor2, self.sensors.envSensor2_name, self.sensors.sensor2_correct_temp)
        sensData3 = self.sensors.getData(self.sensors.envSensor3, self.sensors.envSensor3_name, self.sensors.sensor3_correct_temp)

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
            "mongo_url": self.mongo_url,
            "mongo_secret_key" : self.mongo_secret_key,
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
