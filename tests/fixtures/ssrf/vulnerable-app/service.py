import requests
from flask import request

def proxy_request():
    target = request.args.get('url')
    # Vulnerable request with disabled TLS verification
    res = requests.get(target, verify=False)
    return res.text
