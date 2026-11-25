// =============================================================================
// 01_seed.js: povoamento determinístico do banco caronas_sustentaveis.
//
// I01: insertMany em usuarios, veiculos, viagens e avaliacoes
// I02: cadastro avulso de um novo usuário com insertOne
//
// Itens da checklist: INSERTONE (em I02). O insertMany de I01 cobre a
// exigência de inserção do enunciado.
//
// Todo dado "aleatório" sai de um gerador pseudoaleatório com semente fixa
// (mulberry32). Assim, cada execução produz os mesmos documentos e as
// saídas em saidas/ são reproduzíveis.
//
// Regras de negócio respeitadas (conferidas por tools/validar_dados.js):
//   - co2_economizado_kg = distancia_km x 0,12 x passageiros confirmados
//     (nas viagens agendadas o valor é a economia prevista);
//   - confirmados <= vagas_ofertadas <= capacidade do veículo - 1, com duas
//     exceções propositais (viagens com passageiro a mais) para J01 encontrar;
//   - valor_pago = preco_assento para confirmados e 0 para cancelados;
//   - só viagens concluídas recebem avaliações;
//   - notas concentradas entre 3 e 5, com 1 e 2 ligadas a comentários negativos.
// =============================================================================
load(__dirname + "/_helpers.js");
db = db.getSiblingDB(NOME_BANCO);

// -----------------------------------------------------------------------------
// Gerador pseudoaleatório com semente fixa (mulberry32)
// -----------------------------------------------------------------------------
function mulberry32(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261130);
const inteiro = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const sortear = lista => lista[Math.floor(rnd() * lista.length)];
const chance = p => rnd() < p;
function embaralhar(lista) {
  const v = lista.slice();
  for (let i = v.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [v[i], v[j]] = [v[j], v[i]];
  }
  return v;
}
function sortearPonderado(opcoes) { // opcoes: [[valor, peso], ...]
  const total = opcoes.reduce((s, o) => s + o[1], 0);
  let r = rnd() * total;
  for (const [valor, peso] of opcoes) { if ((r -= peso) < 0) return valor; }
  return opcoes[opcoes.length - 1][0];
}
const arred2 = x => Math.round(x * 100) / 100;
const pad = (n, t) => String(n).padStart(t, "0");
const semAcento = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// -----------------------------------------------------------------------------
// Dados de referência
// -----------------------------------------------------------------------------
const FATOR_CO2 = 0.12; // kg de CO2 por km, emissão média adotada

const BAIRROS = {
  "Recife": ["Boa Viagem", "Casa Forte", "Espinheiro", "Graças", "Madalena", "Várzea", "Pina", "Boa Vista", "Imbiribeira"],
  "Olinda": ["Carmo", "Bairro Novo", "Casa Caiada", "Rio Doce"],
  "Jaboatão dos Guararapes": ["Piedade", "Candeias", "Prazeres"],
  "Paulista": ["Janga", "Pau Amarelo", "Centro"],
  "Cabo de Santo Agostinho": ["Centro", "Gaibu"],
  "Camaragibe": ["Centro", "Aldeia"],
  "Caruaru": ["Centro", "Maurício de Nassau", "Universitário"],
  "Gravatá": ["Centro", "Prado"]
};
const PESO_CIDADE_USUARIO = [
  ["Recife", 16], ["Olinda", 5], ["Jaboatão dos Guararapes", 4], ["Paulista", 3],
  ["Cabo de Santo Agostinho", 2], ["Camaragibe", 2], ["Caruaru", 5], ["Gravatá", 3]
];

