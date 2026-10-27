"""Run the companion service until the owning Harness closes its stdin pipe."""
import os
import sys
import threading
from http.server import ThreadingHTTPServer
import server


def main():
    # Bind before starting schedulers. A conflicting listener cannot create background work.
    http = ThreadingHTTPServer(("127.0.0.1", int(os.environ["CMEM_PORT"])), server.Handler)
    try:
        server._init()

        def stop_on_eof():
            sys.stdin.buffer.read()
            http.shutdown()

        threading.Thread(target=stop_on_eof, daemon=True).start()
        http.serve_forever(poll_interval=0.2)
    finally:
        if hasattr(server, "scheduler"):
            server.scheduler.stop()
        if server.bili_automation is not None:
            server.bili_automation.stop()
            server.bili_automation.ledger.close()
        http.server_close()


if __name__ == "__main__":
    main()
