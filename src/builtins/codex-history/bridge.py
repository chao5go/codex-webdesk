#!/usr/bin/env python3
"""One request per process. Node serializes requests and provides shared authentication."""
import base64
import json
import sys
from pathlib import Path
from library import load_sessions, trash_session, create_handoff, export_sessions

try:
    request = json.load(sys.stdin)
    home = Path(request['home']).resolve()
    action = request['action']
    payload = request.get('payload', {})
    if not isinstance(payload, dict):
        raise ValueError('请求参数无效。')
    if action == 'list':
        result = load_sessions(home)
    elif action == 'delete':
        result = trash_session(home, payload.get('id'))
    elif action == 'merge':
        result = create_handoff(home, payload.get('ids'), payload.get('objective', ''))
    elif action == 'export':
        body, filename, mime = export_sessions(home, payload.get('ids'), payload.get('format', 'html'))
        result = {'body': base64.b64encode(body).decode(), 'filename': filename, 'mime': mime}
    else:
        raise ValueError('未知操作。')
    print(json.dumps({'result': result}, ensure_ascii=False))
except (ValueError, TypeError, KeyError, AttributeError) as error:
    print(json.dumps({'status': 400, 'error': str(error) or '请求无效。'}, ensure_ascii=False))
except FileNotFoundError as error:
    print(json.dumps({'status': 404, 'error': str(error)}, ensure_ascii=False))
except RuntimeError as error:
    print(json.dumps({'status': 409, 'error': str(error)}, ensure_ascii=False))
except OSError:
    print(json.dumps({'status': 500, 'error': '文件操作失败，请检查目录权限。'}, ensure_ascii=False))
