// =============================================================================
// _helpers.js: funções de apoio carregadas por todos os scripts com load().
// Não cobre itens da checklist; só padroniza a saída e garante que nenhuma
// consulta volte vazia sem que a execução falhe.
// =============================================================================

// Banco do projeto. O mongosh não aceita o helper "use" em arquivos
// executados com --file, então os scripts usam getSiblingDB, que faz o mesmo:
// devolve o objeto do banco pelo nome e o atribui à variável global db.
const NOME_BANCO = "caronas_sustentaveis";

// Data de corte fixa usada como "hoje" nas operações que dependem do tempo
// (U02, U06): 21/11/2026 à meia-noite no horário de Recife (03:00 em UTC).
// Usar new Date() faria a saída mudar a cada dia de execução.
const DATA_REFERENCIA = ISODate("2026-11-21T03:00:00Z");

// Imprime o cabeçalho padronizado de cada consulta ou operação. "itens" lista
// só itens da checklist oficial; "outros" (opcional) lista recursos usados que
// não são itens dela.
function titulo(id, pergunta, itens, outros) {
  print("");
  print("=".repeat(78));
  print(id + " | " + pergunta);
  print("Itens da checklist: " + (itens.length ? itens.join(", ") : "nenhum (operação de apoio)"));
  if (outros && outros.length) print("Outros recursos: " + outros.join(", "));
  print("=".repeat(78));
}

// Converte cursor ou documento único em array, sem alterar arrays.
function _paraArray(resultado) {
  if (resultado === null || resultado === undefined) return [];
  if (Array.isArray(resultado)) return resultado;
  if (typeof resultado.toArray === "function") return resultado.toArray();
  return [resultado];
}

// Imprime até "limite" documentos e, no fim, o total retornado.
// print() usa o formato compacto do mongosh (subdocumentos curtos numa linha),
// mais fácil de ler do que o printjson expandido.
// Devolve o array, para o chamador poder reaproveitar o resultado.
function mostrar(resultado, limite) {
  const docs = _paraArray(resultado);
  const max = limite === undefined ? docs.length : limite;
  docs.slice(0, max).forEach(d => print(d));
  if (docs.length > max) {
    print("... (" + (docs.length - max) + " documento(s) omitido(s) na listagem)");
  }
  print("Total retornado: " + docs.length);
  return docs;
}

// Lança erro se o resultado vier vazio (array vazio, null, 0 ou cursor sem
// documentos). Como os scripts rodam com set -e no run_all.sh, a execução
// inteira para e o problema aparece na hora.
function exigirNaoVazio(id, resultado) {
  let vazio;
  if (typeof resultado === "number") vazio = resultado <= 0;
  else vazio = _paraArray(resultado).length === 0;
  if (vazio) {
    throw new Error("[" + id + "] a consulta retornou vazio. Corrija o seed ou a consulta.");
  }
  return resultado;
}

// Lança erro se uma condição esperada não for verdadeira.
function exigir(id, condicao, mensagem) {
  if (!condicao) throw new Error("[" + id + "] " + mensagem);
}
