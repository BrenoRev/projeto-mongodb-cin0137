// =============================================================================
// 03_agregacoes.js: relatórios gerenciais com o pipeline de agregação.
//
// G01: top 5 motoristas em CO2 economizado        AGGREGATE, MATCH, GROUP, SUM, SORT, LIMIT, LOOKUP, PROJECT
// G02: nota média e maior nota por motorista      AGGREGATE, MATCH, GROUP, AVG, MAX, GTE, LOOKUP, PROJECT, SORT
// G03: faixa de CO2 e ocupação de cada viagem     AGGREGATE, MATCH, PROJECT, COND, SIZE, FILTER, GROUP
// G04: só os passageiros confirmados por viagem   AGGREGATE, MATCH, PROJECT, FILTER, SIZE, EXPR, SORT
// G05: faturamento por motorista (só confirmados) AGGREGATE, MATCH, GROUP, SUM, COND, ADDTOSET, LOOKUP, PROJECT, SORT
// G06: receita, distância média e maior por mês   AGGREGATE, MATCH, GROUP, SUM, AVG, MAX, SORT
// G07: saldo de CO2 por km e combustível          AGGREGATE, MATCH, LOOKUP, GROUP, AVG, SUM, PROJECT, COND
//
// O que é o pipeline: aggregate recebe uma lista de estágios. Cada estágio
// recebe os documentos do anterior, transforma e passa adiante, como uma linha
// de montagem. Os estágios usados aqui:
//   $match   filtra (mesma sintaxe do find); no início, aproveita índices
//   $group   agrupa pela chave _id e calcula acumuladores ($sum, $avg, $max...)
//   $project escolhe, renomeia e calcula campos
//   $lookup  junta documentos de outra coleção. Sozinho equivale a um LEFT
//            JOIN: quem não tem par recebe um array vazio
//   $unwind  desmonta um array: um documento de saída para cada elemento.
//            Depois de um $lookup, descarta os documentos de array vazio, o
//            que transforma a junção num INNER JOIN; com a opção
//            preserveNullAndEmptyArrays: true, eles seriam mantidos
//   $sort    ordena; $limit corta a quantidade
// Operadores de expressão auxiliares que aparecem nos estágios:
//   $round [valor, casas]  arredonda; no empate exato usa "metade para o
//                          par" (38,25 com 1 casa vira 38,2), e não para cima
//   $first "$array"        primeiro elemento de um array (o $lookup sempre
//                          devolve array, mesmo com um único documento)
//   $concat [a, b, ...]    junta strings; $subtract, $divide e $multiply
//                          fazem subtração, divisão e multiplicação
// =============================================================================
load(__dirname + "/_helpers.js");
db = db.getSiblingDB(NOME_BANCO);

// Expressão reaproveitada: só os passageiros com status "confirmado".
// $filter percorre o array "input", dá a cada elemento o nome "as" (acessado
// com $$p) e mantém só os elementos em que "cond" é verdadeira.
const SO_CONFIRMADOS = {
  $filter: { input: "$passageiros", as: "p", cond: { $eq: ["$$p.status", "confirmado"] } }
};

// -----------------------------------------------------------------------------
// G01 | Quais são os 5 motoristas que mais economizaram CO2 em viagens
//       concluídas?
// Itens: AGGREGATE, MATCH, GROUP, SUM, SORT, LIMIT (mais LOOKUP e PROJECT)
//
// $match deixa passar só as concluídas (agendadas têm CO2 apenas previsto).
// $group com _id: "$motorista_id" cria um grupo por motorista. Dentro dele:
//   { $sum: "$co2_economizado_kg" } soma o campo de todas as viagens do grupo;
//   { $sum: 1 } soma 1 por documento: conta as viagens.
// $sort por CO2 decrescente e $limit 5 formam o ranking. O $lookup vem depois
// do $limit de propósito: busca o nome de 5 motoristas, e não de todos.
// $round arredonda a soma para 2 casas (somas de decimais acumulam resíduo).
// -----------------------------------------------------------------------------
titulo("G01", "Quais são os 5 motoristas que mais economizaram CO2 em viagens concluídas?",
  ["AGGREGATE", "MATCH", "GROUP", "SUM", "SORT", "LIMIT", "LOOKUP", "PROJECT"]);
