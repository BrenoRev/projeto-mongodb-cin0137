// =============================================================================
// 02_consultas_basicas.js: consultas com find, findOne, countDocuments,
// operadores de comparação, de existência, de array e busca textual.
//
// C01: situação da CNH dos motoristas             FIND, EXISTS, SORT, PRETTY
// C02: cadastro completo pelo e-mail              FINDONE, FIND, SORT, COUNTDOCUMENTS
// C03: 5 viagens longas mais caras                FIND, GTE, SORT, LIMIT
// C04: viagens com exatamente 3 na lista          FIND, SIZE, SORT
// C05: usuários que aceitam pet e música          FIND, ALL, SORT
// C06: viagens concluídas saindo de Recife        COUNTDOCUMENTS
// C07: avaliações que elogiam sem citar atraso    TEXT, SEARCH, GTE, SORT, LIMIT
// C08: frota a combustão (sem campo eletrico)     FIND, EXISTS, SORT, COUNTDOCUMENTS
// C09: viagens de rodovia pela manhã com paradas  FIND, ALL, SIZE, SORT
// C10: histórico de uma motorista e o índice      FIND, SORT, LIMIT, COUNTDOCUMENTS (com explain)
// =============================================================================
load(__dirname + "/_helpers.js");
db = db.getSiblingDB(NOME_BANCO);

// -----------------------------------------------------------------------------
// C01 | Quais motoristas já têm CNH verificada e quais ainda estão pendentes?
//       Mostrar nome, cidade e situação, verificados primeiro e em ordem
//       alfabética.
// Itens: FIND, EXISTS, SORT, PRETTY
//
// find(filtro, projeção) devolve um cursor com os documentos que atendem ao
// filtro. A projeção escolhe os campos: 1 inclui, e o _id vem por padrão.
// "endereco.cidade" usa a notação de ponto para alcançar um campo dentro do
// subdocumento endereco.
//
// $exists: true seleciona documentos em que o campo existe, qualquer que seja
// o valor (true ou false). Pelo esquema flexível, cnh_verificada só foi
// gravado em motoristas, então a existência do campo é o que identifica quem
// é motorista: o filtro traz os verificados e os pendentes, e nenhum
// passageiro.
//
// sort com dois campos: cnh_verificada -1 (decrescente: true antes de false)
// e, no empate, nome 1 (crescente, ordem alfabética).
// pretty() pede a saída indentada. No shell legado "mongo", sem pretty() cada
// documento saía numa única linha; no mongosh a saída já vem formatada e o
// método continua aceito. O contraste aparece logo abaixo do resultado.
// -----------------------------------------------------------------------------
titulo("C01", "Quais motoristas já têm CNH verificada e quais estão pendentes? (nome, cidade, situação)",
  ["FIND", "EXISTS", "SORT", "PRETTY"]);
const c01 = db.usuarios.find(
  { cnh_verificada: { $exists: true } },
  { nome: 1, "endereco.cidade": 1, cnh_verificada: 1 }
).sort({ cnh_verificada: -1, nome: 1 }).pretty();
const docsC01 = exigirNaoVazio("C01", mostrar(c01));
print("Contraste de formatação com o primeiro documento:");
print("  sem formatação (uma linha, como o shell legado sem pretty): " + EJSON.stringify(docsC01[0]));
print("  com pretty print (um campo por linha):");
printjson(docsC01[0]);

// Onde o $exists é indispensável: para listar só os pendentes, a negação
// { $ne: true } sozinha também traria os passageiros, porque um documento sem
// o campo "não é igual a true". Combinado com $exists: true, sobra só quem é
// motorista e ainda não foi verificado.
print("Pendentes com { $exists: true, $ne: true }:");
exigirNaoVazio("C01", mostrar(db.usuarios.find(
  { cnh_verificada: { $exists: true, $ne: true } },
  { nome: 1, cnh_verificada: 1 }
).sort({ nome: 1 })));
print("Para comparação, { $ne: true } sem $exists traz " +
  db.usuarios.countDocuments({ cnh_verificada: { $ne: true } }) + " usuários, dos quais " +
  db.usuarios.countDocuments({ cnh_verificada: { $exists: false } }) + " são passageiros sem o campo.");

