"""Reply-level expression sampling using the same policy as the QQ sender."""
import json
import math
from pathlib import Path
import random
import re

DATA = json.loads((Path(__file__).resolve().parent.parent / 'expression-style.json').read_text(encoding='utf-8'))


def sample_text_style(settings, rng=None):
    """Independently draw kaomoji and emoji once for this reply."""
    if settings.get('textStyleEnabled') is not True:
        return None
    rng = rng or random.random
    def draw(key):
        rate = float(settings.get(key, 0.2))
        if not math.isfinite(rate) or not 0 <= rate <= 1:
            raise ValueError('文字表情概率必须在 0 到 1 之间')
        return rate == 1 or (rate > 0 and rng() < rate)
    return {'kaomoji': draw('kaomojiRate'), 'emoji': draw('emojiRate')}


def apply_text_style(text, plan):
    """Format prose without modifying quoted text, code or links."""
    if not plan or not text.strip():
        return text
    protected = []
    def protect(match):
        protected.append(match.group())
        return '\0' + str(len(protected) - 1) + '\0'
    body = re.sub(DATA['protectedPattern'], protect, text)
    body = re.sub(DATA['kaomojiPattern'], lambda match: '' if re.search(DATA['facePattern'], match.group())
                  and not re.search(r'[\u4e00-\u9fff0-9]', match.group())
                  and all(letter in 'mowuxv' for letter in re.findall('[a-z]', match.group())) else match.group(), body)
    body = re.sub(DATA['emojiPattern'], '', body)
    body = re.sub(r'[ \t]+$', '', body, flags=re.M).strip()
    mood = next((row for row in DATA['moods'] if any(word in body for word in row['words'])), DATA['default'])
    body = re.sub('\0([0-9]+)\0', lambda match: protected[int(match[1])], body)
    body = body or '嗯。'
    suffix = ' '.join(mood[key] for key in ('kaomoji', 'emoji') if plan[key])
    return body + (' ' + suffix if suffix else '')