const NOMES = [
  "Ana Beatriz Lima", "Bruno Henrique Santos", "Carla Mendes Araújo", "Diego Ferreira Costa",
  "Eduarda Nogueira Melo", "Felipe Cavalcanti Rocha", "Gabriela Souza Pires", "Henrique Barbosa Lins",
  "Isabela Tavares Moura", "João Victor Albuquerque", "Karina Oliveira Dantas", "Lucas Gomes Pereira",
  "Mariana Freitas Leão", "Nathan Ribeiro Brito", "Olívia Campos Siqueira", "Paulo Sérgio Andrade",
  "Quézia Monteiro Farias", "Rafael Duarte Macedo", "Sabrina Lopes Vieira", "Thiago Correia Bezerra",
  "Úrsula Pacheco Neves", "Vinícius Arruda Paiva", "Wanessa Batista Queiroz", "Xavier Medeiros Galvão",
  "Yasmin Carvalho Rego", "José Carlos Amorim", "Amanda Rezende Torres", "Caio Matos Figueiredo",
  "Débora Sales Coelho", "Enzo Bastos Moreira", "Fernanda Lira Accioly", "Gustavo Pimentel Sá",
  "Helena Brandão Cunha", "Igor Teixeira Lacerda", "Júlia Veras Montenegro", "Leonardo Aguiar Pessoa",
  "Manuela Dias Carneiro", "Nicolas Prado Valença", "Patrícia Holanda Maia", "Renato Vasconcelos Luna"
];
const PREFERENCIAS = ["sem fumo", "musica", "pet friendly", "ar condicionado", "conversa", "silencio", "bagagem grande"];

const QTD_MOTORISTAS = 15; // U001 a U015

// -----------------------------------------------------------------------------
// usuarios
// -----------------------------------------------------------------------------
const usuarios = NOMES.map((nome, i) => {
  const id = "U" + pad(i + 1, 3);
  const partes = semAcento(nome).toLowerCase().split(" ");
  const motorista = i < QTD_MOTORISTAS;
  const cidade = i === 0 ? "Recife" : sortearPonderado(PESO_CIDADE_USUARIO);
  const bairro = i === 0 ? "Boa Viagem" : sortear(BAIRROS[cidade]);
  let prefs = i === 0
    ? ["sem fumo", "musica", "pet friendly"]
    : embaralhar(PREFERENCIAS).slice(0, inteiro(1, 4));
  if (prefs.includes("conversa") && prefs.includes("silencio")) prefs = prefs.filter(p => p !== "silencio");
  const doc = {
    _id: id,
    nome: nome,
    email: partes[0] + "." + partes[partes.length - 1] + "@email.com",
    telefone: "8199999" + pad(i + 1, 4),
    endereco: { bairro: bairro, cidade: cidade, uf: "PE" },
    perfis: motorista ? ["motorista", "passageiro"] : ["passageiro"],
    preferencias: prefs
  };
  // Campo opcional: só existe em motoristas. U015 acabou de se cadastrar e
  // ainda aguarda a verificação (U01 aprova a CNH dela).
  if (motorista) doc.cnh_verificada = id !== "U015";
  doc.data_cadastro = new Date(Date.UTC(2025, inteiro(0, 11), inteiro(1, 28), inteiro(8, 20), 0, 0));
  return doc;
});

