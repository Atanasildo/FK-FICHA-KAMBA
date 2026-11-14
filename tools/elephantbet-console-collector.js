/**
 * FK — Ficha Kamba
 * Recolhedor manual de mercados/odds da interface pública da ElephantBet.
 *
 * Como usar:
 * 1. Abre um jogo na ElephantBet e espera os mercados carregarem.
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
    .filter(el =>
      el.getAttribute("data-id") !== "-2" &&
      !/^tudo$/i.test(el.innerText.trim())
    );
  const abaOriginal = document.querySelector(".horizontal-sl-tab-bc.active");
  const categoriaOriginal = abaOriginal?.getAttribute("data-id");
  const urlPagina = location.href;
  const recolhidoEm = new Date().toISOString();
  const resultado = [];
  // A categoria "Tudo" agrega os mercados das restantes categorias e é ignorada.
  // Categorias de jogadores também ficam fora do âmbito FK.
  const CATEGORIAS_EXCLUIDAS = /jogadores|players/i;
  const MERCADOS_EXCLUIDOS = /jogadores|players/i;


  if (!abas.length) {
    console.warn("FK: não foram encontradas categorias. Abre primeiro um evento com mercados.");
    return { erro: "Categorias não encontradas", urlPagina, recolhidoEm };
  }

  console.log(`FK: a iniciar recolha de ${abas.length} categorias...`);

  for (let i = 0; i < abas.length; i++) {
    const aba = abas[i];
    const categoria = aba.innerText.trim() || "Sem categoria";
    const categoriaId = aba.getAttribute("data-id");

    if (CATEGORIAS_EXCLUIDAS.test(categoria)) {
      console.log(`[${i + 1}/${abas.length}] ${categoria} — ignorada (fora do âmbito FK)`);
      continue;
    }

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
        // O handicap de golos a 3 opções tem uma grelha própria.
        // Até existir evidência suficiente da relação linha/equipa/empate,
        // recolhemos a estrutura DOM para diagnóstico e não fazemos pares por suposição.
        const handicapGolos3Opcoes = /handicap.*golos.*3.?op[cç][aã]o/i.test(titulo);

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

          // Handicap de equipas: a interface apresenta dois cabeçalhos
          // (equipas) e depois células alternadas: handicap+odd da equipa 1,
          // handicap+odd da equipa 2. Não há .market-base neste layout.
          if (!handicapGolos3Opcoes && !bases.length && cabecalhos.length === 2 && /handicap/i.test(titulo)) {
            const celulasComOdd = celulas
              .filter(el => !el.classList.contains("m-g-header"))
              .map(el => {
                const odd = el.querySelector(".market-odd-bc")?.innerText.trim();
                const texto = el.innerText.trim();
                const linha = texto.replace(odd || "", "").trim();
                return { odd, linha };
              })
              .filter(x => x.odd && x.linha);

            for (let j = 0; j + 1 < celulasComOdd.length; j += 2) {
              const par = [celulasComOdd[j], celulasComOdd[j + 1]];
              par.forEach((item, lado) => {
                const registo = {
                  selecao: `${cabecalhos[lado]} ${item.linha}`.trim(),
                  odd: item.odd,
                  linha: item.linha,
                  coluna: cabecalhos[lado]
                };
                selecoes.push(registo);
                selecoesParciais.push(registo);
              });
            }
            // Se sobrar uma célula sem par, não a associar por suposição.
            if (celulasComOdd.length % 2) {
              oddsSemNome.push(celulasComOdd[celulasComOdd.length - 1].odd);
            }
          } else if (bases.length) {
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

        // Fallback para mercados em que a casa apresenta cada opção
        // como duas linhas consecutivas (nome da selecção + odd), por exemplo
        // minutos, combos e mercados de jogadores. Não inferir se a sequência
        // não formar pares exactos nem se a contagem divergir das odds do DOM.
        if (selecoes.length === 0 && odds.length > 0 && !handicapGolos3Opcoes) {
          const linhas = grupo.innerText
            .split(/\r?\n/)
            .map(linha => linha.trim())
            .filter(linha => linha && !/^NOVO$/i.test(linha));

          const tituloBase = titulo.split(/\r?\n/)[0].trim().toLocaleLowerCase();
          while (linhas.length && (
            linhas[0].toLocaleLowerCase() === titulo.toLocaleLowerCase() ||
            linhas[0].toLocaleLowerCase() === tituloBase
          )) {
            linhas.shift();
          }

          const paresValidos = linhas.length > 0 && linhas.length % 2 === 0;
          const pares = [];
          if (paresValidos) {
            for (let j = 0; j < linhas.length; j += 2) {
              const label = linhas[j];
              const odd = linhas[j + 1];
              const oddValida = /^\d+(?:[.,]\d+)?$/.test(odd) &&
                Number(odd.replace(",", ".")) > 1;
              // Rótulos numéricos de intervalo (ex.: 0, 1-2, 11-20) são válidos;
              // só rejeitar um rótulo que pareça, ele próprio, uma odd decimal.
              const labelValida = label && !(/^\d+(?:[.,]\d+)?$/.test(label) &&
                Number(label.replace(",", ".")) > 1);
              if (!oddValida || !labelValida) {
                pares.length = 0;
                break;
              }
              pares.push({ selecao: label, odd });
            }
          }

          if (pares.length === odds.length) {
            selecoes.push(...pares);
            selecoesParciais.push(...pares);
            oddsSemNome.length = 0;
          }
        }

        // Diagnóstico específico da grelha de handicap de golos (3 opções).
        // Guardamos textos/classes/atributos e HTML limitado para identificar
        // com precisão as colunas e linhas na próxima recolha.
        let diagnosticoEstrutura = null;
        if (handicapGolos3Opcoes) {
          selecoes.length = 0;
          selecoesParciais.length = 0;
          oddsSemNome.length = 0;
          oddsSemNome.push(...odds);
          diagnosticoEstrutura = blocos.map((bloco, blocoIndex) => ({
            bloco: blocoIndex,
            texto: bloco.innerText.trim(),
            celulas: [...bloco.children]
              .filter(el => el.matches(".sgm-market-g-i-cell-bc"))
              .map((el, celulaIndex) => ({
                indice: celulaIndex,
                classes: el.className,
                texto: el.innerText.trim(),
                atributos: [...el.attributes].reduce((acc, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                }, {}),
                classesFilhos: [...el.children].map(child => child.className),
                html: el.outerHTML.slice(0, 1800)
              }))
          }));
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
          ...(diagnosticoEstrutura ? { diagnosticoEstrutura } : {}),
          conteudo: grupo.innerText.trim()
        };
      }).filter(mercado =>
        mercado.quantidadeOdds > 0 &&
        !MERCADOS_EXCLUIDOS.test(mercado.mercado)
      );

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
    bookmaker: "ElephantBet",
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

  window.__FK_COLLECTOR_RESULT__ = pacote;
  return pacote;
})();
