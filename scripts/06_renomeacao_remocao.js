// =============================================================================
// 06_renomeacao_remocao.js: arquivamento das viagens canceladas e remoções.
//
// R05: contagens antes                              COUNTDOCUMENTS
// R01: copiar canceladas para coleção temporária    AGGREGATE, MATCH, GROUP (outros: $unionWith, $out)
// R02: renomear para historico_cancelamentos        RENAMECOLLECTION
// R03: remover as canceladas da coleção principal   (outros: deleteMany)
// R04: remover uma avaliação ofensiva               FINDONE, TEXT, SEARCH (outros: deleteOne)
// R05: contagens depois, conferidas                 COUNTDOCUMENTS
//
// Roda depois de 05_atualizacoes.js: as 8 viagens canceladas do seed mais as
// 3 que U06 cancelou formam o histórico (11 viagens).
// Reexecução: o histórico nunca é perdido. R01 junta ao temporário o que já
// estava em historico_cancelamentos ($unionWith) antes de gravar, então o
// drop do destino e o renameCollection de R02 podem ser repetidos sem apagar
// arquivamentos anteriores. O script como um todo, porém, consome o estado
// deixado por 05 (depois dele não há mais canceladas em "viagens"): rodado
// de novo sozinho, ele para no R05 com uma mensagem explicando isso. A forma
// de repetir tudo é o run_all.sh, que recria o banco do zero antes.
// =============================================================================
load(__dirname + "/_helpers.js");
db = db.getSiblingDB(NOME_BANCO);

const TEMP = "historico_cancelamentos_tmp";
const DESTINO = "historico_cancelamentos";

// -----------------------------------------------------------------------------
// R05 (antes) | Contagens de referência
// Itens: COUNTDOCUMENTS
// -----------------------------------------------------------------------------
titulo("R05", "Contagens antes do arquivamento e das remoções", ["COUNTDOCUMENTS"]);
const antes = {
  viagens: db.viagens.countDocuments({}),
  canceladas: db.viagens.countDocuments({ status: "cancelada" }),
  historico_cancelamentos: db.getCollection(DESTINO).countDocuments({}),
  avaliacoes: db.avaliacoes.countDocuments({})
};
print(antes);
exigir("R05", antes.canceladas > 0,
  "não há viagens canceladas em viagens: o 06 já rodou neste banco. Para repetir, use ./scripts/run_all.sh");

// -----------------------------------------------------------------------------
// R01 | Copiar as viagens canceladas para uma coleção temporária com $out
// Itens: AGGREGATE, MATCH, GROUP. Outros recursos: $unionWith, $out
//
// $out grava o resultado do pipeline numa coleção. Precisa ser o último
// estágio. Se a coleção de destino já existir, $out a substitui por inteiro
// (de forma atômica: quem lê vê a versão antiga até a nova ficar pronta).
// Por isso, antes do $out, $unionWith acrescenta ao fluxo os documentos que
// já estavam em historico_cancelamentos (se a coleção não existe, não
// acrescenta nada). O temporário fica com o histórico antigo mais as novas
// canceladas, e nada se perde quando R02 trocar o destino.
// $group por _id com $first, seguido de $replaceRoot, elimina duplicatas
// caso uma viagem já arquivada ainda esteja em "viagens" (o $out falharia
// com _id repetido). $$ROOT é o documento inteiro que está passando pelo
// estágio; o $group o guarda no campo "doc", e $replaceRoot promove esse
// subdocumento a documento principal, desfazendo o embrulho. O $sort antes
// do $group torna a escolha determinística (com as datas empatadas, as
// cópias têm o mesmo conteúdo). $addFields marca a data de arquivamento nas
// novas; a conferência compara com o número de _id distintos das duas origens.
// Alternativa sem coleção temporária: o estágio $merge grava incrementalmente
// numa coleção existente (insere os novos e atualiza os que já existem).
// Aqui o caminho é $out + renameCollection, que exercita o item
// RENAMECOLLECTION.
// -----------------------------------------------------------------------------
titulo("R01", "Copiar as viagens canceladas para uma coleção temporária com $out",
  ["AGGREGATE", "MATCH", "GROUP"], ["$unionWith", "$out"]);
db.getCollection(TEMP).drop();
db.viagens.aggregate([
  { $match: { status: "cancelada" } },
  { $addFields: { arquivada_em: DATA_REFERENCIA } },
  { $unionWith: { coll: DESTINO } },
  { $sort: { _id: 1, arquivada_em: 1 } },
  { $group: { _id: "$_id", doc: { $first: "$$ROOT" } } },
  { $replaceRoot: { newRoot: "$doc" } },
  { $out: TEMP }
]);
const qtdTemp = db.getCollection(TEMP).countDocuments({});
const idsEsperados = new Set(
  db.viagens.find({ status: "cancelada" }, { _id: 1 }).toArray()
    .concat(db.getCollection(DESTINO).find({}, { _id: 1 }).toArray())
    .map(d => d._id)
);
print("Documentos em " + TEMP + ": " + qtdTemp +
  " (" + antes.canceladas + " canceladas em viagens + " + antes.historico_cancelamentos +
  " já arquivadas; _id distintos: " + idsEsperados.size + ")");
