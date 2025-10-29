import os
import sys
import json
import datetime
import configparser
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure

# ----------------------------------------------------
# 1. WSGI PATH SETUP
# ----------------------------------------------------
# Ensure the application directory is in the path
sys.path.insert(0, '/var/www/LabMonitorDB')

# ----------------------------------------------------
# 2. CONFIG FILE LOADING & GLOBAL DB SETUP
# ----------------------------------------------------
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(APP_DIR, 'config.cfg')

MONGO_AUTH_STRING = None
SERVER_SECRET_KEY = None
client = None # MongoDB client instance

try:
    # Read credentials from config.cfg
    config = configparser.ConfigParser(allow_no_value=True)
    with open(CONFIG_PATH, 'r') as f:
        config.read_string(f'[DEFAULT]\n{f.read()}')
    
    MONGO_AUTH_STRING = config['DEFAULT'].get('MONGO_AUTH_STRING')
    SERVER_SECRET_KEY = config['DEFAULT'].get('SERVER_SECRET_KEY')
    DATABASE_NAME =  config['DEFAULT'].get('DATABASE_NAME')
    COLLECTION_NAME = config['DEFAULT'].get('COLLECTION_NAME')
    ORIGINS = config['DEFAULT'].get('ORIGINS')
    
    print(f"[DEBUG] Configuration loaded successfully.")

    client = MongoClient(MONGO_AUTH_STRING, serverSelectionTimeoutMS=5000)
    db = client[DATABASE_NAME]
    collection = db[COLLECTION_NAME]
    
    # The ismaster command is a lightweight way to verify a connection
    client.admin.command('ping') 
    print("Successfully connected and authorized with MongoDB.")
    
except (ConnectionFailure, OperationFailure) as e:
    print(f"[CRITICAL ERROR] Could not connect or authorize with MongoDB: {e}")
except Exception as e:
    print(f"[CRITICAL ERROR] General error during configuration or MongoDB setup: {e}")


# ----------------------------------------------------
# 3. FLASK APP INITIALIZATION
# ----------------------------------------------------
app = Flask(__name__)

# Configure CORS for the specific origins
CORS(app, resources={
   r"/submit-sensor-data": {"origins": ORIGINS}
})

# ----------------------------------------------------
# 4. ROUTES
# ----------------------------------------------------

@app.route('/submit-sensor-data', methods=['POST'])
def submit_sensor_data():
    
    # 1. Ensure DB is available
    if client is None:
        return jsonify({"message": "Database service unavailable."}), 503
        
    # 2. Key Validation and Data Acquisition
    try:
        if not request.is_json:
            return jsonify({"message": "Missing JSON in request"}), 400
            
        data = request.get_json()
        submitted_key = data.get('mongoSecretKey')
        
        if not submitted_key or submitted_key != SERVER_SECRET_KEY:
            print(f"[ERROR] Unauthorized access attempt.")
            return jsonify({"message": "Unauthorized access or missing key."}), 403

    except Exception as e:
        print(f"[CRITICAL ERROR] Failed to parse request: {str(e)}")
        return jsonify({"message": f"Invalid request payload: {str(e)}"}), 400

    # 3. Data Transformation (UTC to datetime conversion from server_app.py)
    # FIX: Using datetime.datetime.utcnow() to properly access the class within the module.
    data['server_submission_time'] = datetime.datetime.utcnow().isoformat()
    
    if 'UTC' in data and isinstance(data['UTC'], int):
        try:
            # Convert nanoseconds to seconds (divide by 1 billion)
            timestamp_seconds = data['UTC'] / 1_000_000_000
            # FIX: Using datetime.datetime.fromtimestamp()
            data['datetime_utc_pico'] = datetime.datetime.fromtimestamp(timestamp_seconds)
        except Exception:
            pass 
            
    if 'client_submission_time' in data and isinstance(data['client_submission_time'], int):
        try:
            # Convert milliseconds to seconds
            # FIX: Using datetime.datetime.fromtimestamp()
            data['datetime_utc_client'] = datetime.datetime.fromtimestamp(data['client_submission_time'] / 1000)
        except Exception:
            pass
            
    # 4. Insert into MongoDB
    try:
        # 'collection' is globally set during startup
        result = collection.insert_one(data)
        print(f"[INFO] Inserted document ID: {result.inserted_id}")
        
        return jsonify({
            "message": "Data received and saved successfully",
            "id": str(result.inserted_id)
        }), 201 

    except OperationFailure as e:
        print(f"[ERROR] MongoDB Authorization Error during insert: {e}")
        return jsonify({"message": "Authorization failed during database insertion. Check config.cfg credentials."}), 500
    except Exception as e:
        print(f"[CRITICAL ERROR] MongoDB Insert Error: {e}")
        return jsonify({"message": f"Internal server error during database insertion: {e}"}), 500

# ----------------------------------------------------
# 5. WSGI Application Entry Point
# ----------------------------------------------------
application = app
