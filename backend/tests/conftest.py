import os

# Tests never call the live Scarlet Sync feed; they inject events directly.
os.environ.setdefault("LIVE_EVENTS_SYNC", "0")
