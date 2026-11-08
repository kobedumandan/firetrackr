"""Publish a verified local model to a private bucket without changing the DB.

Run from backend/: python publish_model_bundle.py --version v1
    --manifest-sha256 <digest registered in model_versions>
Never overwrites an existing object or changes an existing bucket's privacy.
"""
import argparse
import json
from services.model_bundle_store import publish_model_bundle


def publish(version, digest):
    return publish_model_bundle(version, digest, create_bucket=True, allow_existing=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    arguments = parser.parse_args()
    print(json.dumps(publish(arguments.version, arguments.manifest_sha256)))