// -----------------------------------------------------------------------------
// C02 | Quais são os dados de cadastro da usuária com e-mail
//       ana.lima@email.com?
// Itens: FINDONE, FIND, SORT, COUNTDOCUMENTS (o .pretty() literal está em C01)
//
// findOne(filtro) devolve o primeiro documento que atende ao filtro (ou null),
// e não um cursor. É a forma natural de buscar por uma chave única: o índice
// idx_email_unico garante no máximo um usuário por e-mail e faz a busca usar
// o índice em vez de varrer a coleção. Como findOne devolve um documento, e
// não um cursor, não existe .pretty() nele: a impressão formatada é feita com
// printjson, o "pretty print" do shell, que mostra cada campo numa linha.
// -----------------------------------------------------------------------------
titulo("C02", "Quais são os dados de cadastro da usuária com e-mail ana.lima@email.com?",
  ["FINDONE", "FIND", "SORT", "COUNTDOCUMENTS"]);
const c02 = db.usuarios.findOne({ email: "ana.lima@email.com" });
exigirNaoVazio("C02", c02);
printjson(c02);

// Complemento do cadastro: veículos dela e participação na plataforma.
// $elemMatch exige que um mesmo elemento do array atenda a todas as condições.
// Na pergunta "quantas reservas ela cancelou?", a forma sem $elemMatch,
// { "passageiros.usuario_id": "U001", "passageiros.status": "cancelado" },
// aceita uma viagem em que ela confirmou e outra pessoa cancelou, porque cada
// condição pode casar com um elemento diferente do array.
print("Veículos da usuária:");
mostrar(db.veiculos.find({ motorista_id: c02._id }, { _id: 1, marca: 1, modelo: 1, combustivel: 1 }).sort({ _id: 1 }));
const comoMotorista = db.viagens.countDocuments({ motorista_id: c02._id });
const comoPassageira = db.viagens.countDocuments({
  passageiros: { $elemMatch: { usuario_id: c02._id, status: "confirmado" } }
});
const cancelouElemMatch = db.viagens.countDocuments({
  passageiros: { $elemMatch: { usuario_id: c02._id, status: "cancelado" } }
});
const cancelouSolto = db.viagens.countDocuments({
  "passageiros.usuario_id": c02._id, "passageiros.status": "cancelado"
});
print("Viagens como motorista: " + comoMotorista + " | como passageira confirmada: " + comoPassageira);
print("Reservas canceladas por ela, com $elemMatch: " + cancelouElemMatch +
  " | com as condições soltas: " + cancelouSolto + " (resposta errada)");
exigir("C02", cancelouSolto > cancelouElemMatch, "os dados não mostram a diferença do $elemMatch");
const viagensSoltas = db.viagens.find(
  { "passageiros.usuario_id": c02._id, "passageiros.status": "cancelado",
    passageiros: { $not: { $elemMatch: { usuario_id: c02._id, status: "cancelado" } } } },
  { "passageiros.usuario_id": 1, "passageiros.status": 1 }
).sort({ _id: 1 });
print("Viagem contada a mais sem $elemMatch (ela confirmou; quem cancelou foi outra pessoa):");
mostrar(viagensSoltas);

// -----------------------------------------------------------------------------
// C03 | Quais são as 5 viagens mais caras entre as de 50 km ou mais e com
//       assento a partir de R$ 20 (só realizadas ou agendadas)?
// Itens: FIND, GTE, SORT, LIMIT
//
// $gte (greater than or equal) seleciona valores maiores ou iguais ao
// informado. Vários campos no mesmo filtro funcionam como E lógico. $in
// aceita qualquer um dos valores da lista e tira as canceladas do ranking.
// sort com dois campos: primeiro preço decrescente; no empate, maior
// distância; no empate de novo, _id, para a ordem ser sempre a mesma.
// limit(5) corta o cursor nos 5 primeiros já ordenados (o servidor aplica o
// sort antes do limit, independente da ordem em que os métodos são chamados).
// -----------------------------------------------------------------------------
titulo("C03", "Quais são as 5 viagens mais caras entre as de 50 km ou mais e assento a partir de R$ 20?",
  ["FIND", "GTE", "SORT", "LIMIT"]);
const filtroC03 = {
  distancia_km: { $gte: 50 },
  preco_assento: { $gte: 20 },
  status: { $in: ["concluida", "agendada"] }
};
const c03 = db.viagens.find(
  filtroC03,
  { _id: 1, "origem.cidade": 1, "destino.cidade": 1, distancia_km: 1, preco_assento: 1, status: 1, data_hora: 1 }
).sort({ preco_assento: -1, distancia_km: -1, _id: 1 }).limit(5);
exigirNaoVazio("C03", mostrar(c03));
print("Viagens que atendem ao filtro, antes do limit: " + db.viagens.countDocuments(filtroC03));

