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

Create an isolated Python environment for the project.

### Create the environment inside the app directory
`sudo python3 -m venv /var/www/LabMonitorDB/venv`

The virtualenv is only meaningful if Apache is told to use it. See Step 4: the
`WSGIDaemonProcess` directive must carry `python-home=/var/www/LabMonitorDB/venv`.
Without that, mod_wsgi runs the application under the *system* interpreter and
this environment is ignored entirely.

## C. Install Python Libraries

Install the required Python packages into the virtualenv. Call the venv's own
`pip` by absolute path — do **not** use `sudo pip3 install`, which writes to the
system `/usr/local/lib/pythonX.Y/dist-packages` instead of the venv.

`sudo /var/www/LabMonitorDB/venv/bin/pip install flask pymongo flask-cors`

(`configparser` is part of the Python 3 standard library and does not need
installing.)

### Note on distribution upgrades

`/usr/local/lib/pythonX.Y/dist-packages` is version-specific. An Ubuntu release
upgrade that bumps the Python minor version — for example 3.12 to 3.14 — makes
every package installed there invisible, and the application fails at import
time with `ModuleNotFoundError`, which mod_wsgi surfaces as an HTML 500 rather
than a JSON error. A virtualenv wired up via `python-home` avoids this, but the
virtualenv must itself be recreated after such an upgrade, since its
`lib/pythonX.Y/site-packages` directory is equally version-specific:

```
sudo rm -rf /var/www/LabMonitorDB/venv
sudo python3 -m venv /var/www/LabMonitorDB/venv
sudo /var/www/LabMonitorDB/venv/bin/pip install flask pymongo flask-cors
sudo chown -R www-data:www-data /var/www/LabMonitorDB
sudo systemctl restart apache2
```


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

Note that `touch`ing the `.wsgi` file reloads application *code* only. Changes to
`WSGIDaemonProcess` (including `python-home`) require a full Apache restart.

# Troubleshooting

The viewer reporting `SyntaxError: Unexpected token '<', "<!DOCTYPE"... is not
valid JSON` means the API returned Apache's HTML error page instead of JSON —
the WSGI application failed to load, so no Flask route ran. A database that is
merely unreachable returns a clean JSON 503 instead. Check the traceback:

`sudo tail -40 /var/log/apache2/data_collector_error.log`
