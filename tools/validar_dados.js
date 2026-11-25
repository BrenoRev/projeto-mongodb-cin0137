// =============================================================================
// validar_dados.js: confere se o seed respeita as regras de negócio e os
// volumes previstos. Deve rodar logo depois de 01_seed.js (as
// atualizações de 05 e as remoções de 06 alteram os dados de propósito).
// Termina com erro (exit 1) se qualquer regra falhar.
// =============================================================================
db = db.getSiblingDB("caronas_sustentaveis");

const falhas = [];
let verificacoes = 0;
function checar(nome, ok, detalhe) {
  verificacoes++;
  print((ok ? "[OK]    " : "[FALHA] ") + nome + (detalhe ? " (" + detalhe + ")" : ""));
  if (!ok) falhas.push(nome);
}

const usuarios = db.usuarios.find().toArray();
const veiculos = db.veiculos.find().toArray();
const viagens = db.viagens.find().toArray();
const avaliacoes = db.avaliacoes.find().toArray();
const veic = Object.fromEntries(veiculos.map(v => [v._id, v]));
const viag = Object.fromEntries(viagens.map(v => [v._id, v]));
const conf = v => v.passageiros.filter(p => p.status === "confirmado");
const porStatus = s => viagens.filter(v => v.status === s).length;

print("== Volumes ==");
checar("usuarios >= 40", usuarios.length >= 40, usuarios.length);
const motoristas = usuarios.filter(u => u.perfis.includes("motorista"));
checar("cerca de 15 motoristas", motoristas.length >= 13 && motoristas.length <= 17, motoristas.length);
checar("veiculos >= 18", veiculos.length >= 18, veiculos.length);
const verdes = veiculos.filter(v => ["eletrico", "hibrido"].includes(v.combustivel));
checar("pelo menos 4 elétricos ou híbridos", verdes.length >= 4, verdes.length);
checar("viagens >= 80", viagens.length >= 80, viagens.length);
checar("cerca de 60 concluídas, 12 agendadas e 8 canceladas",
  porStatus("concluida") === 60 && porStatus("agendada") === 12 && porStatus("cancelada") === 8,
  porStatus("concluida") + "/" + porStatus("agendada") + "/" + porStatus("cancelada"));
const meses = new Set(viagens.filter(v => v.status === "concluida").map(v => v.data_hora.toISOString().slice(0, 7)));
checar("viagens concluídas espalhadas por 3 meses", meses.size >= 3, [...meses].sort().join(", "));
checar("avaliacoes >= 120", avaliacoes.length >= 120, avaliacoes.length);

print("== Campos opcionais ==");
checar("cnh_verificada só existe em motoristas",
  usuarios.every(u => ("cnh_verificada" in u) === u.perfis.includes("motorista")));
checar("eletrico só existe em elétricos e híbridos",
  veiculos.every(v => ("eletrico" in v) === ["eletrico", "hibrido"].includes(v.combustivel)));
checar("algum passageiro usa cupom", viagens.some(v => v.passageiros.some(p => "cupom" in p)));

print("== Regras de negócio ==");
const co2Errado = viagens.filter(v => Math.abs(v.co2_economizado_kg - v.distancia_km * 0.12 * conf(v).length) > 0.011);
checar("co2 = distancia x 0,12 x confirmados", co2Errado.length === 0, co2Errado.map(v => v._id).join(","));
checar("co2 nunca negativo", viagens.every(v => v.co2_economizado_kg >= 0));
const pagoErrado = viagens.filter(v => v.passageiros.some(p =>
  (p.status === "confirmado" && p.valor_pago !== v.preco_assento) || (p.status === "cancelado" && p.valor_pago !== 0)));
checar("valor_pago = preço (confirmado) e 0 (cancelado)", pagoErrado.length === 0, pagoErrado.map(v => v._id).join(","));
const excedidas = viagens.filter(v => conf(v).length > v.vagas_ofertadas);
checar("exatamente 2 exceções propositais de lotação", excedidas.length === 2, excedidas.map(v => v._id).join(","));
const vagasDemais = viagens.filter(v => v.vagas_ofertadas > veic[v.veiculo_id].capacidade - 1);
checar("vagas_ofertadas <= capacidade - 1", vagasDemais.length === 0, vagasDemais.map(v => v._id).join(","));
checar("veículo da viagem pertence ao motorista", viagens.every(v => veic[v.veiculo_id].motorista_id === v.motorista_id));
checar("motorista nunca é passageiro da própria viagem",
  viagens.every(v => v.passageiros.every(p => p.usuario_id !== v.motorista_id)));
checar("sem passageiro repetido na mesma viagem",
  viagens.every(v => new Set(v.passageiros.map(p => p.usuario_id)).size === v.passageiros.length));
checar("viagens canceladas não têm confirmados",
  viagens.filter(v => v.status === "cancelada").every(v => conf(v).length === 0));
checar("toda viagem concluída tem ao menos 1 confirmado",
  viagens.filter(v => v.status === "concluida").every(v => conf(v).length >= 1));
const passageirosConcluidas = new Set(viagens.filter(v => v.status === "concluida")
  .flatMap(v => conf(v).map(p => p.usuario_id)));