// -----------------------------------------------------------------------------
// veiculos (18, sendo 5 elétricos ou híbridos)
// -----------------------------------------------------------------------------
const veiculos = [
  ["U001", "BYD", "Dolphin", 2024, "PEX1A23", 4, "eletrico"],
  ["U001", "Fiat", "Argo", 2019, "PEB4C17", 5, "flex"],
  ["U002", "Volkswagen", "Gol", 2016, "KGT2D45", 5, "flex"],
  ["U003", "Toyota", "Corolla Cross Hybrid", 2023, "QYR7E81", 5, "hibrido"],
  ["U003", "Chevrolet", "Spin", 2018, "PFA3B92", 7, "flex"],
  ["U004", "Hyundai", "HB20", 2020, "QRM5F04", 5, "flex"],
  ["U005", "Renault", "Kwid", 2022, "RZK8G33", 5, "flex"],
  ["U006", "Chevrolet", "Onix", 2021, "QXT1H56", 5, "flex"],
  ["U007", "Renault", "Kwid E-Tech", 2024, "SAE6J12", 4, "eletrico"],
  ["U007", "Fiat", "Uno", 2014, "KHM9K70", 5, "gasolina"],
  ["U008", "Fiat", "Siena", 2015, "KLP4L28", 5, "gnv"],
  ["U009", "Honda", "City", 2019, "PGD2M63", 5, "gasolina"],
  ["U010", "Jeep", "Renegade", 2021, "QVB7N39", 5, "flex"],
  ["U011", "Toyota", "Prius", 2018, "PCU3P85", 5, "hibrido"],
  ["U012", "Volkswagen", "Polo", 2022, "RTW5Q47", 5, "flex"],
  ["U013", "Ford", "Ka", 2015, "KNE8R19", 5, "gnv"],
  ["U014", "Nissan", "Kicks", 2023, "SBF1S54", 5, "flex"],
  ["U015", "GWM", "Ora 03", 2025, "SCH4T26", 5, "eletrico"]
].map((v, i) => {
  const doc = {
    _id: "V" + pad(i + 1, 3), motorista_id: v[0], marca: v[1], modelo: v[2],
    ano: v[3], placa: v[4], capacidade: v[5], combustivel: v[6]
  };
  // Campo opcional: só existe em elétricos e híbridos.
  if (v[6] === "eletrico" || v[6] === "hibrido") doc.eletrico = true;
  return doc;
});
const veiculosPorMotorista = {};
veiculos.forEach(v => (veiculosPorMotorista[v.motorista_id] ||= []).push(v));

// -----------------------------------------------------------------------------
// viagens (80: 60 concluídas, 12 agendadas, 8 canceladas)
// -----------------------------------------------------------------------------
// [origem, destino, km, paradas, peso no sorteio]
const ROTAS = [
  ["Recife", "Caruaru", 135, ["Jaboatão dos Guararapes", "Vitória de Santo Antão"], 7],
  ["Caruaru", "Recife", 135, ["Vitória de Santo Antão", "Jaboatão dos Guararapes"], 6],
  ["Recife", "Gravatá", 85, ["Jaboatão dos Guararapes"], 4],
  ["Gravatá", "Recife", 85, ["Jaboatão dos Guararapes"], 3],
  ["Recife", "Olinda", 12, [], 5],
  ["Olinda", "Recife", 12, [], 5],
  ["Recife", "Paulista", 22, ["Olinda"], 3],
  ["Paulista", "Recife", 22, ["Olinda"], 3],
  ["Recife", "Cabo de Santo Agostinho", 38, ["Jaboatão dos Guararapes"], 3],
  ["Cabo de Santo Agostinho", "Recife", 38, ["Jaboatão dos Guararapes"], 2],
  ["Jaboatão dos Guararapes", "Recife", 18, [], 3],
  ["Recife", "Jaboatão dos Guararapes", 18, [], 3],
  ["Camaragibe", "Recife", 16, [], 2],
  ["Recife", "Camaragibe", 16, [], 2],
  ["Camaragibe", "Caruaru", 125, ["Vitória de Santo Antão", "Gravatá"], 2],
  ["Caruaru", "Gravatá", 50, [], 2],
  ["Olinda", "Caruaru", 145, ["Recife", "Vitória de Santo Antão"], 2],
  ["Paulista", "Cabo de Santo Agostinho", 55, ["Olinda", "Recife", "Jaboatão dos Guararapes"], 2]
];

