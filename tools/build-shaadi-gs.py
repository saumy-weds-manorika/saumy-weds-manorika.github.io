"""Builds apps-script-shaadi/Code.gs from apps-script-shaadi/Code.template.gs.

The shaadi backend shares many helpers with the friends edition's apps-script/Code.gs (travel checks,
People upserts, the Summary's date grids, small helpers). Instead of keeping two hand-made copies in
step, the template names them on `//@@include name1 name2 ...` lines and this script copies each
function, with the comment block right above it, from apps-script/Code.gs.

Run from the repo root:  python tools/build-shaadi-gs.py
Then paste apps-script-shaadi/Code.gs into the shaadi Sheet's Apps Script (docs/SETUP-shaadi.md).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'apps-script' / 'Code.gs'
TEMPLATE = ROOT / 'apps-script-shaadi' / 'Code.template.gs'
OUT = ROOT / 'apps-script-shaadi' / 'Code.gs'
HEADER = ('// GENERATED from apps-script-shaadi/Code.template.gs by tools/build-shaadi-gs.py, with shared helpers\n'
          '// copied from apps-script/Code.gs. Edit the template (or the friends edition), then run the script again.\n')


def function_block(lines, name):
    """The lines of `function name(...) {...}` (ending at the first column-0 '}'), with its comment above."""
    start = next((i for i, l in enumerate(lines) if re.match(r'function ' + re.escape(name) + r'\(', l)), None)
    if start is None:
        sys.exit(f'apps-script/Code.gs has no function {name}')
    end = next(i for i in range(start, len(lines)) if lines[i].rstrip() == '}')
    top = start
    while top > 0 and re.match(r'\s*(/\*\*|\*|\*/|//)', lines[top - 1]):
        top -= 1
    return lines[top:end + 1]


def main():
    source = SOURCE.read_text(encoding='utf-8').split('\n')
    out = []
    for line in TEMPLATE.read_text(encoding='utf-8').split('\n'):
        m = re.match(r'//@@include (.+)$', line)
        if not m:
            out.append(line)
            continue
        for i, name in enumerate(m.group(1).split()):
            if i:
                out.append('')
            out.extend(function_block(source, name))
    OUT.write_text(HEADER + '\n'.join(out), encoding='utf-8', newline='\n')
    print(f'wrote {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