const motoristasNaoPassageiros = motoristas.filter(m => !passageirosConcluidas.has(m._id)).map(m => m._id);
checar("todo motorista também viajou como passageiro", motoristasNaoPassageiros.length === 0, motoristasNaoPassageiros.join(","));
const cidades = ["Recife", "Olinda", "Jaboatão dos Guararapes", "Paulista", "Cabo de Santo Agostinho", "Camaragibe", "Caruaru", "Gravatá"];
checar("origens, destinos e endereços nas cidades previstas",
  viagens.every(v => cidades.includes(v.origem.cidade) && cidades.includes(v.destino.cidade)) &&
  usuarios.every(u => cidades.includes(u.endereco.cidade)));

// Agenda: a mesma pessoa (motorista ou passageiro confirmado) não pode estar
// em duas viagens não canceladas com menos de 4 h entre as saídas.
const compromissos = {};
viagens.filter(v => v.status !== "cancelada").forEach(v => {
  [v.motorista_id].concat(conf(v).map(p => p.usuario_id))
    .forEach(id => (compromissos[id] ||= []).push({ viagem: v._id, t: v.data_hora.getTime() }));
});
const conflitos = [];
Object.entries(compromissos).forEach(([id, lista]) => {
  lista.sort((a, b) => a.t - b.t);
  for (let k = 1; k < lista.length; k++) {
    if (lista[k].t - lista[k - 1].t < 4 * 3600000) conflitos.push(id + ":" + lista[k - 1].viagem + "/" + lista[k].viagem);
  }
});
checar("ninguém em duas viagens com menos de 4 h entre as saídas", conflitos.length === 0, conflitos.join(" "));

print("== Avaliações ==");
checar("só viagens concluídas têm avaliações", avaliacoes.every(a => viag[a.viagem_id] && viag[a.viagem_id].status === "concluida"));
checar("avaliador e avaliado participaram da viagem como confirmados", avaliacoes.every(a => {
  const v = viag[a.viagem_id];
  const ids = conf(v).map(p => p.usuario_id);
  return a.papel_avaliado === "motorista"
    ? a.avaliado_id === v.motorista_id && ids.includes(a.avaliador_id)
    : a.avaliador_id === v.motorista_id && ids.includes(a.avaliado_id);
}));
checar("notas entre 1 e 5", avaliacoes.every(a => Number.isInteger(a.nota) && a.nota >= 1 && a.nota <= 5));
const altas = avaliacoes.filter(a => a.nota >= 3).length;
checar("notas concentradas entre 3 e 5 (>= 80%)", altas / avaliacoes.length >= 0.8, altas + "/" + avaliacoes.length);
const negativas = /atras|perigos|sujo|grosseir|desrespeit|não apareceu|sujeira|velocidade|imbecil|sem ar/i;
const baixas = avaliacoes.filter(a => a.nota <= 2);
checar("existem notas 1 e 2", baixas.some(a => a.nota === 1) && baixas.some(a => a.nota === 2), baixas.length + " notas baixas");
checar("notas 1 e 2 têm comentário negativo", baixas.every(a => negativas.test(a.comentario)));
checar("data da avaliação é posterior à viagem", avaliacoes.every(a => a.data > viag[a.viagem_id].data_hora));
const DATA_REFERENCIA = ISODate("2026-11-21T03:00:00Z"); // mesma de scripts/_helpers.js
checar("nenhuma avaliação depois da data de referência", avaliacoes.every(a => a.data < DATA_REFERENCIA));
const verde = id => ["eletrico", "hibrido"].includes(veic[viag[id].veiculo_id].combustivel);
checar("comentário sobre carro elétrico ou híbrido só em viagem com veículo verde",
  avaliacoes.filter(a => /elétrico|híbrido/i.test(a.comentario)).every(a => verde(a.viagem_id)));
// Os nomes alternam feminino (número do _id ímpar) e masculino (par).
const feminino = id => parseInt(id.slice(1), 10) % 2 === 1;
const formasF = /\b(Passageira|educada|atenciosa|simpática|quieta|grosseira|desrespeitosa|essa|dela)\b/i;
const formasM = /\b(Passageiro|educado|atencioso|simpático|quieto|grosseiro|desrespeitoso|esse|dele)\b/i;
const generoErrado = avaliacoes.filter(a => a.comentario !== undefined &&
  ((feminino(a.avaliado_id) && formasM.test(a.comentario)) || (!feminino(a.avaliado_id) && formasF.test(a.comentario))));
const pelaBR232 = v => ["Caruaru", "Gravatá"].includes(v.origem.cidade) || ["Caruaru", "Gravatá"].includes(v.destino.cidade);
checar("comentário citando a BR-232 só em rota de ou para Caruaru e Gravatá",
  avaliacoes.filter(a => a.comentario.includes("BR-232")).every(a => pelaBR232(viag[a.viagem_id])));
checar("comentário sobre paradas só em rota com paradas",
  avaliacoes.filter(a => /paradas|parada combinada/.test(a.comentario)).every(a => viag[a.viagem_id].paradas.length > 0));
checar("concordância de gênero do comentário com a pessoa avaliada", generoErrado.length === 0, generoErrado.map(a => a._id).join(","));
const distintos = new Set(avaliacoes.map(a => a.comentario)).size;
checar("comentários variados (>= 50 textos distintos)", distintos >= 50, distintos + " distintos");
checar("sem avaliação duplicada (mesma viagem, avaliador e avaliado)",
  new Set(avaliacoes.map(a => a.viagem_id + a.avaliador_id + a.avaliado_id)).size === avaliacoes.length);

print("");
print("Verificações: " + verificacoes + ", falhas: " + falhas.length);
if (falhas.length > 0) {
  print("Falharam: " + falhas.join("; "));
  quit(1);
}
print("Todas as regras do seed foram respeitadas.");