// Datas: 68 viagens já ocorridas (1/set a 19/nov), 3 agendadas que ficaram
// esquecidas no passado (U06 cancela) e 9 agendadas futuras (25/nov a 18/dez).
function dataLocal(ano, mes, dia, hora, minuto) {
  // Horário de Recife (UTC-3) convertido para UTC.
  return new Date(Date.UTC(ano, mes - 1, dia, hora + 3, minuto, 0));
}
const planos = [];
const inicio = Date.UTC(2026, 8, 1);
for (let i = 0; i < 68; i++) {
  const d = new Date(inicio + inteiro(0, 79) * 86400000);
  const data = dataLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), inteiro(6, 20), sortear([0, 15, 30, 45]));
  planos.push({ data: data, tipo: "passada" });
}
[[12, 7], [16, 17], [18, 6]].forEach(([dia, h]) => {
  planos.push({ data: dataLocal(2026, 11, dia, h, 30), tipo: "agendada" });
});
for (let i = 0; i < 9; i++) {
  const d = new Date(Date.UTC(2026, 10, 25) + inteiro(0, 23) * 86400000);
  const data = dataLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), inteiro(6, 20), sortear([0, 15, 30, 45]));
  planos.push({ data: data, tipo: "agendada" });
}
planos.sort((a, b) => a.data - b.data);

// Das 68 passadas, 8 viram canceladas (sorteio determinístico).
const idxPassadas = planos.map((p, i) => p.tipo === "passada" ? i : -1).filter(i => i >= 0);
const idxCanceladas = new Set(embaralhar(idxPassadas).slice(0, 8));
planos.forEach((p, i) => {
  p.status = p.tipo === "agendada" ? "agendada" : (idxCanceladas.has(i) ? "cancelada" : "concluida");
});

// Motoristas que oferecem viagens: U001 a U014 (U015 ainda não foi aprovada).
const motoristasAtivos = usuarios.slice(0, 14).map(u => u._id);
let filaMotoristas = [];
for (let r = 0; r < 5; r++) filaMotoristas = filaMotoristas.concat(motoristasAtivos);
for (let r = 0; r < 10; r++) filaMotoristas.push(sortear(motoristasAtivos));
filaMotoristas = embaralhar(filaMotoristas);

// Duas exceções propositais: a 12ª e a 41ª viagem concluída recebem um
// passageiro confirmado a mais do que as vagas ofertadas.
const ordemConcluidas = planos.map((p, i) => p.status === "concluida" ? i : -1).filter(i => i >= 0);
const idxExcecoes = new Set([ordemConcluidas[11], ordemConcluidas[40]]);

// Agenda: ninguém dirige ou viaja como passageiro confirmado em duas viagens
// com menos de 4 horas de diferença entre as saídas.
const INTERVALO_MINIMO_MS = 4 * 3600000;
const agenda = {};
const livre = (id, data) => (agenda[id] || []).every(t => Math.abs(t - data.getTime()) >= INTERVALO_MINIMO_MS);
const ocupar = (id, data) => (agenda[id] ||= []).push(data.getTime());

// Escolhe o motorista da posição i da fila; se ele estiver ocupado nesse
// horário, troca com o próximo da fila que esteja livre.
function escolherMotorista(i, data) {
  for (let j = i; j < filaMotoristas.length; j++) {
    if (livre(filaMotoristas[j], data)) {
      [filaMotoristas[i], filaMotoristas[j]] = [filaMotoristas[j], filaMotoristas[i]];
      return filaMotoristas[i];
    }
  }
  return sortear(motoristasAtivos.filter(m => livre(m, data)));
}

// Todo motorista também viaja como passageiro: os 15 entram primeiro na fila
// de passageiros das viagens concluídas.
const pendentesComoPassageiro = usuarios.slice(0, QTD_MOTORISTAS).map(u => u._id);
const todosIds = usuarios.map(u => u._id);
const CUPONS = ["VERDE10", "PRIMEIRACARONA", "SEMANADOMEIOAMBIENTE"];

