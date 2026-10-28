"""Opt-in owner-only expression transport checks with persistent one-shot receipts."""
import json
import os
from pathlib import Path
import sys
import time
from urllib import request
from bili_automation import validate_config
from bili_runtime import BiliRuntime
from bili_gallery import BiliGallery
from server import Handler, DSH_ROOT, DATA_DIR


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    if '--execute' not in sys.argv:
        raise SystemExit('Real owner messages require --execute')
    path = Path(DSH_ROOT, 'remembers-service', 'expression-probability-bili-live.json')
    if path.exists():
        raise SystemExit('Probe receipt exists; inspect before any further sends')
    opener = request.build_opener(request.ProxyHandler({}))
    def api(route, value=None):
        req = request.Request('http://127.0.0.1:8080' + route, data=None if value is None else json.dumps(value).encode(),
                              headers={'Content-Type': 'application/json'})
        with opener.open(req, timeout=120) as response:
            return json.load(response)
    saved = api('/proactive')
    catalogue = api('/memes?limit=1000')
    gallery = BiliGallery(lambda: catalogue, lambda filename: api('/memes/used', {'file': filename}),
                          os.environ.get('CMEM_MEME_DIR', '/home/ubuntu/.dsh/media/onebot/memes'), Path(DATA_DIR, 'bili-gallery-cache'),
                          ranker=lambda query, prefer: api('/memes/search', {'q': query, 'context': '用户准备睡觉，说晚安，希望收到一张可爱的晚安表情。'})['memes'])
    handler = object.__new__(Handler)
    cfg = validate_config(handler._load_bili_whale().get('automation'))
    if any(count.get('running', 0) for count in api('/bili/automation').get('counts', {}).values()):
        raise SystemExit('A Bilibili send is already running')
    cases = []
    path.write_text(json.dumps({'status': 'running', 'cases': cases}) + '\n', encoding='utf-8')
    for rate in (0, 1):
        style = {**saved, 'textStyleEnabled': True, 'kaomojiRate': rate, 'emojiRate': rate, 'memeRate': rate}
        runtime = BiliRuntime(lambda: handler, lambda: None, lambda: {}, DSH_ROOT, DATA_DIR, style=lambda: style, gallery=gallery)
        offered = gallery.offer(rate, '晚安 睡觉 睡梦 好梦')
        if rate == 1 and not offered:
            cases.append({'rate': rate, 'status': 'not-sent', 'reason': '未匹配到晚安图片'})
            break
        body = '【表情概率测试 100%】晚安，小鱼来陪你啦。' if rate else '【表情概率测试 0%】这条不会附加语气表情或图库图片。'
        text = runtime.style_text(body)
        filename = gallery.selected(offered[0]['file'], offered) if offered else None
        cases.append({'rate': rate, 'status': 'submitting', 'text': text, 'file': filename})
        path.write_text(json.dumps({'cases': cases}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        result = runtime.send_dm({'key': 'expression-probe-' + str(time.time_ns())}, {'text': text, 'meme_file': filename}, cfg)
        cases[-1]['result'] = result
        cases[-1]['status'] = result['status']
        path.write_text(json.dumps({'cases': cases}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if result['status'] != 'success':
            break
    report = {'cases': cases, 'productionSettingsUnchanged': api('/proactive') == saved}
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