const g01 = db.viagens.aggregate([
  { $match: { status: "concluida" } },
  { $group: {
      _id: "$motorista_id",
      co2_total_kg: { $sum: "$co2_economizado_kg" },
      viagens: { $sum: 1 },
      km_rodados: { $sum: "$distancia_km" }
  } },
  { $sort: { co2_total_kg: -1, _id: 1 } },
  { $limit: 5 },
  { $lookup: { from: "usuarios", localField: "_id", foreignField: "_id", as: "motorista" } },
  // No $project, um campo copiado com 1 sai antes dos calculados. Escrever
  // todos como expressão ("$campo") mantém a ordem em que foram listados.
  { $project: {
      _id: 0,
      motorista_id: "$_id",
      nome: { $first: "$motorista.nome" },
      co2_total_kg: { $round: ["$co2_total_kg", 2] },
      viagens: "$viagens",
      km_rodados: "$km_rodados"
  } }
]);
exigirNaoVazio("G01", mostrar(g01));

// -----------------------------------------------------------------------------
// G02 | Qual a nota média e a maior nota de cada motorista, com o nome dele?
//       Só entram motoristas com pelo menos 3 avaliações.
// Itens: AGGREGATE, MATCH, GROUP, AVG, MAX, GTE, LOOKUP, PROJECT, SORT
//
// $match pega só as avaliações em que o avaliado atuava como motorista.
// No $group, $avg calcula a média das notas do grupo, $max a maior e $min a
// menor. Um segundo $match, depois do $group, filtra pelo resultado da
// agregação (como o HAVING do SQL): com menos de 3 avaliações a média não é
// representativa. A saída mostra a posição que cada excluído ocuparia sem o
// filtro.
// $lookup procura em "usuarios" o documento cujo _id (foreignField) é igual
// ao _id do grupo (localField) e grava o resultado no array "motorista".
// $unwind transforma esse array de um elemento em subdocumento, e o $project
// final monta a saída com nomes de campos legíveis.
// -----------------------------------------------------------------------------
titulo("G02", "Qual a nota média e a maior nota de cada motorista (com 3 ou mais avaliações), com o nome dele?",
  ["AGGREGATE", "MATCH", "GROUP", "AVG", "MAX", "GTE", "LOOKUP", "PROJECT", "SORT"]);
const etapasG02 = [
  { $match: { papel_avaliado: "motorista" } },
  { $group: {
      _id: "$avaliado_id",
      nota_media: { $avg: "$nota" },
      maior_nota: { $max: "$nota" },
      menor_nota: { $min: "$nota" },
      avaliacoes: { $sum: 1 }
  } }
];
const g02 = db.avaliacoes.aggregate(etapasG02.concat([
  { $match: { avaliacoes: { $gte: 3 } } },
  { $lookup: { from: "usuarios", localField: "_id", foreignField: "_id", as: "motorista" } },
  { $unwind: "$motorista" },
  { $project: {
      _id: 0,
      motorista_id: "$_id",
      nome: "$motorista.nome",
      nota_media: { $round: ["$nota_media", 2] },
      maior_nota: "$maior_nota",
      menor_nota: "$menor_nota",
      avaliacoes: "$avaliacoes"
  } },
  // Desempate pela menor nota: entre médias iguais, fica à frente quem nunca
  // recebeu nota muito baixa.
  { $sort: { nota_media: -1, menor_nota: -1, motorista_id: 1 } }
])).toArray();
exigirNaoVazio("G02", mostrar(g02));
const foraG02 = db.avaliacoes.aggregate(etapasG02.concat([
  { $match: { avaliacoes: { $lt: 3 } } }, { $sort: { _id: 1 } }
])).toArray();
// Efeito do filtro: a posição que cada excluído ocuparia se entrasse.
print("Motoristas fora do ranking por terem menos de 3 avaliações:");
foraG02.forEach(m => {
  const posicao = g02.filter(r => r.nota_media > m.nota_media).length + 1;
  print("  " + m._id + ": " + m.avaliacoes + " avaliações, média " + m.nota_media.toFixed(2) +
    ", ocuparia a posição " + posicao + " sem o filtro");
});
exigir("G02", g02.every(m => m.nota_media >= 1 && m.nota_media <= 5), "média fora da faixa de 1 a 5");

