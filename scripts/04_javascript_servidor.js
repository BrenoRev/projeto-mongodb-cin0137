// =============================================================================
// 04_javascript_servidor.js: consultas que executam funções JavaScript dentro
// do servidor MongoDB.
//
// J01: viagens com mais confirmados do que vagas   EXPR, FUNCTION, FIND, SORT (outros: $where)
// J02: km rodados a partir de cada cidade           FUNCTION (outros: mapReduce)
// J03: "pontuação verde" de cada motorista          AGGREGATE, FUNCTION ($function), LOOKUP, GROUP,
//                                                   AVG, SUM, COND, SORT, LIMIT
// J04: J02 refeito com aggregate, para comparar     AGGREGATE, MATCH, GROUP, SUM, AVG, SORT
//
// Os três recursos de JavaScript ($where, mapReduce e $function) dependem do
// JavaScript no servidor estar habilitado (padrão na imagem mongo:7; o Atlas
// gratuito costuma bloquear). Eles são mais lentos que os operadores nativos,
// porque cada documento passa pelo interpretador JavaScript e não podem usar
// índices na parte em JavaScript. Por isso o MongoDB recomenda usá-los só
// quando a lógica não cabe nos operadores do pipeline.
// =============================================================================
load(__dirname + "/_helpers.js");
db = db.getSiblingDB(NOME_BANCO);

// -----------------------------------------------------------------------------
// J01 | Quais viagens têm mais passageiros confirmados do que vagas ofertadas
//       (inconsistência a auditar)?
// Itens: EXPR, FUNCTION, FIND, SORT. Outros recursos: $where
//
// $where recebe uma função JavaScript que o servidor executa para cada
// documento. Dentro dela, "this" é o documento atual. O documento entra no
// resultado se a função devolver true. Aqui a função conta os confirmados
// com filter() de array do JavaScript e compara com vagas_ofertadas, uma
// comparação entre campos que o filtro comum do find não faz sozinho.
// O { status: "concluida" } fora da função é uma condição comum, avaliada
// pelo motor nativo; só os documentos que passam por ela chegam ao
// JavaScript. Não há índice que comece por status, então a coleção é lida
// inteira (COLLSCAN), mas o custo do JavaScript cai para as concluídas.
// -----------------------------------------------------------------------------
titulo("J01", "Quais viagens têm mais passageiros confirmados do que vagas ofertadas?",
  ["EXPR", "FUNCTION", "FIND", "SORT"], ["$where"]);
const j01 = db.viagens.find(
  {
    status: "concluida",
    $where: function () {
      const confirmados = this.passageiros.filter(function (p) { return p.status === "confirmado"; }).length;
      return confirmados > this.vagas_ofertadas;
    }
  },
  { motorista_id: 1, veiculo_id: 1, vagas_ofertadas: 1, "passageiros.usuario_id": 1, "passageiros.status": 1 }
).sort({ _id: 1 }).toArray();
exigirNaoVazio("J01", mostrar(j01));

// A mesma regra sem JavaScript: $expr com $size e $filter. É a forma
// recomendada hoje, porque roda no motor nativo do servidor.
const j01SemJs = db.viagens.countDocuments({
  status: "concluida",
  $expr: { $gt: [
    { $size: { $filter: { input: "$passageiros", as: "p", cond: { $eq: ["$$p.status", "confirmado"] } } } },
    "$vagas_ofertadas"
  ] }
});
print("Mesma auditoria com $expr (sem JavaScript): " + j01SemJs + " viagem(ns)");
exigir("J01", j01SemJs === j01.length, "$where e $expr divergiram");

