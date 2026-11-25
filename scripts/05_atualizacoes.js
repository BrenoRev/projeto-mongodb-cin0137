// =============================================================================
// 05_atualizacoes.js: operações de atualização do dia a dia da plataforma.
//
// U01: verificar a CNH de uma motorista aprovada      UPDATEONE, SET, FINDONE
// U02: reajustar 10% as viagens longas agendadas      UPDATEMANY, SET, GTE, EXISTS
// U03: incluir passageiro sem duplicidade             UPDATEONE, ADDTOSET, SET, SIZE, FILTER, EXPR
// U04: adicionar várias preferências de uma vez       UPDATEONE, ADDTOSET ($each)
// U05: cadastrar ou atualizar veículo pela placa      UPDATEONE, SET (outros: upsert)
// U06: cancelar agendadas cuja data já passou         UPDATEMANY, SET
//
// Cada operação mostra o documento antes e depois com findOne, e imprime o
// resultado da escrita devolvido pelo mongosh: matchedCount (quantos
// documentos o filtro achou), modifiedCount (quantos mudaram),
// upsertedCount e insertedId (preenchidos quando um upsert insere um
// documento novo; insertedId traz o _id dele).
//
// As datas de "hoje" usam DATA_REFERENCIA (21/11/2026 à meia-noite em
// Recife, definida em _helpers.js), e não new Date(), para a saída ser igual
// em qualquer dia.
//
// Reexecução: o script parte do estado deixado pelo seed e muda esse estado
// (aprova a CNH, reajusta preços, cancela viagens). Rodá-lo de novo sozinho
// falha de propósito no U01, porque não há mais CNH pendente. A forma de
// repetir é o run_all.sh, que recria o banco do zero antes.
// =============================================================================
load(__dirname + "/_helpers.js");
db = db.getSiblingDB(NOME_BANCO);

// Imprime o objeto de resultado devolvido pelo mongosh, como ele vem.
function resultadoEscrita(r) {
  print(r);
}

// -----------------------------------------------------------------------------
// U01 | Verificar a CNH de uma motorista recém-aprovada
// Itens: UPDATEONE, SET, FINDONE
//
// updateOne(filtro, atualização) altera no máximo um documento: o primeiro
// que atende ao filtro. $set grava o valor do campo; se o campo não existir,
// ele é criado (data_verificacao_cnh nasce aqui). O filtro inclui
// cnh_verificada: false para a operação só valer para quem está pendente.
// -----------------------------------------------------------------------------
titulo("U01", "Verificar a CNH de uma motorista recém-aprovada (U015)",
  ["UPDATEONE", "SET", "FINDONE"]);
const projU01 = { nome: 1, perfis: 1, cnh_verificada: 1, data_verificacao_cnh: 1 };
print("Antes:");
print(exigirNaoVazio("U01", db.usuarios.findOne({ _id: "U015" }, projU01)));
const u01 = db.usuarios.updateOne(
  { _id: "U015", cnh_verificada: false },
  { $set: { cnh_verificada: true, data_verificacao_cnh: DATA_REFERENCIA } }
);
resultadoEscrita(u01);
exigir("U01", u01.modifiedCount === 1,
  "U015 já está verificada: o 05 já rodou neste banco. Para repetir, use ./scripts/run_all.sh");
print("Depois:");
print(db.usuarios.findOne({ _id: "U015" }, projU01));

// -----------------------------------------------------------------------------
// U02 | Reajustar em 10% o preço das viagens agendadas a partir de 100 km e
//       marcar reajustada: true
// Itens: UPDATEMANY, SET, GTE, EXISTS
//
// updateMany altera todos os documentos que atendem ao filtro:
//   status agendada; distância $gte 100; data $gte DATA_REFERENCIA (só
//   viagens futuras); reajustada $exists false (não reajusta duas vezes se a
//   operação for repetida).
// A atualização usa a forma de pipeline (array de estágios). Nela, o estágio
// $set pode calcular o novo valor a partir do valor atual do próprio
// documento: preco_assento x 1,1 arredondado a 2 casas com $round. O
// operador $mul multiplicaria também, mas deixaria resíduo de ponto
// flutuante: 36,5 x 1,1 dá 40.150000000000006 em binário (caso de T0074).
// Regra de negócio: quem já pagou a reserva mantém o valor_pago antigo; o
// novo preço vale para as próximas reservas (U03 inclui uma passageira em
// T0074, que paga o preço novo). O findOne mostra os passageiros da primeira
// viagem reajustada com o valor antigo. A partir daqui essas reservas
// ficam, de propósito, fora da regra "valor_pago = preco_assento" do seed.
// -----------------------------------------------------------------------------
titulo("U02", "Reajustar em 10% as viagens agendadas a partir de 100 km e marcar reajustada: true",
  ["UPDATEMANY", "SET", "GTE", "EXISTS"]);