// -----------------------------------------------------------------------------
// G03 | Como cada viagem concluída se classifica em economia de CO2 (alta,
//       média, baixa) e em ocupação (lotada ou com vaga)?
// Itens: AGGREGATE, MATCH, PROJECT, COND, SIZE (de expressão), FILTER, GROUP
//
// $cond é o "se, então, senão" do pipeline. Aceita a forma de array
// [condição, valor_se_verdadeiro, valor_se_falso] ou a forma de objeto
// { if, then, else }. Dois $cond aninhados criam três faixas de CO2:
//   >= 30 kg: alta | >= 10 kg: média | abaixo disso: baixa.
// $concat monta o texto da rota juntando origem, " > " e destino.
// No pipeline, $size é um operador de expressão: devolve o tamanho de um array
// calculado, aqui o array filtrado pelo $filter. Diferente do $size do find
// (C04), ele pode ser comparado com outro campo: confirmados >= vagas.
// Um segundo $project é necessário porque um campo calculado num $project só
// pode ser usado pelo estágio seguinte.
// -----------------------------------------------------------------------------
titulo("G03",
  "Como cada viagem se classifica em economia de CO2 (alta, média, baixa) e ocupação (lotada ou com vaga)?",
  ["AGGREGATE", "MATCH", "PROJECT", "COND", "SIZE", "FILTER", "GROUP"]);
const etapasG03 = [
  { $match: { status: "concluida" } },
  { $project: {
      rota: { $concat: ["$origem.cidade", " > ", "$destino.cidade"] },
      co2_economizado_kg: 1,
      vagas_ofertadas: 1,
      na_lista: { $size: "$passageiros" },
      confirmados: { $size: SO_CONFIRMADOS },
      faixa_co2: {
        $cond: [
          { $gte: ["$co2_economizado_kg", 30] }, "alta",
          { $cond: [{ $gte: ["$co2_economizado_kg", 10] }, "média", "baixa"] }
        ]
      }
  } },
  { $project: {
      rota: 1, co2_economizado_kg: 1, faixa_co2: 1, vagas_ofertadas: 1, na_lista: 1, confirmados: 1,
      ocupacao: { $cond: { if: { $gte: ["$confirmados", "$vagas_ofertadas"] }, then: "lotada", else: "com vaga" } }
  } }
];
const g03 = db.viagens.aggregate(etapasG03.concat([{ $sort: { co2_economizado_kg: -1, _id: 1 } }]));
exigirNaoVazio("G03", mostrar(g03, 8));

// Resumo da classificação: as mesmas etapas, seguidas de um $group pelas
// duas classificações (chave composta no _id).
print("Resumo por faixa de CO2 e ocupação:");
mostrar(db.viagens.aggregate(etapasG03.concat([
  { $group: { _id: { faixa_co2: "$faixa_co2", ocupacao: "$ocupacao" }, viagens: { $sum: 1 } } },
  { $sort: { "_id.faixa_co2": 1, "_id.ocupacao": 1 } }
])));

// -----------------------------------------------------------------------------
// G04 | Em cada viagem concluída, quem são só os passageiros confirmados e
//       quantos são? Destaque para as viagens que tiveram desistência.
// Itens: AGGREGATE, MATCH, PROJECT, FILTER, SIZE, EXPR, SORT
//
// $filter (ver SO_CONFIRMADOS no topo) devolve um novo array só com os
// passageiros confirmados, sem alterar o documento gravado. Em seguida:
//   "$confirmados.usuario_id" extrai só os ids do array filtrado;
//   $size conta os confirmados e o total da lista;
//   $subtract (total menos confirmados) dá o número de desistências.
// O $match final usa $expr para comparar dois campos do mesmo documento
// (confirmados < total na lista): só aparecem as viagens em que alguém
// cancelou. Dentro do $expr vale a sintaxe de expressão, { $lt: [a, b] },
// e "$campo" é lido como o valor de outro campo. Sem o $expr, o filtro
// { qtd_confirmados: { $lt: "$total_na_lista" } } compara o número com o
// texto literal "$total_na_lista" e não acha nada; a saída mostra a contagem
// das duas formas. O $expr só aproveita índice ao comparar um campo com uma
// constante; comparar dois campos do mesmo documento sempre lê os documentos.
// -----------------------------------------------------------------------------
titulo("G04", "Em cada viagem, quem são só os passageiros confirmados e quantos são?",
  ["AGGREGATE", "MATCH", "PROJECT", "FILTER", "SIZE", "EXPR", "SORT"]);
