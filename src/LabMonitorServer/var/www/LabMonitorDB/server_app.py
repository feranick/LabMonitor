import os
import json
import configparser
from flask import Flask, request, jsonify
#from flask_cors import CORS # CRITICAL FIX 2: Missing 'CORS' import for CORS(app) -- Keep commented out to prevent CORS duplication
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure
from datetime import datetime

# --- Configuration ---
# IMPORTANT: Replace these with your actual MongoDB connection details
# NOTE: Using environment variables is the most secure method in production.
# The format for an authenticated string is: mongodb://user:password@host:port/?authSource=LabMonitorDB

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(APP_DIR, 'config.cfg')

try:
    # Read credentials from config.cfg
    config = configparser.ConfigParser(allow_no_value=True)
    with open(CONFIG_PATH, 'r') as f:
        config.read_string(f'[DEFAULT]\n{f.read()}')
    
    MONGO_AUTH_STRING = config['DEFAULT'].get('MONGO_AUTH_STRING')
    SECRET_KEY = config['DEFAULT'].get('SERVER_SECRET_KEY')
    DATABASE_NAME =  config['DEFAULT'].get('DATABASE_NAME')
    COLLECTION_NAME = config['DEFAULT'].get('COLLECTION_NAME')
    REQUIRED_KEYS = config['DEFAULT'].get('REQUIRED_KEYS')
    
    print(f"[DEBUG] Configuration loaded successfully.")
except Exception as e:
    print(f"[CRITICAL ERROR] General error during configuration or MongoDB setup: {e}")

MONGO_CONNECTION_STRING = os.getenv("MONGO_URL", "mongodb://localhost:27017/")

# CRITICAL DEBUGGING LINE: Print the connection string being used to the Apache error log
print(f"DEBUG: Using MONGO_CONNECTION_STRING: {MONGO_CONNECTION_STRING}")

if not SECRET_KEY:
    # Fail fast if the secret is not configured.
    # NOTE: This key isn't strictly necessary since the client isn't sending auth, 
    # but it's good practice to have a critical environment variable defined.
    print("WARNING: SERVER_SECRET_KEY environment variable not set. Authorization features are disabled.")

app = Flask(__name__)

# --- MongoDB Initialization ---
try:
    # Attempt to connect to MongoDB using the connection string
    client = MongoClient(MONGO_CONNECTION_STRING, serverSelectionTimeoutMS=5000)
    db = client[DATABASE_NAME]
    collection = db[COLLECTION_NAME]
    
    # Verify connection and authorization (this is the key step)
    # Ping confirms connectivity. The client object must hold the authentication details
    # client.admin.command('ping') # REMOVED: Requires permissions on 'admin' database.
    
    # Verify write access by checking if the collection exists (optional, but good)
    # collection.find_one({}) # REMOVED: Implicitly performs a check that might fail authorization.
    
    print("Successfully connected and authorized with MongoDB.")
except (ConnectionFailure, OperationFailure) as e:
    # OperationFailure catches authentication issues (like the one you were seeing)
    print(f"Could not connect or authorize with MongoDB: {e}")
    # Note: If the connection fails here, all subsequent route calls will fail.
except Exception as e:
    print(f"General error during MongoDB setup: {e}")

@app.route('/submit-sensor-data', methods=['POST'])
def receive_data():
    """Handles incoming JSON data from the client and inserts it into MongoDB."""
    
    # Ensure the client is connected before proceeding
    if 'client' not in globals() or client is None:
        return jsonify({"message": "Database service unavailable."}), 503
        
    # 1. Check for Content Type
    if not request.is_json:
        return jsonify({"message": "Unsupported Media Type. Must be application/json."}), 415

    try:
        data = request.get_json()
    except Exception as e:
        # Handle cases where the JSON payload is malformed
        return jsonify({"message": f"Invalid JSON payload: {e}"}), 400

    # 2. Data Validation and Preprocessing
    # (sens1_Temp, sens1_RH, UTC, and the required client-added fields).
   
    if not all(key in data for key in REQUIRED_KEYS):
        missing_keys = [key for key in REQUIRED_KEYS if key not in data]
        return jsonify({
            "message": "Missing required fields.",
            "missing": missing_keys
        }), 400
            
    # Convert UTC (large integer timestamp from Pico) to BSON datetime object
    # The UTC value is in nanoseconds since 1970, which is too large for standard datetime.
    # We must convert to seconds.
    if 'UTC' in data and isinstance(data['UTC'], int):
        try:
            # Convert nanoseconds to seconds (divide by 1 billion)
            timestamp_seconds = data['UTC'] / 1_000_000_000
            data['datetime_utc_pico'] = datetime.fromtimestamp(timestamp_seconds)
        except ValueError as e:
            print(f"Timestamp conversion error for UTC: {e}")
            pass # Continue if conversion fails, but log the error  
            
    # Convert client-added timestamp (milliseconds) to BSON datetime object
    if 'client_submission_time' in data and isinstance(data['client_submission_time'], int):
        try:
            # Convert milliseconds to seconds
            data['datetime_utc_client'] = datetime.fromtimestamp(data['client_submission_time'] / 1000)
        except ValueError as e:
            print(f"Timestamp conversion error for client_submission_time: {e}")
            pass # Continue if conversion fails, but log the error

    # 3. Insert into MongoDB
    try:
        # If authentication fails, the exception is raised here
        result = collection.insert_one(data) 
        print(f"Inserted document ID: {result.inserted_id}")
            
        # 4. Return success response
        return jsonify({
            "message": "Data received and saved successfully",
            "id": str(result.inserted_id)
        }), 201 # Use 201 (Created) for a successful POST operation

    except OperationFailure as e:
        # Specific catch for authorization errors during insertion
        print(f"MongoDB Authorization Error during insert: {e}")
        return jsonify({"message": "Authorization failed during database insertion. Check MONGO_URL credentials."}), 500
    except Exception as e:
        print(f"MongoDB Insert Error: {e}")
        return jsonify({"message": f"Internal server error during database insertion: {e}"}), 500

# WSGI entry point for Apache/mod_wsgi
if __name__ == '__main__':
    # This runs the app directly, useful for local testing (http://127.0.0.1:5000)
    # Note: You would run this only if not using Apache/NGINX.
    app.run(debug=True, port=5000)