exigir("R01", qtdTemp === idsEsperados.size, "a cópia não tem todas as canceladas");
print("Exemplo de documento copiado:");
print(db.getCollection(TEMP).findOne(
  { _id: "T0063" },
  { status: 1, motivo_cancelamento: 1, arquivada_em: 1, "passageiros.status": 1 }
));

// -----------------------------------------------------------------------------
// R02 | Renomear a coleção temporária para historico_cancelamentos
// Itens: RENAMECOLLECTION
//
// renameCollection(novoNome) troca o nome da coleção mantendo documentos e
// índices, sem copiar dados. Falha se já existir uma coleção com o novo nome
// (a menos que se passe dropTarget: true). Para o script poder rodar mais de
// uma vez, o destino é apagado antes de forma explícita; isso é seguro
// porque o temporário já contém todo o histórico anterior (R01).
// -----------------------------------------------------------------------------
titulo("R02", "Renomear a coleção temporária para historico_cancelamentos",
  ["RENAMECOLLECTION"]);
print("Coleções antes: " + db.getCollectionNames().sort().join(", "));
db.getCollection(DESTINO).drop();
printjson(db.getCollection(TEMP).renameCollection(DESTINO));
print("Coleções depois: " + db.getCollectionNames().sort().join(", "));
exigir("R02", !db.getCollectionNames().includes(TEMP), "a coleção temporária continua existindo");
print("Viagens no histórico, por motivo:");
mostrar(db.getCollection(DESTINO).aggregate([
  { $group: {
      _id: { $ifNull: ["$motivo_cancelamento", "cancelada pelo motorista ou pelos passageiros"] },
      viagens: { $sum: 1 }
  } },
  { $sort: { _id: 1 } }
]));

// -----------------------------------------------------------------------------
// R03 | Remover as viagens canceladas da coleção principal
// Itens: nenhum. Outros recursos: deleteMany
//
// deleteMany(filtro) apaga todos os documentos que atendem ao filtro e
// devolve deletedCount. A remoção só é feita depois de conferir que o
// histórico tem a mesma quantidade, para não perder dados. Viagens canceladas
// não têm avaliações (regra do seed), então nenhuma avaliação fica órfã.
// -----------------------------------------------------------------------------
titulo("R03", "Remover as viagens canceladas da coleção principal", [], ["deleteMany"]);
const noHistorico = db.getCollection(DESTINO).countDocuments({});
exigir("R03", noHistorico === idsEsperados.size, "histórico incompleto, remoção abortada");
const idsCanceladas = db.viagens.find({ status: "cancelada" }, { _id: 1 }).toArray().map(v => v._id);
print("Conferência (o esperado é 0): avaliações ligadas às viagens canceladas: " +
  db.avaliacoes.countDocuments({ viagem_id: { $in: idsCanceladas } }));
const r03 = db.viagens.deleteMany({ status: "cancelada" });
print(r03);
exigir("R03", r03.deletedCount === antes.canceladas, "quantidade removida diferente da esperada");

// -----------------------------------------------------------------------------
// R04 | Remover uma avaliação ofensiva específica
// Itens: FINDONE, TEXT, SEARCH. Outros recursos: deleteOne
//
// A moderação localiza a avaliação pelos termos ofensivos com busca textual
// ($text/$search) e findOne, confere o documento e só então apaga pelo _id
// com deleteOne. Apagar pelo _id garante que só aquele documento sai, mesmo
// que outro texto parecido exista. Um findOne depois confirma a remoção.
// -----------------------------------------------------------------------------
titulo("R04", "Remover uma avaliação ofensiva específica",
  ["FINDONE", "TEXT", "SEARCH"], ["deleteOne"]);
const ofensiva = db.avaliacoes.findOne({ $text: { $search: "imbecil idiota" } });
exigir("R04", ofensiva !== null,
  "nenhuma avaliação ofensiva encontrada: ela já foi removida numa execução anterior. " +
  "Para repetir, use ./scripts/run_all.sh");
print("Avaliação encontrada:");
print(ofensiva);
const r04 = db.avaliacoes.deleteOne({ _id: ofensiva._id });
print(r04);
exigir("R04", r04.deletedCount === 1, "a avaliação não foi removida");
print("Conferência (o esperado é null): findOne pelo mesmo _id depois da remoção: " +
  db.avaliacoes.findOne({ _id: ofensiva._id }));

// -----------------------------------------------------------------------------
// R05 (depois) | Contagens finais, conferidas contra as de antes
// Itens: COUNTDOCUMENTS
// -----------------------------------------------------------------------------
titulo("R05", "Contagens depois do arquivamento e das remoções", ["COUNTDOCUMENTS"]);
const depois = {
  viagens: db.viagens.countDocuments({}),
  canceladas: db.viagens.countDocuments({ status: "cancelada" }),
  historico_cancelamentos: db.getCollection(DESTINO).countDocuments({}),
  avaliacoes: db.avaliacoes.countDocuments({})
};
print(depois);
const confere = depois.viagens === antes.viagens - antes.canceladas &&
  depois.canceladas === 0 &&
  depois.historico_cancelamentos === idsEsperados.size &&
  depois.avaliacoes === antes.avaliacoes - 1;
print("viagens: " + antes.viagens + " - " + antes.canceladas + " = " + depois.viagens +
  " | avaliacoes: " + antes.avaliacoes + " - 1 = " + depois.avaliacoes +
  " | contagens conferem: " + (confere ? "SIM" : "NÃO"));
exigir("R05", confere, "as contagens não batem");