function escolherPassageiros(qtd, motoristaId, priorizarMotoristas, data) {
  const escolhidos = [];
  if (priorizarMotoristas) {
    for (let k = 0; k < pendentesComoPassageiro.length && escolhidos.length < qtd; k++) {
      const cand = pendentesComoPassageiro[k];
      if (cand !== motoristaId && livre(cand, data)) {
        escolhidos.push(cand);
        pendentesComoPassageiro.splice(k, 1);
        break;
      }
    }
  }
  const restantes = embaralhar(todosIds.filter(id =>
    id !== motoristaId && !escolhidos.includes(id) && livre(id, data)));
  return escolhidos.concat(restantes.slice(0, qtd - escolhidos.length));
}

function tagsDaViagem(rota, data) {
  const tags = [];
  tags.push(rota[2] >= 50 ? "rodovia" : "urbano");
  tags.push("intermunicipal");
  const horaLocal = (data.getUTCHours() + 21) % 24;
  tags.push(horaLocal < 12 ? "manha" : horaLocal < 18 ? "tarde" : "noite");
  const diaSemana = new Date(data.getTime() - 3 * 3600000).getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) tags.push("fim de semana");
  return tags;
}

const viagens = planos.map((p, i) => {
  const id = "T" + pad(i + 1, 4);
  const motoristaId = escolherMotorista(i, p.data);
  ocupar(motoristaId, p.data);
  const veiculo = sortear(veiculosPorMotorista[motoristaId]);
  const rota = sortearPonderado(ROTAS.map(r => [r, r[4]]));
  const preco = Math.max(6, Math.round((rota[2] * 0.24 + 3 + inteiro(-4, 4) * 0.5) * 2) / 2);
  const excecao = idxExcecoes.has(i);
  const vagas = excecao ? 2 : inteiro(Math.min(2, veiculo.capacidade - 1), veiculo.capacidade - 1);

  let confirmados, cancelados;
  if (p.status === "concluida") {
    confirmados = excecao ? vagas + 1 : sortearPonderado([[vagas, 5], [Math.max(1, vagas - 1), 3], [1, 1]]);
    cancelados = chance(0.3) ? 1 : 0;
  } else if (p.status === "agendada") {
    // As agendadas que ficaram no passado têm reservas pagas que o motorista
    // nunca confirmou (U06 cancela e estorna); as futuras podem estar vazias.
    confirmados = p.data < DATA_REFERENCIA ? inteiro(1, vagas) : inteiro(0, vagas);
    cancelados = chance(0.25) ? 1 : 0;
  } else {
    confirmados = 0;
    cancelados = inteiro(1, Math.min(3, vagas));
  }

  const ids = escolherPassageiros(confirmados + cancelados, motoristaId,
    p.status === "concluida" && confirmados > 0, p.data);
  const passageiros = ids.map((uid, k) => {
    const confirmado = k < confirmados;
    if (confirmado) ocupar(uid, p.data);
    const pas = {
      usuario_id: uid,
      status: confirmado ? "confirmado" : "cancelado",
      valor_pago: confirmado ? preco : 0
    };
    // Campo opcional: cupom de desconto custeado pela plataforma (o motorista
    // recebe o valor cheio, então valor_pago não muda).
    if (confirmado && chance(0.12)) pas.cupom = sortear(CUPONS);
    return pas;
  });

  return {
    _id: id,
    motorista_id: motoristaId,
    veiculo_id: veiculo._id,
    origem: { cidade: rota[0], bairro: sortear(BAIRROS[rota[0]]) },
    destino: { cidade: rota[1], bairro: sortear(BAIRROS[rota[1]]) },
    paradas: rota[3].slice(),
    data_hora: p.data,
    distancia_km: rota[2],
    preco_assento: preco,
    vagas_ofertadas: vagas,
    passageiros: passageiros,
    status: p.status,
    co2_economizado_kg: arred2(rota[2] * FATOR_CO2 * confirmados),
    tags: tagsDaViagem(rota, p.data)
  };
});

