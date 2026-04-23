"""
Analyse des sessions pi pour quantifier frictions lean-ctx et cymbal.
Version 2 : détection destructive élargie + classification des patterns de retry.
"""

import json, re, os, glob, sys
from collections import defaultdict, Counter

SESSION_ROOTS = [
    os.path.expanduser("~/.pi/agent/sessions/--C--Users-ae265409-pi_projects-mcmg2--"),
    os.path.expanduser("~/.pi/agent/sessions/--C--Users-ae265409-pi_projects-mcmg3--"),
    os.path.expanduser("~/.pi/agent/sessions/--C--Users-ae265409-pi_projects-staging_mcmg--"),
]
CUTOFF = "2026-04-18"

stats = defaultdict(int)
retry_patterns = Counter()          # {"gh --json": N, ...}
retry_examples = defaultdict(list)  # pattern -> [(before, after)]
destructive_examples = []
cymbal_real_uses = []
killswitch_not_retry = Counter()    # patterns utilisés directement avec killswitch (l'agent sait déjà)

RE_LEAN_CTX_FOOTER = re.compile(r'\[lean-ctx:\s*\d+\s*(?:\u2192|->)\s*\d+')
# Schéma-only: "key: str", "key: int", "key: [...]"  — au moins 2 occurrences pour être robuste
RE_SCHEMA_LINE = re.compile(r'^\s*\w+:\s*(?:str|int|float|bool|none|null|\[.*\]|\{.*\})\s*$', re.M)
RE_N_ITEMS = re.compile(r'^\[\d+\s+items,\s+each:', re.M)
RE_LINES_UNIQUE = re.compile(r'\d+\s+lines\s*(?:\u2192|->)\s*\d+\s+unique')
RE_LAST_N = re.compile(r'last\s+\d+\s+unique\s+lines')
# "1 errors" / "N errors" sans détail (signature de compression aggressive sur test runner)
RE_ERRORS_SUMMARY = re.compile(r'^\d+\s+errors?:', re.M)

def classify_cmd(cmd):
    """Retourne une catégorie simplifiée pour un cmd."""
    c = cmd.replace('LEAN_CTX_DISABLED=1', '').strip()
    if re.search(r'\bgh\s+(pr|issue|run)\b.*--json', c):
        return 'gh --json'
    if re.search(r'\bgh\s+(pr|issue)\s+view\b', c):
        return 'gh view'
    if re.search(r'\bgh\s+(pr|issue)\s+list\b', c):
        return 'gh list'
    if re.search(r'\bgh\s+run\s+(list|view|watch)', c):
        return 'gh run'
    if re.search(r'\bgit\s+(log|show|diff|status)\b', c):
        return 'git (log/show/diff/status)'
    if re.search(r'\bgit\s+(cat-file|ls-tree|rev-list)\b', c):
        return 'git (cat-file/ls-tree)'
    if re.search(r'\bnpm\s+(test|run\s+test)', c) or re.search(r'\bvitest\b', c):
        return 'test runner'
    if re.search(r'\b(grep|rg)\b', c):
        return 'grep/rg'
    if re.search(r'\bdiff\b[^|]', c):
        return 'diff(1)'
    if re.search(r'\b(cat|head|tail)\b.*\.json', c):
        return 'cat/head on .json'
    if re.search(r'\b(cat|head|tail)\b', c):
        return 'cat/head/tail'
    if re.search(r'\b(ls|find|tree)\b', c):
        return 'ls/find'
    if re.search(r'\b(jq|yq)\b', c):
        return 'jq/yq'
    if re.search(r'\bpython\b', c):
        return 'python script'
    return 'other'

def looks_destructive(output):
    if not isinstance(output, str) or not RE_LEAN_CTX_FOOTER.search(output):
        return None
    reasons = []
    # (a) multiple schema lines
    if len(RE_SCHEMA_LINE.findall(output)) >= 2:
        reasons.append('schema-only JSON')
    if RE_N_ITEMS.search(output):
        reasons.append('N items each')
    if RE_LINES_UNIQUE.search(output) and RE_LAST_N.search(output):
        reasons.append('lines dedup + last N')
    # (d) "N errors:" courts sans détails — fréquent sur vitest/jest compressés
    if RE_ERRORS_SUMMARY.search(output) and len(output) < 2000:
        reasons.append('error summary truncated')
    return reasons or None

def is_identifier_grep(cmd):
    m = re.search(r'\b(?:grep|rg)\b[^|;&]*?["\']?([a-z_][a-zA-Z0-9_]{3,}|[A-Z][a-zA-Z0-9]{3,})["\']?', cmd)
    if not m:
        return None
    token = m.group(1)
    blacklist = {'true','false','null','const','type','body','main','test','error','import','export','return','function','description','scope','commit','branch','status','state','label','labels','title','name','version','value','config','output','input'}
    if token in blacklist or token.endswith(('.md','.ts','.tsx','.js','.json','.yml','.yaml','.sh','.py')):
        return None
    if (re.match(r'^[a-z]+[A-Z]', token) or
        re.match(r'^[A-Z][a-z]+[A-Z]', token) or
        ('_' in token and re.match(r'^[a-z_]+$', token))):
        return token
    return None