// -----------------------------------------------------------------------------
// C04 | Quais viagens concluídas saíram com exatamente 3 passageiros na
//       lista?
// Itens: FIND, SIZE, SORT
//
// $size compara o tamanho de um array com um número exato. No find ele só
// aceita igualdade: { $size: { $gte: 3 } } não funciona. Para comparar
// tamanho com faixa ou com outro campo, é preciso o $size de expressão,
// dentro de $expr no filtro (J01, U03) ou num estágio do pipeline (G03, G04).
// Observação de negócio: a lista inclui quem cancelou. Por isso a projeção
// mostra o status de cada passageiro, e G04 separa só os confirmados.
// -----------------------------------------------------------------------------
titulo("C04", "Quais viagens concluídas saíram com exatamente 3 passageiros na lista?",
  ["FIND", "SIZE", "SORT"]);
const c04 = db.viagens.find(
  { status: "concluida", passageiros: { $size: 3 } },
  { _id: 1, "origem.cidade": 1, "destino.cidade": 1, vagas_ofertadas: 1,
    "passageiros.usuario_id": 1, "passageiros.status": 1 }
).sort({ _id: 1 });
exigirNaoVazio("C04", mostrar(c04, 6));

// -----------------------------------------------------------------------------
// C05 | Quais usuários aceitam, ao mesmo tempo, pet e música?
// Itens: FIND, ALL, SORT
//
// $all seleciona documentos cujo array contém todos os valores informados,
// em qualquer ordem e junto com outros valores. A diferença para $in é que
// $in exige pelo menos um. A contagem com $in abaixo mostra o contraste.
// -----------------------------------------------------------------------------
titulo("C05", "Quais usuários aceitam, ao mesmo tempo, pet e música?",
  ["FIND", "ALL", "SORT"]);
const c05 = db.usuarios.find(
  { preferencias: { $all: ["pet friendly", "musica"] } },
  { nome: 1, "endereco.cidade": 1, preferencias: 1 }
).sort({ nome: 1 });
exigirNaoVazio("C05", mostrar(c05));
print("Para comparação, usuários que aceitam pet OU música ($in): " +
  db.usuarios.countDocuments({ preferencias: { $in: ["pet friendly", "musica"] } }));

// -----------------------------------------------------------------------------
// C06 | Quantas viagens concluídas saíram de Recife? Como Recife se compara
//       às outras cidades de origem?
// Itens: COUNTDOCUMENTS
//
// countDocuments(filtro) conta os documentos que atendem ao filtro, de forma
// exata, usando o índice idx_origem_cidade. Substitui o antigo count(), que
// está deprecated porque podia devolver números errados em clusters
// fragmentados ou sem filtro (lia metadados em vez de contar documentos).
// Para comparar as cidades, distinct("origem.cidade", filtro) devolve a
// lista de valores distintos do campo, e um countDocuments por cidade conta
// as concluídas e as agendadas de cada uma.
// -----------------------------------------------------------------------------
titulo("C06", "Quantas viagens concluídas saíram de Recife? Como Recife se compara às outras origens?",
  ["COUNTDOCUMENTS"]);
const c06 = db.viagens.countDocuments({ status: "concluida", "origem.cidade": "Recife" });
exigirNaoVazio("C06", c06);
const totalConcluidas = db.viagens.countDocuments({ status: "concluida" });
print("Viagens concluídas com origem em Recife: " + c06);
print("Total de viagens concluídas: " + totalConcluidas +
  " (Recife responde por " + (100 * c06 / totalConcluidas).toFixed(1) + "%)");
print("Por cidade de origem (concluídas | agendadas):");
db.viagens.distinct("origem.cidade", { status: { $in: ["concluida", "agendada"] } }).sort().forEach(cidade => {
  const concluidas = db.viagens.countDocuments({ status: "concluida", "origem.cidade": cidade });
  const agendadas = db.viagens.countDocuments({ status: "agendada", "origem.cidade": cidade });
  print("  " + cidade + ": " + concluidas + " | " + agendadas);
});

