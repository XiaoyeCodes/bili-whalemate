"""Opt-in real inbox test with the owner's account playing a stranger in an isolated ledger."""
import argparse
import json
import time
from pathlib import Path
from urllib import request

from bili_automation import AutomationLedger, BiliAutomation, LIMIT_REPLY_TEXT, validate_config
from bili_runtime import BiliRuntime
from server import Handler, DSH_ROOT, DATA_DIR, _build_llm, _load_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--incoming-rpid", required=True)
    parser.add_argument("--mode", choices=("ai", "fixed"), required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute or not args.incoming_rpid.isdigit():
        raise SystemExit("Real writes require --execute and a numeric incoming comment ID")
    handler = object.__new__(Handler)
    cfg = validate_config(handler._load_bili_whale().get("automation"))
    if not cfg["features"]["strangerReply"]:
        raise SystemExit("Enable the installed stranger interaction feature before testing")
    cfg["strangerDailyMax"] = 1 if args.mode == "ai" else 0
    model = _build_llm(_load_config())
    calls = []

    def model_factory():
        calls.append("model")
        if args.mode == "fixed":
            raise AssertionError("The fixed notice path must never access the LLM")
        return model

    opener = request.build_opener(request.ProxyHandler({}))
    with opener.open("http://127.0.0.1:8080/persona", timeout=5) as response:
        payload = json.load(response)
    persona = payload.get("persona", payload)
    runtime = BiliRuntime(lambda: handler, model_factory, lambda: persona, DSH_ROOT, DATA_DIR)
    owner = runtime.owner_id()
    items = [row for row in runtime.notifications(cfg) if row["rpid"] == args.incoming_rpid]
    if len(items) != 1 or items[0]["mid"] != owner:
        raise SystemExit("Test accepts only the configured owner's selected verified inbox message")
    runtime.owner_id = lambda: "99999999999999999"  # Isolated role fixture; production owner configuration stays unchanged.
    runtime.notifications = lambda config: items
    ledger = AutomationLedger(Path(DATA_DIR, "bili-stranger-test.sqlite3"))
    try:
        ledger.set_meta("stranger_baseline", items[0]["time"] - 1)
        controller = BiliAutomation(ledger, runtime, lambda: cfg, lambda: True)
        controller.run_lock.acquire()
        controller._run_owned("strangerReply", False, True, time.time())
        events = ledger.events()
        event = next((row for row in events if row["result"].get("parent_rpid") == args.incoming_rpid), None)
        if not event or event["status"] != "success":
            raise SystemExit(json.dumps({"error": controller.status()["strangerError"], "events": events}, ensure_ascii=False))
        if args.mode == "fixed":
            assert calls == [] and model.calls == 0
            assert event["result"]["text"] == LIMIT_REPLY_TEXT
        else:
            assert len(calls) == 1 and model.calls == 1
        before = len(events)
        controller.run_lock.acquire()
        controller._run_owned("strangerReply", False, True, time.time())
        assert len(ledger.events()) == before
        result = {"mode": args.mode, "roleSimulation": "owner inbox event replayed as stranger in isolated test ledger",
                  "incomingRpid": args.incoming_rpid, "modelCalls": model.calls, "modelAccesses": len(calls),
                  "deduplicated": True, "result": event["result"]}
        path = Path(DSH_ROOT, "remembers-service", "bili-automation-verification.json")
        report = json.loads(path.read_text(encoding="utf-8"))
        report.setdefault("phase2Live", []).append(result)
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
    finally:
        ledger.close()


if __name__ == "__main__":
    main()