// -----------------------------------------------------------------------------
// avaliacoes (120, só de viagens concluídas)
// -----------------------------------------------------------------------------
// Cada comentário junta uma abertura e um complemento sorteados conforme o
// papel e a nota, o que gera dezenas de textos diferentes para a busca
// textual. Aberturas que já são frases completas (com vírgula) dispensam o
// complemento. Toda abertura de nota 1 ou 2 contém uma palavra negativa.
// Marcadores: {o} vira "o" ou "a" conforme o gênero da pessoa avaliada
// (educad{o} -> educado/educada); {carro_verde} só é usado quando o veículo
// da viagem é elétrico ou híbrido e vira o tipo do motor. Textos que citam a
// BR-232 só entram em rotas de ou para Caruaru e Gravatá (as que usam essa
// rodovia), e textos sobre paradas só entram em rotas com paradas.
const COMENTARIOS = {
  motorista: {
    5: [["Motorista pontual e educad{o}", "Motorista muito educad{o} e atencios{o}", "Chegou no horário combinado",
         "Pontualidade impecável", "Excelente motorista", "Viagem tranquila do início ao fim",
         "Motorista simpátic{o} e pontual", "Carro {carro_verde} silencioso"],
        ["carro muito confortável", "direção segura o tempo todo", "respeitou todas as paradas", "carro limpo e cheiroso",
         "ótima conversa durante o trajeto", "música boa e ar condicionado na medida", "recomendo de olhos fechados"]],
    4: [["Boa viagem", "Motorista educad{o}", "Chegou pontualmente", "Direção tranquila e segura", "Motorista atencios{o}",
         "Carro confortável"],
        ["só o carro estava um pouco quente", "mas conversou pouco", "trajeto rápido pela BR-232",
         "parou para um café no caminho", "mas atrasou uns cinco minutos", "apesar do pequeno atraso na saída",
         "recomendo"]],
    3: [["Viagem ok", "Motorista atrasou um pouco na saída", "Carro apertado para quatro passageiros",
         "Costuma ser pontual, mas desta vez atrasou quase vinte minutos", "Música alta demais"],
        ["mas dirigiu bem", "nada de especial", "faltou avisar sobre a parada extra", "no geral foi razoável"]],
    2: [["Motorista atrasou mais de meia hora", "Direção perigosa na BR-232", "Carro sujo e sem ar condicionado",
         "Atrasou e mudou o ponto de encontro"],
        ["e não avisou ninguém", "com ultrapassagens arriscadas", "não pretendo repetir", "experiência ruim"]],
    1: [["Direção perigosa", "Atrasou quarenta minutos", "Motorista grosseir{o} e mal-educad{o}"],
        ["excesso de velocidade o tempo todo", "cancelou a parada combinada", "tratou os passageiros com desrespeito",
         "não recomendo de jeito nenhum"]]
  },
  passageiro: {
    5: [["Passageir{o} pontual e educad{o}", "Passageir{o} muito educad{o}", "Pontual e simpátic{o}", "Passageir{o} atencios{o}"],
        ["ótima companhia", "chegou antes do horário", "pode voltar sempre", "ajudou a dividir o combustível"]],
    4: [["Passageir{o} tranquil{o}", "Educad{o} e pontual", "Boa companhia"],
        ["só demorou um pouco no embarque", "conversa agradável", "bagagem dentro do combinado",
         "apesar do atraso de dez minutos"]],
    3: [["Passageir{o} atrasou cinco minutos no ponto de encontro", "Bagagem maior do que o combinado", "Passageir{o} quiet{o}"],
        ["mas tudo certo no fim", "nada de especial", "viagem razoável"]],
    2: [["Passageir{o} atrasou e não respondeu as mensagens", "Comeu dentro do carro e deixou sujeira"],
        ["experiência ruim", "não aceitaria de novo"]],
    1: [["Passageir{o} não apareceu no ponto", "Passageir{o} desrespeitos{o} com os outros ocupantes"],
        ["e não avisou", "situação muito desagradável"]]
  }
};
// Gênero usado só para a concordância dos comentários (não é gravado): os
// nomes da lista NOMES alternam feminino (posição par) e masculino (ímpar).
const generoPorId = Object.fromEntries(usuarios.map((u, i) => [u._id, i % 2 === 0 ? "f" : "m"]));
function cabeNaViagem(texto, viagem, verde) {
  if (texto.includes("{carro_verde}") && !verde) return false;
  const pelaBR232 = ["Caruaru", "Gravatá"].includes(viagem.origem.cidade) ||
    ["Caruaru", "Gravatá"].includes(viagem.destino.cidade);
  if (texto.includes("BR-232") && !pelaBR232) return false;
  if (/paradas|parada combinada/.test(texto) && viagem.paradas.length === 0) return false;
  return true;
}
function gerarComentario(papel, nota, avaliadoId, veiculo, viagem) {
  const [todas, todosComplementos] = COMENTARIOS[papel][nota];
  const verde = veiculo.combustivel === "eletrico" || veiculo.combustivel === "hibrido";
  const aberturas = todas.filter(a => cabeNaViagem(a, viagem, verde));
  const complementos = todosComplementos.filter(c => cabeNaViagem(c, viagem, verde));
  let texto = sortear(aberturas);
  if (!texto.includes(",")) texto += ", " + sortear(complementos);
  return texto
    .replace(/\{o\}/g, generoPorId[avaliadoId] === "f" ? "a" : "o")
    .replace("{carro_verde}", veiculo.combustivel === "eletrico" ? "elétrico" : "híbrido");
}
const PESO_NOTAS = [[5, 40], [4, 30], [3, 17], [2, 8], [1, 5]];