// -----------------------------------------------------------------------------
// J02 | Quantos km foram rodados no total a partir de cada cidade de origem?
// Itens: FUNCTION. Outros recursos: mapReduce
//
// mapReduce processa a coleção em duas funções JavaScript:
//   map:    chamada uma vez por documento; emit(chave, valor) gera pares.
//           Aqui a chave é a cidade de origem e o valor traz km e 1 viagem.
//   reduce: recebe uma chave e a lista de valores emitidos para ela e devolve
//           um único valor do mesmo formato do emitido, por dois motivos:
//           uma chave com um único valor emitido nem passa pelo reduce (o
//           valor emitido já precisa ter o formato final), e o MongoDB pode
//           chamar o reduce várias vezes, reduzindo resultados parciais. Por
//           isso o reduce precisa ser associativo e comutativo (a ordem e o
//           agrupamento dos valores não podem mudar o resultado), como uma
//           soma.
// Opções: query filtra antes do map (só concluídas); finalize roda uma vez por
// chave no fim (calcula a média de km); out: { inline: 1 } devolve o resultado
// na resposta, sem gravar coleção.
// O mapReduce está deprecated desde o MongoDB 5.0 (o shell imprime um aviso)
// e não está na checklist oficial. Fica como recurso extra; o item coberto
// aqui é FUNCTION, pelas funções map e reduce que o servidor executa. J04
// refaz o cálculo com o pipeline de agregação, a forma atual.
// -----------------------------------------------------------------------------
titulo("J02", "Quantos km foram rodados no total a partir de cada cidade de origem?",
  ["FUNCTION"], ["mapReduce"]);
const mapaKm = function () {
  emit(this.origem.cidade, { km: this.distancia_km, viagens: 1 });
};
const reduzKm = function (cidade, valores) {
  const total = { km: 0, viagens: 0 };
  valores.forEach(function (v) { total.km += v.km; total.viagens += v.viagens; });
  return total;
};
const finalizaKm = function (cidade, total) {
  total.km_medio = Math.round((total.km / total.viagens) * 10) / 10;
  return total;
};
const j02Bruto = db.viagens.mapReduce(mapaKm, reduzKm, {
  query: { status: "concluida" },
  finalize: finalizaKm,
  out: { inline: 1 }
});
// Ordena pelo total de km: a ordem do resultado inline não é garantida (no
// MongoDB 7 o mapReduce roda sobre o motor de agregação), então o script
// ordena antes de imprimir.
const j02 = j02Bruto.results.slice().sort((a, b) => b.value.km - a.value.km || (a._id < b._id ? -1 : 1));
exigirNaoVazio("J02", mostrar(j02));

// -----------------------------------------------------------------------------
// J03 | Qual a "pontuação verde" de cada motorista, calculada por uma função
//       própria (CO2, ocupação e bônus para elétrico)?
// Itens: AGGREGATE, FUNCTION ($function), LOOKUP, GROUP, AVG, SUM, COND, SORT, LIMIT
//
// $function executa uma função JavaScript dentro do pipeline:
//   body: a função; args: os campos passados como argumentos; lang: "js".
// A regra da pontuação tem passos que ficariam ilegíveis em operadores:
//   1. base = kg de CO2 economizado no período;
//   2. fator de ocupação = 0,5 + ocupação média. A ocupação de cada viagem
//      é limitada a 100% com $min antes da média: assim, as duas viagens
//      com excesso de passageiros não premiam o motorista nem compensam
//      viagens vazias;
//   3. bônus elétrico = até +20%, proporcional às viagens em carro elétrico
//      ou híbrido;
//   4. resultado com 1 casa decimal.
// Antes disso, $lookup traz o veículo para saber se é elétrico, e o $group
// calcula por motorista o CO2 ($sum), a ocupação média ($avg do menor valor
// entre confirmados / vagas e 1) e as viagens elétricas ($sum de $cond 1 ou
// 0). $addFields acrescenta o campo calculado mantendo todos os outros
// (diferente do $project, que descarta o que não for listado).
// -----------------------------------------------------------------------------
titulo("J03", "Qual a pontuação verde de cada motorista (CO2, ocupação e bônus para elétrico)?",
  ["AGGREGATE", "FUNCTION", "LOOKUP", "GROUP", "AVG", "SUM", "COND", "SORT", "LIMIT"]);