// -----------------------------------------------------------------------------
// C07 | Quais avaliações elogiam pontualidade ou educação e não mencionam
//       atraso?
// Itens: TEXT, SEARCH, GTE, SORT (por textScore), LIMIT
//
// $text faz busca textual no índice de texto da coleção (idx_texto_comentario,
// criado com default_language "portuguese"). $search é o parâmetro do $text
// que recebe os termos (não confundir com o estágio $search do Atlas Search,
// que é outro recurso, exclusivo do Atlas):
//   - termos separados por espaço funcionam como OU ("pontual" ou "educado");
//   - o stemming reduz as palavras ao radical, então "pontual" também acha
//     "pontualidade" e "pontualmente", e "educado" acha "educada";
//   - o sinal de menos exclui: "-atrasou" remove documentos com o radical
//     de "atrasou" (também "atraso", "atrasada");
//   - aspas duplas exigem a frase exata.
// { $meta: "textScore" } projeta a relevância calculada pelo MongoDB (mais
// termos encontrados e mais frequentes, maior o score), e o mesmo $meta no
// sort ordena da mais relevante para a menos relevante.
// A busca textual não entende sentido: "mal-educado" também contém o radical
// de "educado". Por isso o filtro nota >= 4 garante que só entram elogios. O
// $text pode ser combinado com filtros comuns no mesmo find.
// -----------------------------------------------------------------------------
titulo("C07", "Quais avaliações elogiam pontualidade ou educação e não mencionam atraso?",
  ["TEXT", "SEARCH", "GTE", "SORT", "LIMIT"]);
const c07 = db.avaliacoes.find(
  { $text: { $search: "pontual educado -atrasou" }, nota: { $gte: 4 } },
  { score: { $meta: "textScore" }, nota: 1, comentario: 1 }
).sort({ score: { $meta: "textScore" }, _id: 1 }).limit(8);
exigirNaoVazio("C07", mostrar(c07));

const comNegacao = db.avaliacoes.countDocuments({ $text: { $search: "pontual educado -atrasou" }, nota: { $gte: 4 } });
const semNegacao = db.avaliacoes.countDocuments({ $text: { $search: "pontual educado" }, nota: { $gte: 4 } });
const semFiltroNota = db.avaliacoes.countDocuments({ $text: { $search: "pontual educado -atrasou" } });
print("Elogios sem menção a atraso (nota >= 4): " + comNegacao);
print("Mesma busca sem o termo -atrasou: " + semNegacao + " | sem o filtro de nota: " + semFiltroNota);
print("Avaliações com nota baixa que a busca textual pegaria sem o filtro de nota:");
mostrar(db.avaliacoes.find(
  { $text: { $search: "pontual educado -atrasou" }, nota: { $lt: 4 } },
  { nota: 1, comentario: 1 }
).sort({ nota: 1, _id: 1 }), 5);
// Os _id do resultado com exclusão entram num $nin: sobra exatamente o que o
// termo negativo retirou ($nin = valor fora da lista).
const idsComNegacao = db.avaliacoes.find(
  { $text: { $search: "pontual educado -atrasou" }, nota: { $gte: 4 } }, { _id: 1 })
  .toArray().map(a => a._id);
print("Avaliações que o termo -atrasou retirou do resultado:");
mostrar(db.avaliacoes.find(
  { $text: { $search: "pontual educado" }, nota: { $gte: 4 }, _id: { $nin: idsComNegacao } },
  { nota: 1, comentario: 1 }
).sort({ _id: 1 }));

// Busca por frase exata combinada com filtro comum: reclamações graves.
print("Frase exata \"direção perigosa\" em avaliações com nota até 2:");
mostrar(db.avaliacoes.find(
  { $text: { $search: "\"direção perigosa\"" }, nota: { $lte: 2 } },
  { nota: 1, avaliado_id: 1, comentario: 1 }
).sort({ _id: 1 }));

// -----------------------------------------------------------------------------
// C08 | Quais veículos não têm o campo eletrico (frota a combustão)?
// Itens: FIND, EXISTS (false), SORT, COUNTDOCUMENTS
//
// $exists: false seleciona documentos em que o campo NÃO existe. O campo
// eletrico só foi gravado em elétricos e híbridos, então a ausência dele
// identifica a frota a combustão. Note que { eletrico: false } não traria
// nada: nenhum documento tem o campo com valor false. A ordenação por ano
// coloca os carros mais antigos (candidatos a troca) primeiro.
// Para medir o peso dessa frota, os _id do resultado entram num $in e o
// countDocuments conta quantas viagens concluídas foram feitas com ela.
// -----------------------------------------------------------------------------
titulo("C08", "Quais veículos não têm o campo eletrico (frota a combustão)?",
  ["FIND", "EXISTS", "SORT", "COUNTDOCUMENTS"]);