const candidatas = [];
viagens.filter(v => v.status === "concluida").forEach(v => {
  const conf = v.passageiros.filter(p => p.status === "confirmado");
  conf.forEach(p => {
    if (chance(0.8)) {
      candidatas.push({ viagem: v, avaliador: p.usuario_id, avaliado: v.motorista_id, papel: "motorista" });
    }
  });
  if (conf.length > 0 && chance(0.6)) {
    candidatas.push({ viagem: v, avaliador: v.motorista_id, avaliado: sortear(conf).usuario_id, papel: "passageiro" });
  }
});
exigir("I01", candidatas.length >= 120, "candidatas insuficientes para 120 avaliações: " + candidatas.length);

// Sorteia 120 candidatas e devolve-as na ordem original (cronológica).
const escolhidas = embaralhar(candidatas.map((c, k) => ({ c, k })))
  .slice(0, 120)
  .sort((a, b) => a.k - b.k)
  .map(x => x.c);
const avaliacoes = escolhidas.map((c, i) => {
  const nota = sortearPonderado(PESO_NOTAS);
  return {
    _id: "A" + pad(i + 1, 4),
    viagem_id: c.viagem._id,
    avaliador_id: c.avaliador,
    avaliado_id: c.avaliado,
    papel_avaliado: c.papel,
    nota: nota,
    comentario: gerarComentario(c.papel, nota, c.avaliado, veiculos.find(v => v._id === c.viagem.veiculo_id), c.viagem),
    // Avaliação feita de 2 a 24 horas depois da viagem: todas ficam antes da
    // DATA_REFERENCIA (o "hoje" do projeto).
    data: new Date(c.viagem.data_hora.getTime() + inteiro(2, 24) * 3600000)
  };
});
// Uma avaliação ofensiva, que viola as regras da comunidade e é removida em R04.
const ofensiva = avaliacoes.find((a, i) => i >= 70 && a.papel_avaliado === "motorista");
ofensiva.nota = 1;
ofensiva.comentario = "Motorista idiota e imbecil, nunca mais pego carona com quem dirige assim";