const j03 = db.viagens.aggregate([
  { $match: { status: "concluida" } },
  { $lookup: { from: "veiculos", localField: "veiculo_id", foreignField: "_id", as: "veiculo" } },
  { $unwind: "$veiculo" },
  { $group: {
      _id: "$motorista_id",
      co2_kg: { $sum: "$co2_economizado_kg" },
      ocupacao_media: { $avg: { $min: [{ $divide: [
        { $size: { $filter: { input: "$passageiros", as: "p", cond: { $eq: ["$$p.status", "confirmado"] } } } },
        "$vagas_ofertadas"
      ] }, 1] } },
      viagens: { $sum: 1 },
      viagens_eletricas: { $sum: { $cond: [{ $ifNull: ["$veiculo.eletrico", false] }, 1, 0] } }
  } },
  { $addFields: {
      pontuacao_verde: { $function: {
        body: function (co2, ocupacao, viagens, eletricas) {
          const fatorOcupacao = 0.5 + ocupacao;
          const bonusEletrico = 1 + 0.2 * (eletricas / viagens);
          return Math.round(co2 * fatorOcupacao * bonusEletrico * 10) / 10;
        },
        args: ["$co2_kg", "$ocupacao_media", "$viagens", "$viagens_eletricas"],
        lang: "js"
      } }
  } },
  { $sort: { pontuacao_verde: -1, _id: 1 } },
  { $limit: 5 },
  { $lookup: { from: "usuarios", localField: "_id", foreignField: "_id", as: "motorista" } },
  { $project: {
      _id: 0,
      motorista_id: "$_id",
      nome: { $first: "$motorista.nome" },
      pontuacao_verde: "$pontuacao_verde",
      co2_kg: { $round: ["$co2_kg", 2] },
      ocupacao_media: { $round: ["$ocupacao_media", 2] },
      viagens: "$viagens",
      viagens_eletricas: "$viagens_eletricas"
  } }
]);
exigirNaoVazio("J03", mostrar(j03));

// -----------------------------------------------------------------------------
// J04 | Equivalente de J02 com aggregate, para comparar com o mapReduce
// Itens: AGGREGATE, MATCH, GROUP, SUM, AVG, SORT
//
// O mesmo cálculo em três estágios nativos: $match (o "query" do mapReduce),
// $group com $sum (o "map + reduce") e $avg (o "finalize"). O pipeline é a
// forma recomendada desde o MongoDB 5.0: roda no motor nativo do servidor,
// sem interpretar JavaScript a cada documento, é mais legível e não está
// deprecated. Quanto a índices, os dois empatam: o $match no início do
// pipeline e a opção query do mapReduce usam índice quando o campo filtrado
// é indexado (aqui não é: status sozinho dá COLLSCAN, como C10 mostra).
// No fim, o script compara os dois resultados cidade a cidade. km e viagens
// precisam ser iguais. A média arredondada pode diferir em 0,1 num empate
// exato: o Math.round do finalize arredonda a metade para cima (38,25 vira
// 38,3) e o $round arredonda a metade para o par (38,25 vira 38,2). Por isso
// a média é comparada com tolerância de 0,05 sobre o valor sem arredondar.
// -----------------------------------------------------------------------------
titulo("J04", "Equivalente de J02 com aggregate, para comparar com o mapReduce",
  ["AGGREGATE", "MATCH", "GROUP", "SUM", "AVG", "SORT"]);
const j04 = db.viagens.aggregate([
  { $match: { status: "concluida" } },
  { $group: {
      _id: "$origem.cidade",
      km: { $sum: "$distancia_km" },
      viagens: { $sum: 1 },
      media_exata: { $avg: "$distancia_km" }
  } },
  { $project: { km: 1, viagens: 1, km_medio: { $round: ["$media_exata", 1] }, media_exata: 1 } },
  { $sort: { km: -1, _id: 1 } }
]).toArray();
exigirNaoVazio("J04", mostrar(j04.map(({ media_exata, ...resto }) => resto)));

const divergencias = [];
exigir("J04", j02.length === j04.length, "número de cidades diferente entre J02 e J04");
j04.forEach((linha, i) => {
  const mr = j02[i];
  if (mr._id !== linha._id || mr.value.km !== linha.km || mr.value.viagens !== linha.viagens ||
      Math.abs(mr.value.km_medio - linha.media_exata) > 0.05 + 1e-9) {
    divergencias.push(linha._id);
  }
});
print("Cidades comparadas: " + j04.length + " | divergências: " + divergencias.length);
print("J02 (mapReduce) e J04 (aggregate) batem: " +
  (divergencias.length === 0 ? "SIM" : "NÃO (" + divergencias.join(", ") + ")"));
exigir("J04", divergencias.length === 0, "mapReduce e aggregate divergiram");
