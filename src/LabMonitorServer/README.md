# Lab Monitor Data Collector API Setup Guide (Flask, WSGI, PyMongo)

This document provides a detailed, step-by-step guide for deploying the Lab Monitor Data Collector API, a Python/Flask application, using Apache HTTP Server and mod_wsgi.

This guide implements a solution to securely manage MongoDB credentials and the API secret key via a dedicated configuration file (config.cfg), which is the most reliable way to bypass known environment variable injection issues in strict server configurations.

# Prerequisites

Ensure the following components are installed and configured on your server:

Operating System: Linux (e.g., Ubuntu/Debian).

Web Server: Apache HTTP Server.

WSGI Module: `libapache2-mod-wsgi-py3` (or equivalent for Python 3).

Python 3: the system interpreter. Dependencies are installed with apt, not pip
(see Step 1B).

MongoDB: Running locally or accessible via the network, with the required user credentials.

# Step 1: Create Application Directory and Install Dependencies

## A. Create a Secure Directory

It is best practice to place the application outside the public DocumentRoot (/var/www/html) for security.

`sudo mkdir /var/www/LabMonitorDB`

## B. Install Python Libraries — use the distribution packages

`sudo apt install python3-flask python3-flask-cors python3-pymongo`

(`configparser` is part of the Python 3 standard library and does not need
installing.)

Use apt, **not** `sudo pip3 install`. This is the single most important step in
this guide, for the reason below.

### Why apt and not pip

`sudo pip3 install` writes to `/usr/local/lib/pythonX.Y/dist-packages`. That
path is tied to one specific Python minor version, and apt neither manages nor
migrates it. An Ubuntu release upgrade that bumps the interpreter — 24.04's
Python 3.12 to 26.04's Python 3.14, for example — leaves every package installed
that way stranded and invisible. The application then fails at import time with
`ModuleNotFoundError`, which mod_wsgi surfaces as an HTML 500 page; the viewer
reports it as `Unexpected token '<', "<!DOCTYPE"... is not valid JSON`.

Packages installed with apt are rebuilt for the new interpreter as part of the
upgrade, so the application keeps working with no intervention.

Modern pip refuses system-wide installs by default for exactly this reason
(PEP 668). If you find yourself reaching for `--break-system-packages`, that is
the signal to use apt instead.

### If a dependency is not packaged, or a specific version is required

Use a virtualenv — never pip into the system interpreter. A virtualenv must be
pointed at explicitly, via `python-home` on the `WSGIDaemonProcess` directive in
`data_collector.conf`; simply creating one has no effect on mod_wsgi, which
otherwise keeps using the system interpreter:

```
sudo python3 -m venv /var/www/LabMonitorDB/venv
sudo /var/www/LabMonitorDB/venv/bin/pip install flask pymongo flask-cors
sudo chown -R www-data:www-data /var/www/LabMonitorDB
```

```apache
WSGIDaemonProcess labmonitordb-process user=www-data group=www-data threads=5 \
    python-home=/var/www/LabMonitorDB/venv
```

Note that a virtualenv does not survive a Python minor-version upgrade either —
its `lib/pythonX.Y/site-packages` is equally version-specific — so it must be
deleted and recreated with the commands above after any release upgrade. That
manual step is the trade-off for pinning versions apt does not carry. For this
application, whose three dependencies are all packaged by Ubuntu, apt is the
better choice.


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

A `ModuleNotFoundError` there after a distribution upgrade means the dependency
was installed with pip rather than apt (Step 1B). Install the missing package
with apt and reload:

```
sudo apt install python3-<module>
sudo systemctl restart apache2
```

Check which interpreter mod_wsgi is actually using — the version reported at
Apache startup — with:

`sudo grep 'resuming normal operations' /var/log/apache2/error.log | tail -1`

Note that mod_wsgi daemon processes are not visible under their own name in a
plain `ps` listing; search for the process group instead:

`ps -eo pid,user,cmd | grep '[w]sgi'`
