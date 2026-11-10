"""Compatibility entry point for the evidence-only BFP operational CSV importer.

The former demonstration importer generated timings and assumed alarm levels.
Use import_bfp_operational.py for preview, backed-up replacement and validation.
"""
from import_bfp_operational import main


if __name__ == '__main__':
    main()