const filtroU02 = {
  status: "agendada",
  distancia_km: { $gte: 100 },
  data_hora: { $gte: DATA_REFERENCIA },
  reajustada: { $exists: false }
};
const projU02 = { distancia_km: 1, data_hora: 1, preco_assento: 1, reajustada: 1 };
const idsU02 = db.viagens.find(filtroU02, { _id: 1 }).sort({ _id: 1 }).toArray().map(v => v._id);
exigirNaoVazio("U02", idsU02);
print("Antes (viagens que atendem ao filtro):");
mostrar(db.viagens.find({ _id: { $in: idsU02 } }, projU02).sort({ _id: 1 }));
print("Antes, com findOne, a primeira delas (com os passageiros):");
print(db.viagens.findOne({ _id: idsU02[0] }, Object.assign({ passageiros: 1 }, projU02)));
const u02 = db.viagens.updateMany(filtroU02, [
  { $set: { preco_assento: { $round: [{ $multiply: ["$preco_assento", 1.1] }, 2] }, reajustada: true } }
]);
resultadoEscrita(u02);
exigir("U02", u02.modifiedCount === idsU02.length, "quantidade alterada diferente da esperada");
print("Depois:");
mostrar(db.viagens.find({ _id: { $in: idsU02 } }, projU02).sort({ _id: 1 }));
print("Depois, com findOne, a primeira delas (preço novo, valor_pago antigo):");
print(db.viagens.findOne({ _id: idsU02[0] }, Object.assign({ passageiros: 1 }, projU02)));
print("Repetindo o mesmo updateMany (o filtro com $exists impede reajuste duplo):");
resultadoEscrita(db.viagens.updateMany(filtroU02, [
  { $set: { preco_assento: { $round: [{ $multiply: ["$preco_assento", 1.1] }, 2] }, reajustada: true } }
]));

// -----------------------------------------------------------------------------
// U03 | Incluir um passageiro numa viagem agendada sem permitir duplicidade
// Itens: UPDATEONE, ADDTOSET, SET, SIZE, FILTER, EXPR
//
// $addToSet acrescenta o valor ao array só se ele ainda não estiver lá. Para
// subdocumentos, a comparação é do documento inteiro (mesmos campos, mesmos
// valores, mesma ordem). Por isso a 2ª tentativa idêntica não altera nada
// (modifiedCount 0), enquanto $push duplicaria o passageiro.
// Limite do $addToSet: o mesmo usuário com outro valor_pago seria um
// subdocumento "diferente" e entraria duplicado. Por isso o filtro principal
// também exige "passageiros.usuario_id": { $ne: "U041" } (nenhum elemento do
// array com esse usuário). A 3ª tentativa mostra essa guarda funcionando.
// O filtro ainda garante que há vaga: $expr compara o número de confirmados
// ($size de $filter) com vagas_ofertadas. Sem vaga, nada seria gravado.
// Depois, um updateOne com pipeline recalcula co2_economizado_kg (economia
// prevista) pela regra do projeto, mantendo o documento coerente.
// -----------------------------------------------------------------------------
titulo("U03", "Incluir a passageira U041 numa viagem agendada sem permitir duplicidade",
  ["UPDATEONE", "ADDTOSET", "SET", "SIZE", "FILTER", "EXPR"]);
