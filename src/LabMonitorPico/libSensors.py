import time
import busio
import board
import digitalio
import microcontroller

############################
# Control, Sensors
############################
def initSensor(envSensorName, pins):
    try:
        if envSensorName == "MCP9808":
            envSensor = initMCP9808(pins)
        elif envSensorName == "BME280":
            envSensor = initBME280(pins)
        elif envSensorName == "BME680":
            envSensor = initBME680(pins)
        elif envSensorName == "MAX31865":
            envSensor = initMAX31865(pins)
        else:
            envSensor = None
        print(f"Temperature sensor ({envSensorName}) found and initialized.")
        return envSensor
    except Exception as e:
        print(f"Failed to initialize enironmental sensor: {e}")

def initMCP9808(pins):
    import adafruit_mcp9808
    MCP_I2C_SCL = getattr(board, "GP" + str(pins[0]))
    MCP_I2C_SDA = getattr(board, "GP" + str(pins[1]))
    i2c = busio.I2C(MCP_I2C_SCL, MCP_I2C_SDA)
    envSensor = adafruit_mcp9808.MCP9808(i2c)
    return envSensor

def getEnvDataMCP9808(envSensor, correctTemp):
    t_envSensor = float(envSensor.temperature)
    if correctTemp.lower() == 'true':
        t_envSensor = correctTempMCP9808(t_envSensor)
    return {'temperature': f"{round(t_envSensor,1)}", 'RH': "--", 'pressure': "--", 'type': 'sensor'}
    #return {'temperature': str(envSensor.temperature), 'RH': '--', 'pressure': '--'}

def initBME280(pins):
    from adafruit_bme280 import basic as adafruit_bme280
    BME_CLK = getattr(board, "GP" + str(pins[0]))
    BME_MOSI = getattr(board, "GP" + str(pins[1]))
    BME_MISO = getattr(board, "GP" + str(pins[2]))
    BME_OUT = getattr(board, "GP" + str(pins[3]))
    spi = busio.SPI(BME_CLK, MISO=BME_MISO, MOSI=BME_MOSI)
    bme_cs = digitalio.DigitalInOut(BME_OUT)
    envSensor = adafruit_bme280.Adafruit_BME280_SPI(spi, bme_cs)
    return envSensor

def getEnvDataBME280(envSensor, correctTemp):
    t_envSensor = float(envSensor.temperature)
    rh_envSensor = round(float(envSensor.humidity),1)
    p_envSensor = int(float(envSensor.pressure))
    if correctTemp.lower() == 'true':
        t_envSensor = correctTempBME280(t_envSensor,rh_envSensor)
    return {'temperature': f"{round(t_envSensor,1)}", 'RH': f"{rh_envSensor}", 'pressure': f"{p_envSensor}", 'type': 'sensor'}

def initBME680(pins):
    import adafruit_bme680
    BME_CLK = getattr(board, "GP" + str(pins[0]))
    BME_MOSI = getattr(board, "GP" + str(pins[1]))
    BME_MISO = getattr(board, "GP" + str(pins[2]))
    BME_OUT = getattr(board, "GP" + str(pins[3]))
    spi = busio.SPI(BME_CLK, MISO=BME_MISO, MOSI=BME_MOSI)
    bme_cs = digitalio.DigitalInOut(BME_OUT)
    envSensor = adafruit_bme680.Adafruit_BME680_SPI(spi, bme_cs)
    return envSensor
    
def getEnvDataBME680(envSensor, correctTemp):
    t_envSensor = float(envSensor.temperature)
    rh_envSensor = round(float(envSensor.humidity),1)
    p_envSensor = int(float(envSensor.pressure))
    if correctTemp.lower() == 'true':
        t_envSensor = correctTempBME680(t_envSensor,rh_envSensor)
    return {'temperature': f"{round(t_envSensor,1)}", 'RH': f"{rh_envSensor}", 'pressure': f"{p_envSensor}", 'type': 'sensor'}
    
def initMAX31865(pins):
    import adafruit_max31865
    BME_CLK = getattr(board, "GP" + str(pins[0]))
    BME_MOSI = getattr(board, "GP" + str(pins[1]))
    BME_MISO = getattr(board, "GP" + str(pins[2]))
    BME_OUT = getattr(board, "GP" + str(pins[3]))
    spi = busio.SPI(BME_CLK, MISO=BME_MISO, MOSI=BME_MOSI)
    bme_cs = digitalio.DigitalInOut(BME_OUT)
    envSensor = adafruit_max31865.MAX31865(spi, bme_cs)
    return envSensor
    
def getEnvDataMAX31865(envSensor):
    t_envSensor = float(envSensor.temperature)
    if correctTemp.lower() == 'true':
        t_envSensor = correctTempMAX31865(t_envSensor)
    return {'temperature': f"{round(t_envSensor,1)}", 'RH': "--", 'pressure': "--", 'type': 'sensor'}

def getSensorData(envSensor, envSensorName, correctTemp):
    if envSensorName == "MCP9808":
        sensorData = getEnvDataMCP9808(envSensor, correctTemp)
    elif envSensorName == "BME280":
        sensorData = getEnvDataBME280(envSensor, correctTemp)
    elif envSensorName == "BME680":
        sensorData = getEnvDataBME680(envSensor, correctTemp)
    elif envSensorName == "MAX31865":
        sensorData = getEnvDataMAX31865(envSensor, correctTemp)
    return sensorData
    
    
# Temperature correction for BME280
def correctTempBME280(mt, mh):
    C_INTERCEPT     = -22.378940
    C_MT            = 3.497112
    C_MH            = -0.267584
    C_MT_P2         = -0.060241
    C_MT_MH         = 0.000282
    C_MH_P2         = 0.003162
    
    rt_pred = C_INTERCEPT + \
              (C_MT * mt) + \
              (C_MH * mh) + \
              (C_MT_P2 * (mt**2)) + \
              (C_MT_MH * (mt * mh)) + \
              (C_MH_P2 * (mh**2))
    return rt_pred
    
# Temperature correction for BME280
def correctTempBME680(mt, mh):
    C_INTERCEPT     = -22.378940
    C_MT            = 3.497112
    C_MH            = -0.267584
    C_MT_P2         = -0.060241
    C_MT_MH         = 0.000282
    C_MH_P2         = 0.003162
    
    rt_pred = C_INTERCEPT + \
              (C_MT * mt) + \
              (C_MH * mh) + \
              (C_MT_P2 * (mt**2)) + \
              (C_MT_MH * (mt * mh)) + \
              (C_MH_P2 * (mh**2))
    return rt_pred
    
# Temperature correction for BME280
def correctTempMCP9808(mt):
    return mt
    
# Temperature correction for MAX31865
def correctTempMax31865(mt):
    return mt