const c08 = db.veiculos.find(
  { eletrico: { $exists: false } },
  { _id: 1, marca: 1, modelo: 1, ano: 1, combustivel: 1, motorista_id: 1 }
).sort({ ano: 1, _id: 1 });
exigirNaoVazio("C08", mostrar(c08));
print("Conferência (o esperado é 0): veículos com { eletrico: false }: " +
  db.veiculos.countDocuments({ eletrico: false }));
print("Frota a combustão: " + db.veiculos.countDocuments({ eletrico: { $exists: false } }) +
  " de " + db.veiculos.countDocuments({}) + " veículos");
const idsCombustao = db.veiculos.find({ eletrico: { $exists: false } }, { _id: 1 }).toArray().map(v => v._id);
print("Viagens concluídas feitas com a frota a combustão: " +
  db.viagens.countDocuments({ status: "concluida", veiculo_id: { $in: idsCombustao } }) +
  " de " + db.viagens.countDocuments({ status: "concluida" }));

// -----------------------------------------------------------------------------
// C09 | Quais viagens de rodovia (realizadas ou agendadas) saem pela manhã
//       e fazem exatamente 2 paradas no caminho?
// Itens: FIND, ALL, SIZE, SORT
//
// tags e paradas são arrays de strings no próprio documento da viagem.
// $all exige que tags contenha "rodovia" E "manha" (em qualquer posição);
// $size: 2 exige que o array paradas tenha exatamente dois elementos.
// Os dois operadores de array juntos respondem à pergunta sem nenhuma
// junção, porque os dados estão embutidos na viagem. $ne (not equal) tira as
// canceladas.
// -----------------------------------------------------------------------------
titulo("C09", "Quais viagens de rodovia saem pela manhã e fazem exatamente 2 paradas?",
  ["FIND", "ALL", "SIZE", "SORT"]);
const c09 = db.viagens.find(
  { tags: { $all: ["rodovia", "manha"] }, paradas: { $size: 2 }, status: { $ne: "cancelada" } },
  { "origem.cidade": 1, "destino.cidade": 1, paradas: 1, tags: 1, data_hora: 1, status: 1 }
).sort({ data_hora: 1 });
exigirNaoVazio("C09", mostrar(c09, 6));

// -----------------------------------------------------------------------------
// C10 | Quais foram as 3 viagens concluídas mais recentes da motorista Ana
//       (U001)? E o índice composto ajuda nessa busca?
// Itens: FIND, SORT, LIMIT, COUNTDOCUMENTS (e explain)
//
// O índice idx_motorista_status é composto: { motorista_id: 1, status: 1 }.
// Um índice composto só é usado quando o filtro inclui o seu prefixo, ou
// seja, os campos da esquerda para a direita: motorista_id sozinho, ou
// motorista_id com status. Um filtro só por status (sem motorista_id) não
// usa esse índice e obriga o MongoDB a ler a coleção inteira (COLLSCAN).
// explain("queryPlanner") mostra o plano escolhido sem executar a consulta:
// IXSCAN significa varredura de índice; COLLSCAN, varredura da coleção.
// -----------------------------------------------------------------------------
titulo("C10", "Quais foram as 3 viagens concluídas mais recentes da motorista U001? O índice composto ajuda?",
  ["FIND", "SORT", "LIMIT", "COUNTDOCUMENTS"]);
const c10 = db.viagens.find(
  { motorista_id: "U001", status: "concluida" },
  { data_hora: 1, "origem.cidade": 1, "destino.cidade": 1, co2_economizado_kg: 1 }
).sort({ data_hora: -1 }).limit(3);
exigirNaoVazio("C10", mostrar(c10));
print("Viagens concluídas da U001 no total: " +
  db.viagens.countDocuments({ motorista_id: "U001", status: "concluida" }));

// Percorre o plano vencedor e devolve os estágios, com o índice usado.
function resumoPlano(explicacao) {
  const etapas = [];
  let no = explicacao.queryPlanner.winningPlan;
  while (no) {
    etapas.push(no.stage + (no.indexName ? " (" + no.indexName + ")" : ""));
    no = no.inputStage;
  }
  return etapas.join(" <- ");
}
print("Plano com motorista_id + status (prefixo completo): " +
  resumoPlano(db.viagens.find({ motorista_id: "U001", status: "concluida" }).explain("queryPlanner")));
print("Plano só com motorista_id (prefixo parcial):        " +
  resumoPlano(db.viagens.find({ motorista_id: "U001" }).explain("queryPlanner")));
print("Plano só com status (fora do prefixo):              " +
  resumoPlano(db.viagens.find({ status: "concluida" }).explain("queryPlanner")));
