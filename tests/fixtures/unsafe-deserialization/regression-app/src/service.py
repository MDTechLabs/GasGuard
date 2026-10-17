import pickle
import yaml

def load_payload(raw_data):
    # Regression case for CVE/CWE-502
    return pickle.loads(raw_data)

def load_yaml_config(doc):
    return yaml.load(doc)
