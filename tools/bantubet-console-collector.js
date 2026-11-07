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

      // A interface actual usa .sgm-market-g (sem .sgm-market-info).
      // Em mercados separados, os cabeçalhos (ex.: Mais de/Menos) são
      // colunas e cada .market-base inicia uma linha com as respectivas odds.
      const grupos = [...document.querySelectorAll(".sgm-market-g")];
      const mercados = grupos.map((grupo, indice) => {
        const titulo = grupo.querySelector(".sgm-market-g-head-bc")
          ?.innerText.trim()
          || grupo.querySelector(".sgm-market-g-h-title-bc")
            ?.innerText.trim()
          || `Mercado ${indice + 1}`;

        const blocos = [...grupo.querySelectorAll(".sgm-market-g-item-bc")];
        const selecoes = [];
        const selecoesParciais = [];
        const oddsSemNome = [];
        const odds = [...grupo.querySelectorAll(".market-odd-bc")]
          .map(el => el.innerText.trim())
          .filter(Boolean);

        for (const bloco of blocos) {
          const celulas = [...bloco.children]
            .filter(el => el.matches(".sgm-market-g-i-cell-bc"));
          const cabecalhos = celulas
            .filter(el => el.classList.contains("m-g-header"))
            .map(el => el.innerText.trim())
            .filter(Boolean);
          const bases = celulas
            .map((el, pos) => ({ el, pos }))
            .filter(x => x.el.classList.contains("market-base"));

          if (bases.length) {
            bases.forEach((base, rowIndex) => {
              const proximaBase = bases[rowIndex + 1]?.pos ?? celulas.length;
              const celulasDaLinha = celulas.slice(base.pos + 1, proximaBase);
              const oddsDaLinha = celulasDaLinha
                .map(el => ({
                  valor: el.querySelector(".market-odd-bc")?.innerText.trim(),
                  celula: el
                }))
                .filter(x => x.valor);

              const linha = base.el.innerText.trim();
              if (oddsDaLinha.length === cabecalhos.length && cabecalhos.length > 0) {
                oddsDaLinha.forEach((item, j) => {
                  const selecao = `${cabecalhos[j]} ${linha}`.trim();
                  const registo = { selecao, odd: item.valor, linha, coluna: cabecalhos[j] };
                  selecoes.push(registo);
                  selecoesParciais.push(registo);
                });
              } else {
                oddsDaLinha.forEach(item => oddsSemNome.push(item.valor));
              }
            });
          } else {
            // Compatibilidade com mercados antigos, sem linhas .market-base.
            const nomes = [...bloco.querySelectorAll(".m-g-header")]
              .map(el => el.innerText.trim())
              .filter(Boolean);
            const oddsDoBloco = [...bloco.querySelectorAll(".market-odd-bc")]
              .map(el => el.innerText.trim())
              .filter(Boolean);

            if (nomes.length === oddsDoBloco.length && oddsDoBloco.length > 0) {
              oddsDoBloco.forEach((odd, j) => {
                const registo = { selecao: nomes[j], odd };
                selecoes.push(registo);
                selecoesParciais.push(registo);
              });
            } else {
              oddsDoBloco.forEach(odd => oddsSemNome.push(odd));
            }
          }
        }

        // Só declarar associação completa quando todas as odds do mercado
        // tiverem nome de selecção validamente associado.
        const associacaoCompleta = odds.length > 0 && selecoes.length === odds.length;
        return {
          mercado: titulo,
          quantidadeOdds: odds.length,
          odds,
          selecoes: associacaoCompleta ? selecoes : [],
          selecoesParciais,
          oddsSemNome,
          associacaoCompleta,
          conteudo: grupo.innerText.trim()
        };
      }).filter(mercado => mercado.quantidadeOdds > 0);

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
