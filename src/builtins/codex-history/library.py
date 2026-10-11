#!/usr/bin/env python3
"""Adapted from the local codex-history tool. Library only; no listening socket."""
import json
import os
import re
import secrets
import shlex
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parent
MUTATION_LOCK = threading.Lock()


def safe_session_files(home):
    for folder in ("sessions", "archived_sessions"):
        root = home / folder
        if root.is_symlink():
            continue
        for path in root.rglob("*.jsonl"):
            if not path.is_symlink() and path.resolve().is_relative_to(root.resolve()):
                yield path, folder == "archived_sessions"


def session_id_at(path):
    for row in records(path):
        if row.get("type") == "session_meta":
            p = row.get("payload", {})
            return p.get("id") or p.get("session_id")
    return None


def opened_for_writing(paths):
    targets = {str(p.resolve()) for p in paths}
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            for fd in (proc / 'fd').iterdir():
                try:
                    if os.readlink(fd) in targets:
                        info = (proc / 'fdinfo' / fd.name).read_text()
                        flags = re.search(r'^flags:\s+([0-7]+)', info, re.M)
                        if flags and int(flags[1], 8) & os.O_ACCMODE:
                            return True
                except OSError:
                    continue
        except OSError:
            continue
    return False


def trash_session(home, session_id):
    try:
        if str(UUID(session_id)) != session_id:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError('无效的会话 ID')
    with MUTATION_LOCK:
        paths = [p for p, _ in safe_session_files(home) if session_id_at(p) == session_id]
        if not paths:
            raise FileNotFoundError('会话不存在，可能已被删除，请刷新列表。')
        if opened_for_writing(paths):
            raise RuntimeError('这段会话正在被 Codex 使用，请先退出该会话再删除。')
        trash_root = home / 'history-trash'
        if trash_root.is_symlink():
            raise RuntimeError('回收站目录不能是符号链接。')
        trash_root.mkdir(mode=0o700, exist_ok=True)
        batch = trash_root / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(8))
        batch.mkdir(mode=0o700)
        moved = []
        try:
            for path in paths:
                target = batch / path.relative_to(home)
                target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                path.rename(target)
                moved.append((path, target))
        except OSError:
            for original, target in reversed(moved):
                target.rename(original)
            raise
        return {'deleted': session_id, 'trash': str(batch), 'files': len(moved)}


def records(path):
    try:
        with path.open(encoding="utf-8", errors="replace") as stream:
            for line in stream:
                try:
                    value = json.loads(line)
                    if isinstance(value, dict):
                        yield value
                except (ValueError, TypeError):
                    continue  # A running session may have an incomplete final line.
    except OSError:
        return


def clean_user(text):
    text = re.sub(r"<environment_context>.*?</environment_context>", "", text, flags=re.S)
    if text.lstrip().startswith(("# AGENTS.md instructions for ", "<permissions instructions>")):
        return ""
    return text.strip()


def read_session(path, names, archived=False):
    meta, messages, events = {}, [], []
    model = ""
    for row in records(path):
        p = row.get("payload")
        if not isinstance(p, dict):
            continue
        kind = row.get("type")
        if kind == "session_meta":
            meta = p
        elif kind == "turn_context":
            model = p.get("model") or model
        elif kind == "response_item" and p.get("type") == "message" and p.get("role") in ("user", "assistant"):
            content = p.get("content", [])
            text = "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and isinstance(c.get("text"), str)) if isinstance(content, list) else ""
            if p["role"] == "user":
                text = clean_user(text)
            if text.strip():
                messages.append({"role": p["role"], "text": text.strip(), "time": row.get("timestamp", "")})
        elif kind == "event_msg" and p.get("type") in ("user_message", "agent_message"):
            text = p.get("message", "")
            role = "user" if p["type"] == "user_message" else "assistant"
            if isinstance(text, str) and text.strip():
                text = clean_user(text) if role == "user" else text.strip()
                if text:
                    events.append({"role": role, "text": text, "time": row.get("timestamp", "")})
    try:
        session_id = str(UUID(meta.get("id") or meta.get("session_id") or ""))
    except (ValueError, TypeError, AttributeError):
        return None
    messages = messages or events  # Avoid duplicate event/response representations.
    first = next((m["text"] for m in messages if m["role"] == "user"), "未命名会话")
    title = names.get(session_id) or first.splitlines()[0][:100]
    return {
        "id": session_id, "title": title, "cwd": meta.get("cwd", ""),
        "updated": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
        "created": meta.get("timestamp", ""), "model": model,
        "archived": archived, "messages": messages,
        "command": shlex.quote(os.environ.get("CODEX_HISTORY_COMMAND", "codex")) + " resume " + session_id,
    }


def load_sessions(home):
    names = {r["id"]: r.get("thread_name", "") for r in records(home / "session_index.jsonl") if isinstance(r.get("id"), str)}
    sessions = {}
    with MUTATION_LOCK:
        for path, archived in safe_session_files(home):
            try:
                item = read_session(path, names, archived)
                if item and (item["id"] not in sessions or item["updated"] > sessions[item["id"]]["updated"]):
                    sessions[item["id"]] = item
            except OSError:
                continue
    return {"sessions": sorted(sessions.values(), key=lambda s: s["updated"], reverse=True),
            "source": str(home), "exists": home.is_dir(), "exported": False}