const ID_U03 = "T0074";
const CONFIRMADOS = { $filter: { input: "$passageiros", as: "p", cond: { $eq: ["$$p.status", "confirmado"] } } };
const projU03 = { status: 1, preco_assento: 1, vagas_ofertadas: 1, passageiros: 1, co2_economizado_kg: 1 };
print("Antes:");
const antesU03 = exigirNaoVazio("U03", db.viagens.findOne({ _id: ID_U03 }, projU03));
print(antesU03);
const novoPassageiro = { usuario_id: "U041", status: "confirmado", valor_pago: antesU03.preco_assento };
const filtroU03 = {
  _id: ID_U03,
  status: "agendada",
  "passageiros.usuario_id": { $ne: novoPassageiro.usuario_id },
  $expr: { $lt: [{ $size: CONFIRMADOS }, "$vagas_ofertadas"] }
};
print("1ª tentativa (filtro completo): a passageira entra");
const u03a = db.viagens.updateOne(filtroU03, { $addToSet: { passageiros: novoPassageiro } });
resultadoEscrita(u03a);
print("2ª tentativa, subdocumento idêntico e filtro só pelo _id: o $addToSet sozinho impede a duplicata");
const u03b = db.viagens.updateOne({ _id: ID_U03 }, { $addToSet: { passageiros: novoPassageiro } });
resultadoEscrita(u03b);
print("3ª tentativa, mesma passageira com valor_pago diferente e filtro completo: a guarda $ne impede");
const u03c = db.viagens.updateOne(filtroU03, {
  $addToSet: { passageiros: { usuario_id: "U041", status: "confirmado", valor_pago: 0 } }
});
resultadoEscrita(u03c);
exigir("U03",
  u03a.modifiedCount === 1 && u03b.matchedCount === 1 && u03b.modifiedCount === 0 && u03c.matchedCount === 0,
  "$addToSet ou a guarda $ne não se comportaram como esperado");
print("Recálculo do CO2 previsto (distância x 0,12 x confirmados):");
resultadoEscrita(db.viagens.updateOne({ _id: ID_U03 }, [
  { $set: { co2_economizado_kg: { $round: [{ $multiply: ["$distancia_km", 0.12, { $size: CONFIRMADOS }] }, 2] } } }
]));
print("Depois:");
print(db.viagens.findOne({ _id: ID_U03 }, projU03));

// -----------------------------------------------------------------------------
// U04 | Adicionar várias preferências a um usuário de uma vez
// Itens: UPDATEONE, ADDTOSET (com $each)
//
// $addToSet sozinho adiciona um único valor; se recebesse um array, gravaria
// o array inteiro como um elemento. O modificador $each faz o $addToSet
// tratar cada item da lista separadamente: entram só os que ainda não estão
// no array. "silencio" já existia e não é duplicado.
// -----------------------------------------------------------------------------
titulo("U04", "Adicionar várias preferências à usuária U041 de uma vez",
  ["UPDATEONE", "ADDTOSET"]);
print("Antes:");
print(exigirNaoVazio("U04", db.usuarios.findOne({ _id: "U041" }, { nome: 1, preferencias: 1 })));
const u04 = db.usuarios.updateOne(
  { _id: "U041" },
  { $addToSet: { preferencias: { $each: ["pet friendly", "musica", "silencio", "ar condicionado"] } } }
);
resultadoEscrita(u04);
print("Depois:");
const depoisU04 = db.usuarios.findOne({ _id: "U041" }, { nome: 1, preferencias: 1 });
print(depoisU04);
exigir("U04", depoisU04.preferencias.filter(p => p === "silencio").length === 1, "preferência duplicada");

// -----------------------------------------------------------------------------
// U05 | Cadastrar ou atualizar um veículo pela placa (upsert)
// Itens: UPDATEONE, SET. Outros recursos: upsert, $setOnInsert
//
// O antigo save() inseria o documento se ele não existisse e o substituía se
// existisse. No mongosh esse método não existe mais; para "inserir ou
// atualizar", o padrão adotado é updateOne com { upsert: true }:
//   - se o filtro (placa) não acha nada, o MongoDB insere um documento novo
//     com os campos do filtro, do $set e do $setOnInsert;
//   - se acha, só aplica o $set; o $setOnInsert é ignorado.
// $setOnInsert define campos gravados apenas na inserção: o _id legível
// (sem ele o MongoDB geraria um ObjectId diferente a cada execução) e a data
// de cadastro, que não deve mudar nas atualizações seguintes.
// Diferença sutil para o save(): o save() substituía o documento inteiro
// (campos ausentes sumiam), enquanto updateOne + $set mescla (só os campos
// listados mudam; cadastrado_em é preservado). O equivalente literal do save()
// seria replaceOne(filtro, documentoCompleto, { upsert: true }). Para um
// cadastro em que o documento tem campos que só nascem na inserção, a mescla
// é o comportamento desejado.
// -----------------------------------------------------------------------------
titulo("U05", "Cadastrar ou atualizar um veículo pela placa (upsert)",
  ["UPDATEONE", "SET"], ["upsert", "$setOnInsert"]);
