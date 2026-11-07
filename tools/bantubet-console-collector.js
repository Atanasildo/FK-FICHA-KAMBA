/**
 * FK — Ficha Kamba
 * Recolhedor manual de mercados/odds da interface pública da BantuBet.
 *
 * Como usar:
 * 1. Abre um jogo na BantuBet e espera os mercados carregarem.
 * 2. Abre DevTools > Console.
 * 3. Cola este ficheiro completo e executa.
 * 4. O JSON é copiado para a área de transferência.
 *
 * Nota: executa apenas uma recolha de leitura da página já aberta.
 * Não faz apostas, não contorna autenticação/CAPTCHA nem envia dados para terceiros.
 */
(async () => {
  const ESPERA = 1500;
  const aguardar = ms => new Promise(resolve => setTimeout(resolve, ms));
  const abas = [...document.querySelectorAll(".horizontal-sl-tab-bc")]
    .filter(el => el.getAttribute("data-id") !== "-2");
  const abaOriginal = document.querySelector(".horizontal-sl-tab-bc.active");
  const categoriaOriginal = abaOriginal?.getAttribute("data-id");
  const urlPagina = location.href;
  const recolhidoEm = new Date().toISOString();
  const resultado = [];

  if (!abas.length) {
    console.warn("FK: não foram encontradas categorias. Abre primeiro um evento com mercados.");
    return { erro: "Categorias não encontradas", urlPagina, recolhidoEm };
  }

  console.log(`FK: a iniciar recolha de ${abas.length} categorias...`);

  for (let i = 0; i < abas.length; i++) {
    const aba = abas[i];
    const categoria = aba.innerText.trim() || "Sem categoria";
    const categoriaId = aba.getAttribute("data-id");

    console.log(`[${i + 1}/${abas.length}] ${categoria}`);

    try {
      aba.click();
      await aguardar(ESPERA);

      // Selecciona os grupos de mercado da categoria actualmente aberta.
      const grupos = [...document.querySelectorAll(".sgm-market-g.sgm-market-info")];
      const mercados = grupos.map((grupo, indice) => {
        const titulo = grupo.querySelector(".sgm-market-g-h-title-bc")
          ?.innerText.trim()
          || grupo.innerText.trim().split("\n").find(Boolean)
          || `Mercado ${indice + 1}`;

        const blocos = [...grupo.querySelectorAll(".sgm-market-g-item-bc")];
        const selecoes = [];
        const oddsSemNome = [];

        for (const bloco of blocos) {
          const nomes = [...bloco.querySelectorAll(".m-g-header")]
            .map(el => el.innerText.trim())
            .filter(Boolean);
          const odds = [...bloco.querySelectorAll(".market-odd-bc")]
            .map(el => el.innerText.trim())
            .filter(Boolean);

          if (nomes.length === odds.length && odds.length > 0) {
            odds.forEach((odd, j) => selecoes.push({
              selecao: nomes[j],
              odd
            }));
          } else {
            // Mantém os valores brutos, mas não inventa a associação nome/odd.
            odds.forEach(odd => oddsSemNome.push(odd));
          }
        }

        const conteudo = grupo.innerText.trim();
        const quantidadeOdds = [...grupo.querySelectorAll(".market-odd-bc")].length;

        return {
          mercado: titulo,
          quantidadeOdds,
          odds: [...grupo.querySelectorAll(".market-odd-bc")]
            .map(el => el.innerText.trim()),
          selecoes: selecoes.length === quantidadeOdds && quantidadeOdds > 0 ? selecoes : [],
          selecoesParciais: selecoes,
          oddsSemNome,
          associacaoCompleta: selecoes.length === quantidadeOdds && quantidadeOdds > 0,
          conteudo
        };
      });

      resultado.push({
        categoria,
        categoriaId,
        quantidadeMercados: mercados.length,
        mercados
      });

      console.log(`   ${mercados.length} mercados; ${mercados.reduce((n, m) => n + m.quantidadeOdds, 0)} odds`);
    } catch (erro) {
      resultado.push({
        categoria,
        categoriaId,
        erro: String(erro),
        quantidadeMercados: 0,
        mercados: []
      });
      console.error(`FK: erro na categoria ${categoria}`, erro);
    }
  }

  // Regressa à categoria seleccionada antes da recolha.
  if (categoriaOriginal !== undefined && categoriaOriginal !== null) {
    document.querySelector(
      `.horizontal-sl-tab-bc[data-id="${CSS.escape(categoriaOriginal)}"]`
    )?.click();
    await aguardar(ESPERA);
  }

  const totalMercados = resultado.reduce((n, item) => n + (item.quantidadeMercados || 0), 0);
  const totalOdds = resultado.reduce((n, item) =>
    n + (item.mercados || []).reduce((sum, mercado) => sum + mercado.quantidadeOdds, 0), 0);
  const totalAssociacoes = resultado.reduce((n, item) =>
    n + (item.mercados || []).filter(mercado => mercado.associacaoCompleta).length, 0);

  const pacote = {
    bookmaker: "BantuBet",
    urlPagina,
    recolhidoEm,
    categoriasLidas: resultado.length,
    totalMercados,
    totalOdds,
    mercadosComAssociacaoCompleta: totalAssociacoes,
    categorias: resultado
  };

  console.log("========== FK: RECOLHA CONCLUÍDA ==========");
  console.log({
    categorias: pacote.categoriasLidas,
    mercados: totalMercados,
    odds: totalOdds,
    mercadosComAssociacaoCompleta: totalAssociacoes
  });
  console.log("Pacote completo:", pacote);

  const json = JSON.stringify(pacote, null, 2);
  if (typeof copy === "function") {
    copy(json);
    console.log("FK: JSON copiado para a área de transferência.");
  } else {
    console.warn("A função copy() não está disponível. Copia o JSON apresentado acima.");
  }

  return pacote;
})();
