"""Entry point for python -m sjis2utf8."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