const PLACA = "SDK2U71";
print("Antes (conferência: o esperado é null, a placa ainda não existe):");
print(db.veiculos.findOne({ placa: PLACA }));
print("1ª chamada: a placa não existe, então o upsert insere");
const u05a = db.veiculos.updateOne(
  { placa: PLACA },
  {
    $set: { motorista_id: "U014", marca: "BYD", modelo: "Dolphin Mini", ano: 2025,
            capacidade: 4, combustivel: "eletrico", eletrico: true },
    $setOnInsert: { _id: "V019", cadastrado_em: DATA_REFERENCIA }
  },
  { upsert: true }
);
resultadoEscrita(u05a);
print(db.veiculos.findOne({ placa: PLACA }));
print("2ª chamada: a placa já existe, então o upsert só atualiza (vistoria corrigiu a capacidade)");
const u05b = db.veiculos.updateOne(
  { placa: PLACA },
  {
    $set: { motorista_id: "U014", marca: "BYD", modelo: "Dolphin Mini", ano: 2025,
            capacidade: 5, combustivel: "eletrico", eletrico: true },
    $setOnInsert: { _id: "V019", cadastrado_em: DATA_REFERENCIA }
  },
  { upsert: true }
);
resultadoEscrita(u05b);
exigir("U05", u05a.upsertedCount === 1 && u05a.insertedId === "V019" &&
  u05b.upsertedCount === 0 && u05b.modifiedCount === 1, "upsert inesperado");
print("Depois:");
print(db.veiculos.findOne({ placa: PLACA }));
print("Veículos com essa placa: " + db.veiculos.countDocuments({ placa: PLACA }));

// -----------------------------------------------------------------------------
// U06 | Cancelar viagens agendadas cuja data já passou
// Itens: UPDATEMANY, SET
//
// Viagens que continuam "agendada" depois da data nunca foram confirmadas
// pelo motorista. O updateMany usa $set em vários campos ao mesmo tempo:
//   - status, motivo e data do cancelamento;
//   - "passageiros.$[].status" e "passageiros.$[].valor_pago": o operador
//     posicional $[] aplica o $set a todos os elementos do array, ou seja,
//     todo passageiro vira cancelado e recebe o estorno (valor_pago 0);
//   - co2_economizado_kg volta a 0, porque a viagem não aconteceu.
// $lt (less than) seleciona datas anteriores à data de referência.
// -----------------------------------------------------------------------------
titulo("U06", "Cancelar viagens agendadas cuja data já passou", ["UPDATEMANY", "SET"]);
const filtroU06 = { status: "agendada", data_hora: { $lt: DATA_REFERENCIA } };
const projU06 = {
  status: 1, data_hora: 1, passageiros: 1, co2_economizado_kg: 1, motivo_cancelamento: 1, cancelada_em: 1
};
const idsU06 = db.viagens.find(filtroU06, { _id: 1 }).sort({ _id: 1 }).toArray().map(v => v._id);
exigirNaoVazio("U06", idsU06);
print("Agendadas com data vencida: " + idsU06.join(", "));
print("Antes, com findOne, a primeira delas:");
print(db.viagens.findOne({ _id: idsU06[0] }, projU06));
const u06 = db.viagens.updateMany(filtroU06, {
  $set: {
    status: "cancelada",
    motivo_cancelamento: "data expirada sem confirmação do motorista",
    cancelada_em: DATA_REFERENCIA,
    "passageiros.$[].status": "cancelado",
    "passageiros.$[].valor_pago": 0,
    co2_economizado_kg: 0
  }
});
resultadoEscrita(u06);
exigir("U06", u06.modifiedCount === idsU06.length, "quantidade cancelada diferente da esperada");
print("Depois, com findOne, a mesma viagem:");
print(db.viagens.findOne({ _id: idsU06[0] }, projU06));
print("Agendadas restantes: " + db.viagens.countDocuments({ status: "agendada" }) +
  " | canceladas agora: " + db.viagens.countDocuments({ status: "cancelada" }));