def extract_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                for key in ('text', 'thinking'):
                    if key in block and isinstance(block[key], str):
                        parts.append(block[key])
        return '\n'.join(parts)
    return ''

grep_idents = Counter()

for root in SESSION_ROOTS:
    if not os.path.isdir(root):
        continue
    for path in sorted(glob.glob(os.path.join(root, "*.jsonl"))):
        fname = os.path.basename(path)
        if fname < CUTOFF:
            continue
        stats['sessions_scanned'] += 1
        last_bash_cmd = None
        last_bash_output = None
        try:
            with open(path, encoding='utf-8', errors='replace') as f:
                for line in f:
                    try:
                        obj = json.loads(line)
                    except:
                        continue
                    if obj.get('type') != 'message':
                        continue
                    msg = obj.get('message', {})
                    role = msg.get('role')
                    content = msg.get('content', '')

                    if role == 'assistant' and isinstance(content, list):
                        for block in content:
                            if not isinstance(block, dict):
                                continue
                            if block.get('type') == 'toolCall' and block.get('name') == 'bash':
                                cmd = block.get('arguments', {}).get('command', '')
                                stats['bash_commands'] += 1
                                cat = classify_cmd(cmd)

                                if 'LEAN_CTX_DISABLED=1' in cmd:
                                    stats['killswitch_uses'] += 1
                                    is_retry = False
                                    if last_bash_cmd:
                                        prev_key = classify_cmd(last_bash_cmd)
                                        if prev_key == cat and 'LEAN_CTX_DISABLED' not in last_bash_cmd:
                                            # même catégorie → probable retry
                                            is_retry = True
                                    if is_retry:
                                        stats['killswitch_as_retry'] += 1
                                        retry_patterns[cat] += 1
                                        if len(retry_examples[cat]) < 3:
                                            retry_examples[cat].append((last_bash_cmd[:150], cmd[:150]))
                                    else:
                                        killswitch_not_retry[cat] += 1

                                # actual cymbal use (outside a python heredoc)
                                if re.search(r'\bcymbal\s+(search|investigate|impact|trace|refs|impls|show|outline|context)\b', cmd):
                                    stats['cymbal_real_uses'] += 1
                                    cymbal_real_uses.append(cmd[:120])

                                if re.search(r'\b(grep|rg)\b', cmd):
                                    ident = is_identifier_grep(cmd)
                                    if ident:
                                        grep_idents[ident] += 1

                                last_bash_cmd = cmd

                    elif role == 'toolResult' and isinstance(content, list):
                        # session v3 : results are their own role
                        for block in content:
                            if isinstance(block, dict) and block.get('type') == 'text':
                                text = block.get('text', '')
                                if isinstance(text, str):
                                    last_bash_output = text[:5000]
                                    reasons = looks_destructive(text)
                                    if reasons:
                                        stats['destructive_output'] += 1
                                        if last_bash_cmd and 'LEAN_CTX_DISABLED' not in last_bash_cmd:
                                            if len(destructive_examples) < 20:
                                                destructive_examples.append((last_bash_cmd[:120], reasons, text[:250]))
        except Exception as e:
            print(f"Error on {fname}: {e}", file=sys.stderr)

print("=" * 70)
print("STATS GLOBALES")
print("=" * 70)
for k, v in sorted(stats.items()):
    print(f"  {k}: {v}")

print(f"\n{'='*70}\nCATÉGORIES DE COMMANDES RETRYÉES AVEC LEAN_CTX_DISABLED=1 (= friction pure)")
print("=" * 70)
for cat, n in retry_patterns.most_common():
    print(f"  {n:>3}x  {cat}")

print(f"\n{'='*70}\nCATÉGORIES utilisées d'entrée avec LEAN_CTX_DISABLED=1 (agent sait déjà)")
print("=" * 70)
for cat, n in killswitch_not_retry.most_common():
    print(f"  {n:>3}x  {cat}")

print(f"\n{'='*70}\nEXEMPLES concrets de retry par catégorie")
print("=" * 70)
for cat in retry_patterns:
    print(f"\n### {cat}")
    for before, after in retry_examples[cat][:2]:
        print(f"  BEFORE: {before[:120]}")
        print(f"  AFTER:  {after[:120]}")

print(f"\n{'='*70}\nDESTRUCTIVE OUTPUTS détectés (lean-ctx a cassé la structure)")
print("=" * 70)
for cmd, reasons, preview in destructive_examples[:12]:
    print(f"\n  CMD: {cmd}")
    print(f"  REASONS: {reasons}")
    print(f"  OUT (200c): {preview[:200].replace(chr(10),' | ')}")

print(f"\n{'='*70}\nTOP grep/rg sur identifier (candidats cymbal)")
print("=" * 70)
for ident, n in grep_idents.most_common(25):
    print(f"  {n:>3}x  {ident}")

print(f"\n{'='*70}\nVÉRITABLE usage cymbal (commande cymbal réelle)")
print("=" * 70)
for c in cymbal_real_uses[:10]:
    print(f"  {c}")
if not cymbal_real_uses:
    print("  (aucun)")