const etapasG04 = [
  { $match: { status: "concluida" } },
  { $project: { confirmados: SO_CONFIRMADOS, total_na_lista: { $size: "$passageiros" } } },
  { $project: {
      ids_confirmados: "$confirmados.usuario_id",
      qtd_confirmados: { $size: "$confirmados" },
      total_na_lista: 1,
      desistencias: { $subtract: ["$total_na_lista", { $size: "$confirmados" }] }
  } }
];
const g04 = db.viagens.aggregate(etapasG04.concat([
  { $match: { $expr: { $lt: ["$qtd_confirmados", "$total_na_lista"] } } },
  { $sort: { _id: 1 } }
]));
exigirNaoVazio("G04", mostrar(g04, 8));
const comExpr = db.viagens.aggregate(etapasG04.concat([
  { $match: { $expr: { $lt: ["$qtd_confirmados", "$total_na_lista"] } } }, { $count: "n" }
])).toArray()[0].n;
const semExpr = db.viagens.aggregate(etapasG04.concat([
  { $match: { qtd_confirmados: { $lt: "$total_na_lista" } } }, { $count: "n" }
])).toArray();
print("Viagens com desistência, com $expr: " + comExpr +
  "; sem $expr (compara com o texto \"$total_na_lista\"): " + (semExpr.length ? semExpr[0].n : 0));
print("Para comparação, as 3 primeiras viagens concluídas sem desistência:");
mostrar(db.viagens.aggregate(etapasG04.concat([
  { $match: { desistencias: 0 } }, { $sort: { _id: 1 } }, { $limit: 3 }
])));

// -----------------------------------------------------------------------------
// G05 | Quanto cada motorista faturou, contando apenas passageiros
//       confirmados?
// Itens: AGGREGATE, MATCH, GROUP, SUM, COND, ADDTOSET, LOOKUP, PROJECT, SORT
//
// $unwind gera um documento por passageiro (a viagem se repete em cada um).
// No $group, $sum com $cond soma valor_pago só quando o status é
// "confirmado", e 0 nos demais. Assim o relatório respeita a regra de negócio
// mesmo que um cancelado tenha valor registrado por engano. O mesmo padrão
// ($sum de $cond devolvendo 1 ou 0) conta confirmados e cancelamentos.
// $addToSet como acumulador junta os _id das viagens sem repetir, já que
// depois do $unwind a mesma viagem aparece uma vez por passageiro. O $size
// desse conjunto dá o número real de viagens, e $divide (faturamento dividido
// pelos confirmados) dá o ticket médio por passageiro.
// -----------------------------------------------------------------------------
titulo("G05", "Quanto cada motorista faturou, contando apenas passageiros confirmados?",
  ["AGGREGATE", "MATCH", "GROUP", "SUM", "COND", "ADDTOSET", "LOOKUP", "PROJECT", "SORT"]);
