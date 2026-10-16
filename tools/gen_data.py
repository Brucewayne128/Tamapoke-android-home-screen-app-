#!/usr/bin/env python3
"""Extrait les tables du firmware TamaPoke (C/C++) vers www/data.js.

Sources lues (dans le dépôt d'origine, passé en argument) :
  dex.h      -> DEX_TBL, noms FR/DE/JA/KO, CLASSIC_DEX
  i18n.cpp   -> STRINGS[lang][id], MED_NAME/LBL/DSC
  species.h  -> sprites 16x16 / 32x32 (icônes, œuf, caca, cœur) + palette
  glcdfont.h -> police 5x7 classique d'Arduino_GFX (CP437)

Les chaînes des langues latines restent en octets CP437 (comme sur la carte :
la police bitmap est indexée en CP437) ; JA/KO sont décodées en UTF-8.
"""
import json
import re
import sys
from pathlib import Path

LANGS = ["ES", "EN", "FR", "DE", "IT", "PT", "JA", "KO"]
CJK = {"JA", "KO"}


def strip_comments(src: str) -> str:
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i = j + 1
        elif src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
        elif src.startswith("/*", i):
            i = src.index("*/", i) + 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def decode_literal(body: str) -> bytes:
    """Contenu d'un littéral C (sans guillemets) -> octets."""
    raw = body.encode("utf-8")
    out = bytearray()
    i = 0
    while i < len(raw):
        b = raw[i]
        if b != 0x5C:  # '\\'
            out.append(b)
            i += 1
            continue
        nxt = chr(raw[i + 1])
        if nxt in "01234567":
            j = i + 1
            k = 0
            while j < len(raw) and k < 3 and chr(raw[j]) in "01234567":
                j += 1
                k += 1
            out.append(int(raw[i + 1:j].decode(), 8) & 0xFF)
            i = j
        else:
            out.append({"n": 10, "t": 9, "r": 13, "0": 0}.get(nxt, ord(nxt)))
            i += 2
    return bytes(out)


TOKEN = re.compile(r'"((?:[^"\\]|\\.)*)"|(nullptr)|([{}])|(,)', re.S)


def parse_array(src: str, name: str):
    """Parse 'name[...] = { ... };' en listes imbriquées de bytes/None."""
    m = re.search(re.escape(name) + r"\s*(\[[^\]]*\])+\s*=\s*\{", src)
    if not m:
        raise SystemExit(f"table introuvable : {name}")
    pos = m.end() - 1
    stack = []
    cur = None
    pending = None  # littéral en cours (concaténation)
    for t in TOKEN.finditer(src, pos):
        lit, null, brace, comma = t.groups()
        if lit is not None:
            pending = (pending or b"") + decode_literal(lit)
        elif null:
            pending = None
            cur.append(None)
        elif brace == "{":
            new = []
            if cur is not None:
                stack.append(cur)
            cur = new
        elif brace == "}":
            if pending is not None:
                cur.append(pending)
                pending = None
            if not stack:
                return cur
            parent = stack.pop()
            parent.append(cur)
            cur = parent
        elif comma:
            if pending is not None:
                cur.append(pending)
                pending = None
    raise SystemExit(f"fin de table manquante : {name}")


def to_js(b, lang):
    if b is None:
        return None
    if lang in CJK:
        return b.decode("utf-8")
    return b.decode("latin-1")  # 1 octet = 1 code CP437