// -----------------------------------------------------------------------------
// I01 | Inserção em lote
// insertMany grava um array de documentos numa única chamada ao servidor.
// Por padrão é ordenado (ordered: true): se um documento falhar, os seguintes
// não são inseridos. O _id é definido pela aplicação (U001, V001...), então o
// MongoDB não gera ObjectId.
// -----------------------------------------------------------------------------
titulo("I01", "Povoar as quatro coleções com insertMany", [], ["insertMany"]);
const lotes = [["usuarios", usuarios], ["veiculos", veiculos], ["viagens", viagens], ["avaliacoes", avaliacoes]];
lotes.forEach(([nome, docs]) => {
  const r = db.getCollection(nome).insertMany(docs);
  print(nome + ": " + Object.keys(r.insertedIds).length +
    " documentos inseridos (acknowledged: " + r.acknowledged + ")");
});

// -----------------------------------------------------------------------------
// I02 | Cadastro avulso de um novo usuário
// Itens: INSERTONE
// insertOne grava um único documento e devolve { acknowledged, insertedId }.
// Diferente do insertMany, não há lote nem a opção ordered: ou o documento
// entra, ou a chamada falha. Se o documento não trouxesse _id, o driver
// geraria um ObjectId e o devolveria em insertedId; aqui o _id vem da
// aplicação, então o retorno é "U041". A segunda tentativa repete o e-mail
// com outro _id: o índice único idx_email_unico recusa a gravação com o erro
// E11000 (chave duplicada), e a coleção continua com o mesmo total.
// -----------------------------------------------------------------------------
titulo("I02", "Cadastrar uma nova passageira que acabou de criar conta", ["INSERTONE"]);
const novoUsuario = {
  _id: "U041",
  nome: "Tatiana Rocha Guedes",
  email: "tatiana.guedes@email.com",
  telefone: "81999990041",
  endereco: { bairro: "Casa Amarela", cidade: "Recife", uf: "PE" },
  perfis: ["passageiro"],
  preferencias: ["silencio"],
  data_cadastro: ISODate("2026-11-19T14:30:00Z")
};
printjson(db.usuarios.insertOne(novoUsuario));
mostrar(db.usuarios.find({ _id: "U041" }));

const totalAntes = db.usuarios.countDocuments({});
let erroDuplicado = null;
try {
  db.usuarios.insertOne({ ...novoUsuario, _id: "U042", nome: "Cadastro repetido" });
} catch (e) {
  erroDuplicado = e;
}
exigir("I02", erroDuplicado !== null && erroDuplicado.code === 11000, "o e-mail repetido deveria ser recusado");
print("Segunda tentativa com o mesmo e-mail: recusada com código " + erroDuplicado.code);
print(erroDuplicado.message);
print("Usuários antes e depois da tentativa: " + totalAntes + " e " + db.usuarios.countDocuments({}));

// -----------------------------------------------------------------------------
// Resumo do povoamento
// -----------------------------------------------------------------------------
titulo("RESUMO", "Volumes inseridos por coleção e distribuição de status", []);
["usuarios", "veiculos", "viagens", "avaliacoes"].forEach(nome => {
  print(nome + ": " + db.getCollection(nome).countDocuments({}));
});
db.viagens.aggregate([{ $group: { _id: "$status", qtde: { $sum: 1 } } }, { $sort: { _id: 1 } }])
  .forEach(g => print("viagens com status " + g._id + ": " + g.qtde));

// -----------------------------------------------------------------------------
// Um documento real de cada coleção, para ilustrar o modelo de dados
// -----------------------------------------------------------------------------
titulo("EXEMPLOS", "Um documento de cada coleção, como foi gravado", []);
print("usuarios:");
print(db.usuarios.findOne({ _id: "U007" }));
print("veiculos:");
print(db.veiculos.findOne({ _id: "V001" }));
print("viagens:");
print(db.viagens.findOne({ _id: "T0001" }));
print("avaliacoes:");
print(db.avaliacoes.findOne({ _id: "A0001" }));
