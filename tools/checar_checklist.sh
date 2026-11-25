#!/usr/bin/env bash
# =============================================================================
# checar_checklist.sh: confere se os 30 itens da checklist oficial (IF685,
# 2026.2) aparecem em código
# executado nos scripts (scripts/*.js e scripts/*.mongosh).
#
# Antes de procurar, remove comentários (// e /* */) e o conteúdo de strings
# ('...', "...", `...`), para que um item citado só em comentário ou texto
# impresso não conte. Imprime a tabela item, encontrado e arquivos, e o total
# N/30. Sai com erro se N < 30.
# =============================================================================
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

python3 - "$RAIZ/scripts" <<'PY'
import re, sys, pathlib

pasta = pathlib.Path(sys.argv[1])
arquivos = sorted([p for p in pasta.iterdir() if p.suffix in (".js", ".mongosh")])

def limpar(codigo):
    """Remove comentários e o conteúdo das strings, preservando o resto."""
    saida, i, n = [], 0, len(codigo)
    while i < n:
        c = codigo[i]
        if codigo.startswith("//", i):
            fim = codigo.find("\n", i)
            i = n if fim < 0 else fim
        elif codigo.startswith("/*", i):
            fim = codigo.find("*/", i + 2)
            i = n if fim < 0 else fim + 2
        elif c in "'\"`":
            j = i + 1
            while j < n and codigo[j] != c:
                j += 2 if codigo[j] == "\\" else 1
            saida.append(c + c)  # string vazia no lugar do conteúdo
            i = j + 1
        else:
            saida.append(c)
            i += 1
    return "".join(saida)

codigo = {p.name: limpar(p.read_text(encoding="utf-8")) for p in arquivos}

itens = [
    (1,  "USE",              r"(?m)^\s*use\s+caronas_sustentaveis\b"),
    # FIND, FINDONE e SORT exigem a chamada sobre uma coleção (db.colecao ou
    # db.getCollection("...")) ou, no caso do sort, um objeto de ordenação:
    # assim .find() e .sort() de arrays JavaScript não contam.
    (2,  "FIND",             r"\bdb\.(?:\w+|getCollection\([^)]*\))\.find\("),
    (3,  "SIZE",             r"\$size\s*:"),
    (4,  "AGGREGATE",        r"\.aggregate\("),
    (5,  "MATCH",            r"\$match\s*:"),
    (6,  "PROJECT",          r"\$project\s*:"),
    (7,  "GTE",              r"\$gte\s*:"),
    (8,  "GROUP",            r"\$group\s*:"),
    (9,  "SUM",              r"\$sum\s*:"),
    (10, "COUNTDOCUMENTS",   r"\.countDocuments\("),
    (11, "MAX",              r"\$max\s*:"),
    (12, "AVG",              r"\$avg\s*:"),
    (13, "EXISTS",           r"\$exists\s*:"),
    (14, "SORT",             r"\.sort\(\s*\{|\$sort\s*:"),
    (15, "LIMIT",            r"\.limit\(|\$limit\s*:"),
    (16, "EXPR",             r"\$expr\s*:"),
    (17, "FUNCTION",         r"\$function\s*:|\$where\s*:\s*function|\bemit\("),
    (18, "PRETTY",           r"\.pretty\(\)"),
    (19, "ALL",              r"\$all\s*:"),
    (20, "SET",              r"\$set\s*:"),
    (21, "TEXT",             r"\$text\s*:"),
    (22, "SEARCH",           r"\$search\s*:"),
    (23, "FILTER",           r"\$filter\s*:"),
    (24, "UPDATEONE/UPDATEMANY", r"\.updateOne\(|\.updateMany\("),
    (25, "INSERTONE",        r"\.insertOne\("),
    (26, "RENAMECOLLECTION", r"\.renameCollection\("),
    (27, "COND",             r"\$cond\s*:"),
    (28, "LOOKUP",           r"\$lookup\s*:"),
    (29, "FINDONE",          r"\bdb\.(?:\w+|getCollection\([^)]*\))\.findOne\("),
    (30, "ADDTOSET",         r"\$addToSet\s*:"),
]

# Cada script aparece pelo prefixo numérico, para a tabela caber em 78 colunas.
def rotulo(arq):
    return arq.split("_")[0] or "aux"

print("Scripts analisados:")
for arq in codigo:
    print(f"  {rotulo(arq):<4} {arq}")
print()
encontrados = 0
print(f"{'#':>2}  {'Item':<21} {'Achou':<6} Scripts (ocorrências)")
print("-" * 78)
for num, nome, padrao in itens:
    rx = re.compile(padrao)
    onde = []
    for arq, txt in codigo.items():
        qtd = len(rx.findall(txt))
        if qtd:
            onde.append(f"{rotulo(arq)} ({qtd})")
    ok = bool(onde)
    encontrados += ok
    print(f"{num:>2}  {nome:<21} {'sim' if ok else 'NÃO':<6} {', '.join(onde) if onde else '-'}")
print("-" * 78)
print(f"Total: {encontrados}/30")
sys.exit(0 if encontrados == 30 else 1)
PY
