#!/usr/bin/env python3
from __future__ import annotations
import json, hashlib, sys
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]

def load(rel): return json.loads((ROOT/rel).read_text(encoding='utf-8'))
def fail(msg): print('ERROR:',msg); return 1

def main():
    errors=[]; warnings=[]
    catalog=load('data/catalog.json')
    if catalog.get('schemaVersion')!=3: errors.append('catalog.schemaVersion must be 3')
    pack_ids=[p.get('id') for p in catalog.get('packs',[])]
    if len(pack_ids)!=len(set(pack_ids)): errors.append('duplicate pack id')
    all_ids=set(); groups={}; words={}; dialogues={}; grammar={}; mistakes={}
    for d in catalog.get('packs',[]):
        rel=d['path'].removeprefix('./'); path=ROOT/rel
        raw=path.read_bytes(); sha=hashlib.sha256(raw).hexdigest()
        if sha!=d['sha256']: errors.append(f"sha256 mismatch: {d['id']}")
        p=json.loads(raw)
        if p.get('packId')!=d['id'] or p.get('packType')!=d['type']: errors.append(f"pack metadata mismatch: {d['id']}")
        if len(p.get('items',[]))!=d['itemCount']: errors.append(f"itemCount mismatch: {d['id']}")
        for item in p.get('items',[]):
            iid=item.get('id')
            if not iid: errors.append(f"missing item id in {d['id']}")
            elif iid in all_ids: errors.append(f"global duplicate id: {iid}")
            all_ids.add(iid)
            {'kanji':groups,'vocabulary':words,'dialogue':dialogues,'grammar':grammar,'mistake':mistakes}.get(d['type'],{})[iid]=item
    for g in groups.values():
        for wid in g.get('wordIds',[]):
            if wid not in words: errors.append(f"missing word reference {wid} in {g['id']}")
    pair=Counter((w.get('word'),w.get('reading')) for w in words.values())
    for k,n in pair.items():
        if n>1: errors.append(f"duplicate vocabulary master: {k}")
    sents=[]
    for w in words.values():
        if not w.get('word') or not w.get('reading') or not w.get('meaningsZh'): errors.append(f"required vocabulary field missing: {w.get('id')}")
        for s in w.get('sentences',[]):
            if not s.get('jp'): errors.append(f"empty sentence: {s.get('id')}")
            sents.append(s.get('jp'))
    for text,n in Counter(sents).items():
        if text and n>1: warnings.append(f"duplicate sentence text ({n}): {text}")
    aliases=load('data/id-aliases.json')
    for old,new in aliases.get('wordIds',{}).items():
        if new not in words: errors.append(f"alias points to missing word: {old}->{new}")
    expected=catalog['counts']; actual={'kanjiGroups':len(groups),'uniqueVocabulary':len(words),'wordAssociations':sum(len(g.get('wordIds',[])) for g in groups.values()),'sentences':len(sents),'dialogues':len(dialogues),'dialogueLines':sum(len(d.get('lines',[])) for d in dialogues.values())}
    if expected!=actual: errors.append(f"catalog counts mismatch: expected={expected}, actual={actual}")
    print('Nihongo Lab Phase 1 validation')
    print(json.dumps(actual,ensure_ascii=False,indent=2)); print(json.dumps({'expressionComparisons':len(grammar),'commonMistakes':len(mistakes)},ensure_ascii=False,indent=2))
    for w in warnings: print('WARNING:',w)
    if errors:
        for e in errors: print('ERROR:',e)
        return 1
    print('OK: all checks passed')
    return 0
if __name__=='__main__': raise SystemExit(main())
