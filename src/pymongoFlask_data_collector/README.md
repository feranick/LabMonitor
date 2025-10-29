# Lab Monitor Data Collector API Setup Guide (Flask, WSGI, PyMongo)

This document provides a detailed, step-by-step guide for deploying the Lab Monitor Data Collector API, a Python/Flask application, using Apache HTTP Server and mod_wsgi.

This guide implements a solution to securely manage MongoDB credentials and the API secret key via a dedicated configuration file (config.cfg), which is the most reliable way to bypass known environment variable injection issues in strict server configurations.

# Prerequisites

Ensure the following components are installed and configured on your server:

Operating System: Linux (e.g., Ubuntu/Debian).

Web Server: Apache HTTP Server.

WSGI Module: `libapache2-mod-wsgi-py3` (or equivalent for Python 3).

Python 3: With pip.

MongoDB: Running locally or accessible via the network, with the required user credentials.

# Step 1: Create Application Directory and Install Dependencies

## A. Create a Secure Directory

It is best practice to place the application outside the public DocumentRoot (/var/www/html) for security.

`sudo mkdir /var/www/LabMonitorDB`

## B. Setup Python Virtual Environment (CRITICAL)

Create and activate an isolated Python environment for the project. All subsequent pip install commands must be run while this environment is active.

### Create the environment inside the app directory
`python3 -m venv /var/www/LabMonitorDB/venv`

### Activate the environment (You must run this for the next step)
`source /var/www/LabMonitorDB/venv/bin/activate`


## C. Install Python Libraries

Install the required Python packages (Flask, pymongo, flask-cors, configparser) into your environment.

`sudo pip3 install flask pymongo flask-cors configparser`


# Step 2: Configure Credentials (config.cfg)

This file holds critical credentials and must be placed in the application root (`/var/www/LabMonitorDB`).

NOTE: Replace the placeholder values below with your actual MongoDB connection string and API secret key.

Copy the file in `var/www/LabMonitorDB/config.cfg` into the corresponding folder in the server.
Content for config.cfg:

`MONGO_AUTH_STRING=mongodb://user_name:user_passwd@localhost:27017/LabMonitorDB?authSource=LabMonitorDB
SERVER_SECRET_KEY=very_long_key`

You can generate a new key using this python code:

```
import secrets
print(secrets.token_urlsafe(32))
```
Make sure that the key is also saved in the `settings.toml` file in the Pico.

# Step 3: Create the WSGI Application Script (data_collector.wsgi)

This script contains the final, working logic to read config.cfg, establish the MongoDB connection once at startup, perform the secret key security check, and handle the data insertion.

Copy the file in `var/www/LabMonitorDB/data_collector.wsgi` into the corresponding folder in the server.


# Step 4: Configure Apache VirtualHost

Copy the file `etc/apache2/sites-enabled/data_collector.conf` into your Apache configuration folder (e.g., /etc/apache2/sites-enabled/data_collector.conf) 


# Step 5: Final Deployment and Restart

Set Permissions: Give the Apache user (www-data) ownership of the application folder.

`sudo chown -R www-data:www-data /var/www/LabMonitorDB`


Force WSGI Reload: Inform mod_wsgi that the application has been updated.

`sudo touch /var/www/LabMonitorDB/data_collector.wsgi`


Restart Apache: Apply all configuration changes.

`sudo systemctl restart apache2`