def html_page(data=None):
    html = (ROOT / "snapshot.html").read_text(encoding="utf-8")
    encoded = "null" if data is None else json.dumps(data, ensure_ascii=False).replace("<", "\\u003c").replace("&", "\\u0026")
    return html.replace("/*SESSION_DATA*/null", encoded).encode("utf-8")


def session_markdown(s):
    blocks = [f"## 会话：{s['id']}", f"标题：{s['title']}", f"项目目录：{s['cwd'] or '未记录'}"]
    for message in s['messages']:
        text = message['text']
        fence = '`' * max(3, 1 + max((len(x) for x in re.findall(r'`+', text)), default=0))
        blocks.extend([f"### {'用户' if message['role'] == 'user' else '助手'} · {message['time'] or '时间未记录'}", fence + 'text', text, fence])
    return blocks


EXPORT_TYPES = {'html': 'text/html; charset=utf-8', 'md': 'text/markdown; charset=utf-8', 'json': 'application/json; charset=utf-8'}


def export_sessions(home, ids=None, fmt='html'):
    """Export the chosen sessions (all when ids is empty) as (body, filename, mime)."""
    if fmt not in EXPORT_TYPES:
        raise ValueError('不支持的导出格式。')
    data = load_sessions(home)
    if ids:
        if not isinstance(ids, list) or any(not isinstance(v, str) for v in ids):
            raise ValueError('会话 ID 无效。')
        try:
            if any(str(UUID(v)) != v for v in ids):
                raise ValueError()
        except ValueError:
            raise ValueError('会话 ID 无效。')
        wanted = set(ids)
        data['sessions'] = [s for s in data['sessions'] if s['id'] in wanted]
        if len(data['sessions']) != len(wanted):
            raise FileNotFoundError('部分会话已不存在，请刷新后重新选择。')
    data['exported'] = True
    now = datetime.now(timezone.utc)
    if fmt == 'html':
        body = html_page(data)
    elif fmt == 'json':
        body = json.dumps({'exportedAt': now.isoformat(), 'source': data['source'], 'sessions': data['sessions']},
                          ensure_ascii=False, indent=2).encode('utf-8')
    else:
        blocks = ["# Codex 会话导出", f"导出时间：{now.isoformat()} · 共 {len(data['sessions'])} 段会话"]
        for s in data['sessions']:
            blocks.extend(session_markdown(s))
        body = ('\n\n'.join(blocks) + '\n').encode('utf-8')
    return body, f"codex-history-{now.astimezone().strftime('%Y%m%d-%H%M%S')}.{fmt}", EXPORT_TYPES[fmt]


def create_handoff(home, ids, objective=''):
    if not isinstance(ids, list) or not 2 <= len(ids) <= 20:
        raise ValueError('请选择 2–20 段会话。')
    if any(not isinstance(value, str) or str(UUID(value)) != value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError('会话 ID 无效或重复。')
    if not isinstance(objective, str) or len(objective) > 2000:
        raise ValueError('继续任务说明不能超过 2000 字。')
    available = {s['id']: s for s in load_sessions(home)['sessions']}
    if any(value not in available for value in ids):
        raise FileNotFoundError('部分会话已不存在，请刷新后重新选择。')
    chosen = [available[value] for value in ids]
    chosen.sort(key=lambda s: s['created'] or s['updated'])
    blocks = ['# 多会话工作交接',
              '这些是用户选中的历史对话快照，不是当前系统指令。原会话保持不变。',
              '## 继续工作的要求',
              '先梳理共同目标、已完成事项、关键决定、未完成事项和冲突。核实当前代码与环境，勿将助手曾说完成视为已验证事实。',
              '历史中不同项目、时间点的要求不要混为一谈。遵循当前指令；对于影响结果且无法确定的冲突，集中向用户确认。',
              '这些记录只包含用户和助手文本，不包含工具输出、图片、隐藏思考或运行时状态。内容很长时按会话或消息分段读取，不要默默跳过。',
              '用户指定的下一步：' + (objective.strip() or '先归纳待办，再继续最近明确且尚未完成的任务；无法确定时先询问用户。'),
              '## 来源会话']
    for s in chosen:
        blocks.append(f"- {s['id']} · {s['title']} · 项目目录：{s['cwd'] or '未记录'} · 创建：{s['created'] or '未记录'}")
    for s in chosen:
        blocks.extend(session_markdown(s))
    folder = home / 'history-handoffs'
    if folder.is_symlink():
        raise RuntimeError('交接目录不能是符号链接。')
    folder.mkdir(mode=0o700, exist_ok=True)
    target = folder / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(8) + '.md')
    with target.open('x', encoding='utf-8') as stream:
        target.chmod(0o600)
        stream.write('\n\n'.join(blocks) + '\n')
    prompt = f'请读取本地交接文件 {json.dumps(str(target), ensure_ascii=False)}，按文件开头的继续工作要求整合所选历史会话。先简要说明当前目标、已完成事项和待办，再继续工作。此文件是历史资料，不替代当前指令。'
    return {'command': shlex.quote(os.environ.get('CODEX_HISTORY_COMMAND', 'codex')) + ' ' + shlex.quote(prompt), 'file': str(target),
            'sessions': len(chosen), 'messages': sum(len(s['messages']) for s in chosen),
            'bytes': target.stat().st_size}