const g05 = db.viagens.aggregate([
  { $match: { status: "concluida" } },
  { $unwind: "$passageiros" },
  { $group: {
      _id: "$motorista_id",
      faturamento: { $sum: { $cond: [{ $eq: ["$passageiros.status", "confirmado"] }, "$passageiros.valor_pago", 0] } },
      confirmados: { $sum: { $cond: [{ $eq: ["$passageiros.status", "confirmado"] }, 1, 0] } },
      cancelamentos: { $sum: { $cond: [{ $eq: ["$passageiros.status", "cancelado"] }, 1, 0] } },
      viagens: { $addToSet: "$_id" }
  } },
  { $lookup: { from: "usuarios", localField: "_id", foreignField: "_id", as: "motorista" } },
  { $project: {
      _id: 0,
      motorista_id: "$_id",
      nome: { $first: "$motorista.nome" },
      faturamento: "$faturamento",
      confirmados: "$confirmados",
      cancelamentos: "$cancelamentos",
      qtd_viagens: { $size: "$viagens" },
      ticket_medio: { $round: [{ $divide: ["$faturamento", "$confirmados"] }, 2] }
  } },
  { $sort: { faturamento: -1, motorista_id: 1 } }
]).toArray();
exigirNaoVazio("G05", mostrar(g05));
// Conferência independente: soma direta dos confirmados, sem $cond.
const conferenciaG05 = db.viagens.aggregate([
  { $match: { status: "concluida" } }, { $unwind: "$passageiros" },
  { $match: { "passageiros.status": "confirmado" } },
  { $group: { _id: null, total: { $sum: "$passageiros.valor_pago" } } }
]).toArray()[0].total;
const somaG05 = g05.reduce((s, m) => s + m.faturamento, 0);
print("Faturamento total (soma do ranking): " + somaG05.toFixed(2) +
  " | conferência só com confirmados: " + conferenciaG05.toFixed(2));
exigir("G05", Math.abs(somaG05 - conferenciaG05) < 0.01, "faturamento não bate com a conferência");

// -----------------------------------------------------------------------------
// G06 | Qual a receita, a distância média e a viagem mais longa por mês?
// Itens: AGGREGATE, MATCH, GROUP, SUM, AVG, MAX, SORT
//
// $dateToString formata a data como "AAAA-MM" no fuso America/Recife (sem o
// fuso, uma viagem às 22h do último dia do mês cairia no mês seguinte em UTC).
// $sum aparece em duas formas:
//   no $project, $sum aplicado a um array soma os elementos dentro de um
//   único documento: $map transforma cada passageiro confirmado (filtrados
//   por SO_CONFIRMADOS) no seu valor_pago, e $sum soma a lista. É a receita
//   da viagem, contando só confirmados, como em G05;
//   no $group, { $sum: "$receita_viagem" } soma esse valor entre documentos.
// $avg dá a distância média e $max a maior distância do mês. O $max devolve
// só o valor; para saber qual viagem foi a mais longa, o acumulador $top
// (MongoDB 5.2+) ordena os documentos do grupo por sortBy e devolve o
// "output" do primeiro: aqui, o _id e a rota da viagem de maior distância
// (no empate, a de menor _id).
// -----------------------------------------------------------------------------
titulo("G06", "Qual a receita, a distância média e a viagem mais longa por mês?",
  ["AGGREGATE", "MATCH", "GROUP", "SUM", "AVG", "MAX", "SORT"]);
const g06 = db.viagens.aggregate([
  { $match: { status: "concluida" } },
  { $project: {
      mes: { $dateToString: { format: "%Y-%m", date: "$data_hora", timezone: "America/Recife" } },
      distancia_km: 1,
      co2_economizado_kg: 1,
      rota: { $concat: ["$origem.cidade", " > ", "$destino.cidade"] },
      receita_viagem: { $sum: { $map: { input: SO_CONFIRMADOS, as: "p", in: "$$p.valor_pago" } } }
  } },
  { $group: {
      _id: "$mes",
      viagens: { $sum: 1 },
      receita: { $sum: "$receita_viagem" },
      distancia_media_km: { $avg: "$distancia_km" },
      maior_distancia_km: { $max: "$distancia_km" },
      viagem_mais_longa: { $top: { sortBy: { distancia_km: -1, _id: 1 }, output: { viagem: "$_id", rota: "$rota" } } },
      co2_kg: { $sum: "$co2_economizado_kg" }
  } },
  { $project: {
      viagens: 1, receita: 1, maior_distancia_km: 1, viagem_mais_longa: 1,
      distancia_media_km: { $round: ["$distancia_media_km", 1] },
      co2_kg: { $round: ["$co2_kg", 2] }
  } },
  { $sort: { _id: 1 } }
]);
exigirNaoVazio("G06", mostrar(g06));