def main(repo: Path, gfx: Path, out: Path):
    i18n = strip_comments((repo / "i18n.cpp").read_text(encoding="utf-8"))
    dex_src = strip_comments((repo / "dex.h").read_text(encoding="utf-8"))
    spe_src = strip_comments((repo / "species.h").read_text(encoding="utf-8"))

    strings = parse_array(i18n, "STRINGS")
    assert len(strings) == len(LANGS), len(strings)
    n = len(strings[0])
    assert all(len(s) == n for s in strings), [len(s) for s in strings]
    data = {"STR": {}, "MED_NAME": {}, "MED_LBL": {}, "MED_DSC": {}}
    for li, lang in enumerate(LANGS):
        data["STR"][lang] = [to_js(b, lang) for b in strings[li]]
    for key in ("MED_NAME", "MED_LBL", "MED_DSC"):
        tbl = parse_array(i18n, key)
        for li, lang in enumerate(LANGS):
            data[key][lang] = [to_js(b, lang) for b in tbl[li]]

    # enum StrId -> noms (pour garder les mêmes identifiants côté JS)
    ids = re.search(r"enum StrId : uint8_t \{(.*?)\};",
                    strip_comments((repo / "i18n.h").read_text(encoding="utf-8")), re.S).group(1)
    names = [x.strip() for x in ids.split(",") if x.strip()]
    assert names[-1] == "STR_COUNT" and len(names) - 1 == n, (len(names), n)
    data["STR_IDS"] = names[:-1]

    # DEX_TBL
    body = re.search(r"DEX_TBL\[DEX_COUNT \+ 1\] = \{(.*?)\n\};", dex_src, re.S).group(1)
    rar = {"R_EVO": 0, "R_COMUN": 1, "R_RARO": 2, "R_LEGENDARIO": 3}
    dex = []
    for m in re.finditer(r"\{\s*\"([^\"]*)\",([^}]*)\}", body):
        f = [x.strip() for x in m.group(2).split(",")]
        v = [rar[x] if x in rar else int(x, 0) for x in f]
        dex.append({"name": m.group(1), "evolvesTo": v[0], "evolveLevel": v[1],
                    "rarity": v[2], "accent": v[3], "bHp": v[4], "bAtk": v[5],
                    "bDef": v[6], "bSpe": v[7], "biome": v[8]})
    assert len(dex) == 152, len(dex)
    data["DEX"] = dex
    for lang in ("FR", "DE", "JA", "KO"):
        tbl = parse_array(dex_src, f"DEX_NAME_{lang}")
        assert len(tbl) == 152, (lang, len(tbl))
        data[f"DEX_NAME_{lang}"] = [to_js(b, lang) if b else None for b in tbl]
    data["CLASSIC_DEX"] = [int(x) for x in re.search(
        r"CLASSIC_DEX\[\] = \{([^}]*)\}", dex_src).group(1).split(",")]

    # palette des sprites + cartes
    pal = {}
    for m in re.finditer(r"case '(.)': return (0x[0-9A-Fa-f]+);", spe_src):
        pal[m.group(1)] = int(m.group(2), 16)
    data["SPR_PAL"] = pal
    maps = {}
    for m in re.finditer(r"static const char\* const (SPR_\w+)\[\d+\] = \{(.*?)\};", spe_src, re.S):
        rows = re.findall(r'"([^"]*)"', m.group(2))
        maps[m.group(1)] = rows
    for need in ("SPR_ICON_FOOD", "SPR_ICON_PLAY", "SPR_ICON_LIGHT", "SPR_ICON_CLEAN",
                 "SPR_ICON_BERRY_B", "SPR_ICON_BERRY_G", "SPR_ICON_CANDY",
                 "SPR_EGG", "SPR_POOP", "SPR_HEART"):
        assert need in maps, need
    data["SPR"] = {k: v for k, v in maps.items()
                   if k.startswith("SPR_ICON") or k in ("SPR_EGG", "SPR_POOP", "SPR_HEART")}

    # police classique 5x7 (256 glyphes x 5 colonnes)
    font_src = strip_comments((gfx / "src/font/glcdfont.h").read_text(encoding="utf-8"))
    fb = re.search(r"font\[\]\s*PROGMEM\s*=\s*\{(.*?)\};", font_src, re.S).group(1)
    font = [int(x, 16) for x in re.findall(r"0x[0-9A-Fa-f]{2}", fb)]
    assert len(font) == 256 * 5, len(font)
    data["FONT"] = font

    out.parent.mkdir(parents=True, exist_ok=True)
    js = "// GÉNÉRÉ par tools/gen_data.py depuis le firmware TamaPoke - ne pas éditer\n"
    js += "window.TP_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    out.write_text(js, encoding="utf-8")
    print(f"{out}: {len(js)//1024} Ko, {n} chaînes x {len(LANGS)} langues, {len(maps)} sprites")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
