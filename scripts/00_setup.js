// =============================================================================
// 00_setup.js: prepara o banco caronas_sustentaveis do zero.
//
// S01: seleciona o banco (USE, ver observação abaixo)
// S02: remove as coleções antigas, cria as coleções e os índices
//
// Itens da checklist: USE (equivalente programático; o comando "use" literal
// roda em 00b_use_interativo.mongosh, porque o mongosh não aceita "use" dentro
// de arquivos executados com --file).
//
// O script é idempotente: derruba o banco inteiro antes de recriar, então toda
// execução do run_all.sh parte exatamente do mesmo estado.
// =============================================================================
load(__dirname + "/_helpers.js");

// -----------------------------------------------------------------------------
// S01 | Selecionar o banco da aplicação
// Itens: USE
// getSiblingDB(nome) devolve o banco com esse nome a partir da mesma conexão.
// Atribuir o resultado a "db" tem o mesmo efeito do comando "use nome" no
// shell interativo: todas as operações seguintes passam a valer nesse banco.
// O MongoDB cria o banco de forma preguiçosa, só quando a primeira coleção
// recebe dados ou é criada explicitamente.
// -----------------------------------------------------------------------------
titulo("S01", "Selecionar o banco caronas_sustentaveis", ["USE"]);
db = db.getSiblingDB(NOME_BANCO);
print("Banco selecionado: " + db.getName());

// -----------------------------------------------------------------------------
// S02 | Recriar coleções e índices
// dropDatabase() apaga o banco atual com todas as coleções e índices. Em
// seguida createCollection cria cada coleção vazia de forma explícita (sem
// isso, a coleção só nasceria no primeiro insert).
// -----------------------------------------------------------------------------
titulo("S02", "Remover dados antigos, criar coleções e índices",
  [], ["dropDatabase", "createCollection", "createIndex"]);
// A resposta varia conforme o banco já existia ou não, então só o "ok" é
// impresso, para a saída ser a mesma em qualquer execução.
print("dropDatabase ok: " + db.dropDatabase().ok);

["usuarios", "veiculos", "viagens", "avaliacoes"].forEach(nome => {
  db.createCollection(nome);
  print("Coleção criada: " + nome);
});

// Índice de texto no comentário das avaliações. É pré-requisito do operador
// $text/$search (C07). Cada coleção aceita um único índice de texto.
// default_language "portuguese" ativa o stemming e as stopwords do português:
// "pontual" e "pontualidade" viram o mesmo radical, e palavras como "de", "o"
// e "muito" são ignoradas na indexação.
db.avaliacoes.createIndex(
  { comentario: "text" },
  { name: "idx_texto_comentario", default_language: "portuguese" }
);

// E-mail único: o banco recusa um segundo usuário com o mesmo e-mail.
db.usuarios.createIndex({ email: 1 }, { name: "idx_email_unico", unique: true });

// Índice composto para buscar as viagens de um motorista, opcionalmente
// filtradas por status (C10). Um índice composto só atende consultas que
// usam o seu prefixo (motorista_id, ou motorista_id + status); um filtro só
// por status não o aproveita. C10 mostra isso com explain().
db.viagens.createIndex({ motorista_id: 1, status: 1 }, { name: "idx_motorista_status" });

// Índice no campo de subdocumento usado no filtro de C06.
db.viagens.createIndex({ "origem.cidade": 1 }, { name: "idx_origem_cidade" });

// Placa única: é a chave de negócio usada no upsert de U05.
db.veiculos.createIndex({ placa: 1 }, { name: "idx_placa_unica", unique: true });

print("");
print("Índices criados:");
["usuarios", "veiculos", "viagens", "avaliacoes"].forEach(nome => {
  db.getCollection(nome).getIndexes().forEach(ix => {
    const extra = ix.unique ? " (único)" : ix.default_language ? " (texto, " + ix.default_language + ")" : "";
    print("  " + nome + "." + ix.name + " " + JSON.stringify(ix.key) + extra);
  });
});
