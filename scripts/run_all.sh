#!/usr/bin/env bash
# =============================================================================
# run_all.sh: executa todos os scripts em ordem e salva cada saída em saidas/.
#
# 1. Sobe o container mongo-caronas se estiver parado (ou cria, via compose).
# 2. Espera o healthcheck ficar "healthy".
# 3. Roda 00 a 06 com o mongosh de dentro do container.
# 4. Para no primeiro erro (set -euo pipefail e exit code do mongosh).
#
# Como 00_setup.js derruba e recria o banco, toda execução parte do mesmo
# estado e gera as mesmas saídas.
# =============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
CONTAINER="mongo-caronas"
SAIDAS="$RAIZ/saidas"

# --- 1. Container -------------------------------------------------------------
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER já está rodando."
elif docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER parado. Iniciando..."
  docker start "$CONTAINER" >/dev/null
else
  echo "Container $CONTAINER não existe. Criando com docker compose..."
  docker compose up -d
fi

# --- 2. Healthcheck -----------------------------------------------------------
status="desconhecido"
for _ in $(seq 1 60); do
  formato='{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}'
  status="$(docker inspect -f "$formato" "$CONTAINER" 2>/dev/null || echo erro)"
  if [ "$status" = "healthy" ]; then break; fi
  if [ "$status" = "sem-healthcheck" ]; then
    # Container criado com docker run, sem healthcheck: testa o ping direto.
    if docker exec "$CONTAINER" mongosh --quiet --eval "db.adminCommand('ping').ok" >/dev/null 2>&1; then
      status="healthy"
      break
    fi
  fi
  sleep 2
done
if [ "$status" != "healthy" ]; then
  echo "ERRO: o MongoDB não ficou saudável (status: $status)." >&2
  exit 1
fi
echo "MongoDB saudável."

# Os scripts são lidos de /scripts e /tools dentro do container (volumes do
# docker-compose.yml). Um container criado com docker run sem esses volumes
# não consegue executá-los.
if ! docker exec "$CONTAINER" test -f /scripts/00_setup.js -a -f /tools/validar_dados.js; then
  echo "ERRO: o container $CONTAINER não tem ./scripts em /scripts e ./tools em /tools." >&2
  echo "Remova-o (docker rm -f $CONTAINER) e suba com: docker compose up -d" >&2
  exit 1
fi

# --- 3. Scripts ---------------------------------------------------------------
mkdir -p "$SAIDAS"

rodar_arquivo() { # $1 = nome da saída, $2 = caminho dentro do container
  local nome="$1" arquivo="$2"
  echo ">> $nome"
  if ! docker exec -i "$CONTAINER" mongosh --quiet --file "$arquivo" > "$SAIDAS/$nome.txt" 2>&1; then
    echo "ERRO ao executar $arquivo. Últimas linhas de saidas/$nome.txt:" >&2
    tail -n 20 "$SAIDAS/$nome.txt" >&2
    exit 1
  fi
}

rodar_sessao() { # $1 = nome da saída, $2 = arquivo local enviado pela entrada padrão
  local nome="$1" arquivo="$2"
  echo ">> $nome (sessão interativa)"
  docker exec -i "$CONTAINER" mongosh --quiet < "$arquivo" > "$SAIDAS/$nome.txt" 2>&1
  # No modo interativo o mongosh não muda o exit code quando um comando falha,
  # então a saída é conferida.
  if ! grep -q "switched to db caronas_sustentaveis" "$SAIDAS/$nome.txt"; then
    echo "ERRO: a sessão interativa não executou o use. Ver saidas/$nome.txt" >&2
    exit 1
  fi
}

rodar_arquivo 00_setup             /scripts/00_setup.js
rodar_sessao  00b_use_interativo   scripts/00b_use_interativo.mongosh
rodar_arquivo 01_seed              /scripts/01_seed.js
rodar_arquivo 01b_validar_dados    /tools/validar_dados.js
rodar_arquivo 02_consultas_basicas /scripts/02_consultas_basicas.js
rodar_arquivo 03_agregacoes        /scripts/03_agregacoes.js
rodar_arquivo 04_javascript_servidor /scripts/04_javascript_servidor.js
rodar_arquivo 05_atualizacoes      /scripts/05_atualizacoes.js
rodar_arquivo 06_renomeacao_remocao /scripts/06_renomeacao_remocao.js

echo "Concluído. Saídas em saidas/:"
ls -1 "$SAIDAS"
