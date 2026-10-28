"""Explicitly authorized single-message gallery transport probes; never rerun an uncertain write."""
import argparse
import json
import time
from pathlib import Path
from urllib import request
from server import Handler, DSH_ROOT, DATA_DIR, _build_llm, _load_config
from bili_runtime import BiliRuntime
from bili_gallery import BiliGallery
from bili_automation import validate_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("comment", "ownerReply", "dm"))
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--force-test-image", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        raise SystemExit("Remote writes require --execute")
    opener = request.build_opener(request.ProxyHandler({}))

    def get(path):
        with opener.open("http://127.0.0.1:8080" + path, timeout=5) as response:
            return json.load(response)

    def mark(filename):
        req = request.Request("http://127.0.0.1:8080/memes/used", method="POST", headers={"Content-Type": "application/json"},
                              data=json.dumps({"file": filename}).encode())
        with opener.open(req, timeout=5) as response:
            json.load(response)

    report_path = Path(DSH_ROOT, "remembers-service", "bili-gallery-verification.json")
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    if args.mode in report:
        previous = report[args.mode]
        if previous.get("status") == "failed" and (previous.get("requestSubmitted") is False or "子评论不能带图" in previous.get("result", {}).get("error", "")):
            report.setdefault("previousAttempts", []).append({"mode": args.mode, **report[args.mode]})
        else:
            raise SystemExit("This probe already has a receipt; inspect it instead of dispatching twice")
    # One known catalogue asset keeps this transport probe bounded to a single cached upload.
    catalogue = [row for row in get("/memes?limit=500") if row["file"] == "01-爱你噢.png"]
    if len(catalogue) != 1:
        raise SystemExit("Expected test gallery asset is missing")
    gallery = BiliGallery(lambda: catalogue, mark, "/home/ubuntu/.dsh/media/onebot/memes", Path(DATA_DIR, "bili-gallery-cache"))
    style = {**get("/proactive"), "memeRate": 1}
    model = _build_llm(_load_config())
    raw_replies = []
    original_chat = model.chat
    def capture_chat(*positional, **keywords):
        text = original_chat(*positional, **keywords)
        raw_replies.append(text)
        return text
    model.chat = capture_chat
    handler = object.__new__(Handler)
    runtime = BiliRuntime(lambda: handler, lambda: model, lambda: get("/persona"), DSH_ROOT, DATA_DIR,
                          style=lambda: style, gallery=gallery)
    if runtime.owner_id() != "271413017":
        raise SystemExit("Configured owner changed; do not use this account fixture")
    cfg = validate_config(handler._load_bili_whale().get("automation"))
    cfg["writeWaitSeconds"] = 180
    report[args.mode] = {"status": "running", "started": time.time(), "probabilityFixture": 1}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    submitting = False
    forced_image = False
    try:
        if args.mode == "comment":
            material = {"aid": "117493544917579", "bvid": "BV1gVHA6mEbS", "title": "新角色：大肥鱼"}
            submitting = True
            result = runtime.publish("comment", material, {"comment": "铁盆武器也太有节目效果了，给这条同类举个小尾巴加油。", "meme_file": "01-爱你噢.png"}, cfg)
        elif args.mode == "ownerReply":
            context = runtime.notification_context({"oid": "115936048711790", "rpid": "322073543680", "root": "322073543680", "mid": "271413017"}, cfg)
            context["is_owner"] = True
            draft = runtime.draft_owner_comment(context, cfg)
            if draft.get("meme_file"):
                raise ValueError("Thread replies must not attach images")
            if any(phrase in draft["text"] for phrase in ("点名的又不是我", "点名不是我", "不是在叫我")):
                raise ValueError("The owner mention fixture was not recognized as addressing this account; nothing dispatched")
            submitting = True
            result = runtime.reply_notification(context, draft, cfg)
        else:
            message = {"mid": "271413017", "key": "gallery-probe-" + str(int(time.time())), "text": "想看看你的新表情，和我说句晚安吧。"}
            draft = runtime.draft_dm(message, cfg)
            if not draft.get("meme_file") and args.force_test_image:
                draft["meme_file"] = catalogue[0]["file"]
                forced_image = True
            if not draft.get("meme_file"):
                raise ValueError("Model did not select the offered image; no DM dispatched")
            submitting = True
            result = runtime.send_dm(message, draft, cfg)
        report[args.mode] = {"status": result["status"], "result": result, "modelCalls": model.calls, "probabilityFixture": 1, "forcedTransportImage": forced_image}
        if result["status"] == "failed" and result.get("error", "").startswith("发布前检查失败"):
            report[args.mode]["requestSubmitted"] = False
    except Exception as error:
        report[args.mode] = {"status": "unknown" if submitting else "failed", "requestSubmitted": submitting, "error": str(error), "model": model.health(), "rawReplies": raw_replies}
        raise
    finally:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report[args.mode], ensure_ascii=False))
    if result["status"] != "success" or (args.mode != "ownerReply" and not (result.get("pictureVerified") or result.get("media", {}).get("pictureVerified"))):
        raise SystemExit("Picture delivery has not been verified; probe retained, no automatic retry")


if __name__ == "__main__":
    main()