// -----------------------------------------------------------------------------
// G07 | Qual combustível dá o maior saldo de CO2 por km rodado (economia
//       menos a emissão do próprio carro), elétrico x combustão?
// Itens: AGGREGATE, MATCH, LOOKUP, GROUP, AVG, SUM, PROJECT, COND
//
// $lookup traz o veículo de cada viagem, e o $unwind deixa o veículo como
// subdocumento. A economia (co2_economizado_kg) conta os carros que os
// passageiros deixaram de usar e, pela fórmula do projeto, não depende do
// combustível da carona: depende só da distância e da ocupação. Para a
// comparação fazer sentido, o pipeline também calcula quanto o próprio carro
// emitiu, com um fator por combustível escolhido por $cond aninhados (kg de
// CO2 por km, valores de referência adotados no projeto): elétrico 0,
// híbrido 0,07, GNV 0,10, flex 0,11 e gasolina 0,12.
// Convenção do projeto: o saldo atribui à carona a emissão do carro do
// motorista, que rodaria de qualquer forma. Comparado a "todos dirigindo
// sozinhos" (cada um emitindo 0,12 kg/km), a economia líquida da carona
// seria exatamente o saldo + 0,12 kg/km para qualquer combustível. Como a
// diferença é a mesma constante para todos, a ordem do ranking não muda.
// Os totais são divididos pelos km rodados ($divide): comparar médias por
// viagem favoreceria quem faz viagens longas (as elétricas têm distância
// média bem menor). $ifNull trata a ausência do campo opcional eletrico como
// false, e um último $cond rotula a categoria. $avg dá a ocupação média.
// -----------------------------------------------------------------------------
titulo("G07", "Qual combustível dá o maior saldo de CO2 por km (economia menos emissão do carro)?",
  ["AGGREGATE", "MATCH", "LOOKUP", "GROUP", "AVG", "SUM", "PROJECT", "COND"]);
const etapasG07 = [
  { $match: { status: "concluida" } },
  { $lookup: { from: "veiculos", localField: "veiculo_id", foreignField: "_id", as: "veiculo" } },
  { $unwind: "$veiculo" },
  { $project: {
      combustivel: "$veiculo.combustivel",
      eletrico: { $ifNull: ["$veiculo.eletrico", false] },
      distancia_km: 1,
      co2_economizado_kg: 1,
      confirmados: { $size: SO_CONFIRMADOS },
      co2_emitido_kg: { $multiply: ["$distancia_km", {
        $cond: [{ $eq: ["$veiculo.combustivel", "eletrico"] }, 0,
        { $cond: [{ $eq: ["$veiculo.combustivel", "hibrido"] }, 0.07,
        { $cond: [{ $eq: ["$veiculo.combustivel", "gnv"] }, 0.10,
        { $cond: [{ $eq: ["$veiculo.combustivel", "flex"] }, 0.11, 0.12] }] }] }]
      }] }
  } }
];
// Estágios finais comuns às duas visões: totais, divisão por km e arredondamento.
function porKm(chave) {
  return [
    { $group: {
        _id: chave,
        eletrico: { $max: "$eletrico" },
        viagens: { $sum: 1 },
        km_rodados: { $sum: "$distancia_km" },
        ocupacao_media: { $avg: "$confirmados" },
        co2_economizado: { $sum: "$co2_economizado_kg" },
        co2_emitido: { $sum: "$co2_emitido_kg" }
    } },
    { $project: {
        _id: 0,
        grupo: "$_id",
        categoria: { $cond: ["$eletrico", "elétrico ou híbrido", "combustão"] },
        viagens: "$viagens",
        km_rodados: "$km_rodados",
        passageiros_por_viagem: { $round: ["$ocupacao_media", 2] },
        economizado_por_km: { $round: [{ $divide: ["$co2_economizado", "$km_rodados"] }, 3] },
        emitido_por_km: { $round: [{ $divide: ["$co2_emitido", "$km_rodados"] }, 3] },
        saldo_por_km: { $round: [{ $divide: [{ $subtract: ["$co2_economizado", "$co2_emitido"] }, "$km_rodados"] }, 3] }
    } },
    { $sort: { saldo_por_km: -1 } }
  ];
}
const g07 = db.viagens.aggregate(etapasG07.concat(porKm("$combustivel")));
exigirNaoVazio("G07", mostrar(g07));

print("Comparação direta: elétrico ou híbrido x combustão");
mostrar(db.viagens.aggregate(etapasG07.concat(
  porKm({ $cond: ["$eletrico", "elétrico ou híbrido", "combustão"] })
)));
