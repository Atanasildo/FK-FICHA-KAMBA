import React, { useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, ChevronRight, Clock3, FileText, History, LayoutDashboard, Radio, RefreshCw, Settings, ShieldCheck, Ticket, Trophy, Download, Bell, Menu, X, BarChart3, FileJson, AlertTriangle, CheckCircle2, ArrowUpDown, ExternalLink } from 'lucide-react';
import { prepareOddsComparison } from '../lib/bookmakers/prepare-comparison.js';

const NAV = [['Bilhetes do dia', LayoutDashboard], ['Comparar Odds', BarChart3], ['Acompanhamento ao vivo', Activity], ['Histórico', History], ['Definições', Settings]];
const STORE = 'fk-ficha-kamba-v1';
const money = n => Number(n || 0).toFixed(2);
const readStore = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || { games: [], tickets: [], bookmaker: 'BantuBet Angola' }; }
  catch { return { games: [], tickets: [], bookmaker: 'BantuBet Angola' }; }
};
const isToday = value => value && new Date(value).toDateString() === new Date().toDateString();
const matchState = leg => String(leg.matchStatus || leg.status || '').toUpperCase();
const isLive = leg => ['IN_PLAY', 'LIVE', 'PAUSED', '1H', '2H', 'HT', 'FIRST_HALF', 'SECOND_HALF', 'HALF_TIME'].includes(matchState(leg)) || Boolean(leg.live);
const isFinished = leg => ['FINISHED', 'FT', 'FULL_TIME', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT', 'AET'].includes(matchState(leg));
const matchScore = leg => {
  const score = leg.score || {};
  const home = leg.homeScore ?? score.home ?? score.fullTime?.home ?? score.regularTime?.home ?? score.current?.home;
  const away = leg.awayScore ?? score.away ?? score.fullTime?.away ?? score.regularTime?.away ?? score.current?.away;
  return home !== null && home !== undefined && away !== null && away !== undefined ? `${home} : ${away}` : null;
};
const resultLabel = leg => leg.marketStatus || leg.result || (isLive(leg) ? 'Em directo' : isFinished(leg) ? 'Jogo terminado · mercado a confirmar' : 'Por iniciar');
const resultClass = leg => {
  const s = String(resultLabel(leg)).toLowerCase();
  if (s.includes('ganh') || s.includes('favor')) return 'state-good';
  if (s.includes('perd') || s.includes('risco') || s.includes('desfavor')) return 'state-bad';
  if (s.includes('direct') || s.includes('live')) return 'state-live';
  return 'state-pending';
};

export default function App() {
  const [page, setPage] = useState('Bilhetes do dia');
  const [data] = useState(readStore);
  const [expanded, setExpanded] = useState({});
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const todayTickets = useMemo(() => data.tickets.filter(t => t.origin === 'ai' && isToday(t.createdAt)), [data.tickets]);
  const liveTickets = useMemo(() => todayTickets.filter(t => t.legs?.some(isLive) || ['Em directo', 'Em acompanhamento'].includes(t.status)), [todayTickets]);
  const history = useMemo(() => data.tickets.filter(t => t.origin !== 'ai' || !isToday(t.createdAt)), [data.tickets]);
  const filteredHistory = history.filter(t => [t.id, t.name, t.bookmaker, t.bookingId].join(' ').toLowerCase().includes(query.toLowerCase()));
  const toggle = id => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const side = <><div className="brand"><div className="brand-mark">FK<span>.</span></div><div><b>FICHA KAMBA</b><small>FUTEBOL • INTELIGÊNCIA</small></div></div><div className="side-label">MENU PRINCIPAL</div><nav>{NAV.map(([label, Icon]) => <button key={label} className={page === label ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(label); setMobile(false); }}><Icon size={18}/><span>{label}</span>{label === 'Acompanhamento ao vivo' && liveTickets.length > 0 && <i className="live-dot"/>}</button>)}</nav><div className="side-bottom"><div className="side-status"><span className="status-dot"/> Consulta de fichas <small>As fichas publicadas aparecem neste painel</small></div><div className="profile"><div className="avatar">FK</div><div><b>Utilizador</b><small>Ficha Kamba</small></div></div></div></>;
  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'fk-ficha-kamba-historico.json'; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="app-shell"><aside className={mobile ? 'sidebar mobile-open' : 'sidebar'}>{side}</aside>{mobile && <button className="scrim" onClick={() => setMobile(false)} aria-label="Fechar menu"/>}
    <main className="main"><header className="topbar"><button className="icon-btn mobile-menu" onClick={() => setMobile(true)}><Menu/></button><div className="crumb">Plataforma <span>/</span> <b>{page}</b></div><div className="top-actions"><span className="date-chip"><CalendarDays size={15}/> {new Date().toLocaleDateString('pt-AO')}</span><span className="local-chip"><i/> PAINEL</span><div className="avatar small">FK</div></div></header>
      <div className="content"><div className="welcome"><div><div className="eyebrow"><span className="status-dot"/> FICHA KAMBA</div><h1>{page}</h1><p>{page === 'Bilhetes do dia' ? 'Consulta as fichas preparadas e publicadas para hoje.' : page === 'Comparar Odds' ? 'Compara as odds recolhidas na BantuBet e na ElephantBet para o mesmo jogo.' : page === 'Acompanhamento ao vivo' ? 'Acompanha os jogos e mercados das tuas fichas em curso.' : page === 'Histórico' ? 'Consulta fichas e resultados de dias anteriores.' : 'Preferências e dados da tua conta.'}</p></div></div>
        {notice && <div className="notice"><ShieldCheck size={17}/><span>{notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}
        {page === 'Bilhetes do dia' && <>
          <div className="daily-summary"><div className="daily-icon"><Ticket size={21}/></div><div><b>{todayTickets.length} {todayTickets.length === 1 ? 'ficha publicada' : 'fichas publicadas'} hoje</b><span>As fichas do dia, os IDs de reserva e todos os jogos ficam reunidos aqui.</span></div><div className="daily-date">{new Date().toLocaleDateString('pt-AO')}</div></div>
          {todayTickets.length ? <div className="daily-ticket-list">{todayTickets.map(t => <TicketPanel key={t.id} ticket={t} expanded={!!expanded[t.id]} onToggle={() => toggle(t.id)}/>)}</div> : <EmptyState icon={FileText} title="Ainda não há fichas publicadas para hoje" detail="As fichas aparecerão automaticamente aqui quando o serviço de análise e publicação da IA estiver ligado. Não são apresentados palpites ou IDs de reserva inventados."/>}
          <div className="quiet-note"><ShieldCheck size={16}/><span>Esta área é apenas de consulta. A elaboração das fichas é uma tarefa interna do sistema.</span></div>
        </>}
        {page === 'Comparar Odds' && <OddsComparePage />}
        {page === 'Acompanhamento ao vivo' && <>
          {liveTickets.length ? <div className="daily-ticket-list">{liveTickets.map(t => <TicketPanel key={t.id} ticket={t} expanded={expanded[t.id] !== false} onToggle={() => toggle(t.id)} liveView/>)}</div> : <EmptyState icon={Radio} title="Não há jogos em directo nas fichas de hoje" detail="Quando uma partida começar e o fornecedor de resultados em directo estiver ligado, o marcador, minuto e estado de cada mercado serão mostrados aqui."/>}
        </>}
        {page === 'Histórico' && <>
          <div className="toolbar"><div className="searchbox"><History size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar por ficha, ID ou casa..."/></div></div>
          {filteredHistory.length ? <div className="daily-ticket-list">{filteredHistory.map(t => <TicketPanel key={t.id} ticket={t} expanded={!!expanded[t.id]} onToggle={() => toggle(t.id)}/>)}</div> : <EmptyState icon={History} title="Ainda não há histórico" detail="As fichas concluídas serão arquivadas aqui para consulta."/>}
        </>}
        {page === 'Definições' && <section className="panel settings-panel"><div className="panel-head"><div><h3>Dados e privacidade</h3><p>Informações guardadas neste navegador.</p></div><Settings size={18}/></div><div className="setting-row"><div><b>Exportar histórico local</b><small>Descarrega uma cópia dos registos existentes neste navegador.</small></div><button className="secondary-btn" onClick={exportBackup}><Download size={15}/> Exportar</button></div><div className="setting-row"><div><b>Notificações de jogos</b><small>As notificações automáticas serão activadas quando o serviço em directo estiver configurado.</small></div><span className="status-text">A aguardar integração</span></div><div className="setting-row"><div><b>Conta e sincronização</b><small>A sincronização entre dispositivos ainda não está disponível nesta versão.</small></div><span className="status-text">Não ligado</span></div></section>}
        <footer><span>FK — Ficha Kamba</span><span>Dados de jogos e resultados dependem de fontes desportivas autorizadas.</span></footer>
      </div>
    </main>
  </div>;
}

function TicketPanel({ ticket: t, expanded, onToggle, liveView = false }) {
  const legs = t.legs || [];
  const liveCount = legs.filter(isLive).length;
  return <section className="panel daily-ticket">
    <button className="ticket-expand" onClick={onToggle} aria-expanded={expanded}>
      <div className="ticket-expand-main"><div className="ticket-title-row"><span className={Number(t.totalOdds) >= 100 ? 'tag tag-gold' : 'tag'}>{t.type || 'FICHA DO DIA'}</span><span className={'ticket-status ' + (liveCount ? 'state-live' : 'state-pending')}>{liveCount ? liveCount + ' jogo(s) em directo' : t.status || 'Publicada'}</span></div><h3>{t.name || 'Ficha Kamba'}</h3><div className="ticket-subline"><span>{t.id}</span><span>{t.bookmaker || 'Casa de apostas não indicada'}</span><span>{legs.length} jogos</span></div></div>
      <div className="ticket-quick"><small>ODD TOTAL</small><b>{money(t.totalOdds)}</b><span className="reserve-id">Reserva: {t.bookingId || 'A aguardar ID'}</span></div><span className="expand-icon">{expanded ? <ChevronDown/> : <ChevronRight/>}</span>
    </button>
    {expanded && <div className="ticket-details"><div className="details-heading"><b>Jogos e mercados desta ficha</b><span>{liveView ? 'Estado em directo quando disponível' : 'Todas as selecções'}</span></div>
      {legs.length ? legs.map((leg, i) => <article className="match-detail" key={leg.id || i}><div className="match-detail-top"><span className="match-number">JOGO {String(i + 1).padStart(2, '0')}</span><span className={resultClass(leg)}>{resultLabel(leg)}</span></div><div className="match-teams"><b>{leg.home || leg.homeTeam || 'Equipa da casa'} <span>vs</span> {leg.away || leg.awayTeam || 'Equipa visitante'}</b><small>{leg.league || leg.competition || 'Campeonato não indicado'}{leg.date ? ' · ' + new Date(leg.date).toLocaleString('pt-AO') : ''}</small></div>
        <div className="market-detail-grid"><div><small>MERCADO</small><b>{leg.market || 'Mercado'}</b></div><div><small>SELECÇÃO</small><b>{leg.selection || '—'}</b></div><div><small>ODD</small><b>{money(leg.odd)}</b></div></div>
        {(isLive(leg) || isFinished(leg) || matchScore(leg)) && <div className={isLive(leg) ? 'live-score-strip' : 'final-score-strip'}><Radio size={15}/><b>{matchScore(leg) || '— : —'}</b><span>{isLive(leg) ? (leg.minute ? leg.minute + "'" : leg.matchStatus || 'Em directo') : isFinished(leg) ? 'RESULTADO FINAL' : (leg.matchStatus || 'Resultado disponível')}</span>{leg.lastEvent && isLive(leg) && <small>{leg.lastEvent}</small>}</div>}
        {leg.marketUpdate && <p className="market-update">{leg.marketUpdate}</p>}
      </article>) : <p className="muted-copy">Os jogos desta ficha serão apresentados aqui quando forem publicados.</p>}
      <div className="ticket-detail-footer"><span>IDENTIFICADOR DE RESERVA</span><b>{t.bookingId || 'Ainda não disponibilizado'}</b></div>
    </div>}
  </section>;
}

function EmptyState({ icon: Icon, title, detail }) { return <div className="empty-state"><div className="empty-state-icon"><Icon size={23}/></div><b>{title}</b><span>{detail}</span></div>; }


function OddsComparePage() {
  const [files, setFiles] = useState({ bantubet: null, elephantbet: null });
  const [event, setEvent] = useState({ home: '', away: '', competition: '', kickoff: '' });
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const updateEvent = (key, value) => {
    setEvent(current => ({ ...current, [key]: value }));
    setPrepared(null);
  };

  const loadFile = async (provider, file) => {
    if (!file) return;
    setError('');
    setPrepared(null);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('O ficheiro excede o limite de 12 MB.');
      const parsed = JSON.parse(await file.text());
      const payload = parsed?.payload && typeof parsed.payload === 'object' ? { ...parsed, ...parsed.payload, payload: undefined } : parsed;
      const hasCategories = Array.isArray(payload) || Array.isArray(payload?.categorias) || Array.isArray(payload?.categories);
      if (!hasCategories) throw new Error('Este JSON não contém categorias de mercados reconhecíveis.');
      const declared = String(payload?.bookmaker || '').toLowerCase();
      if (declared && provider === 'bantubet' && !declared.includes('bantu')) throw new Error('Este ficheiro não parece ser da BantuBet.');
      if (declared && provider === 'elephantbet' && !declared.includes('elephant')) throw new Error('Este ficheiro não parece ser da ElephantBet.');
      setFiles(current => ({ ...current, [provider]: { name: file.name, payload } }));
    } catch (e) {
      setFiles(current => ({ ...current, [provider]: null }));
      setError(e.message || 'Não foi possível ler este ficheiro JSON.');
    }
  };

  const runComparison = () => {
    setBusy(true);
    setError('');
    try {
      const output = prepareOddsComparison({
        bantubet: files.bantubet?.payload,
        elephantbet: files.elephantbet?.payload,
        event
      });
      setPrepared(output);
    } catch (e) {
      setPrepared(null);
      setError(e.message || 'Não foi possível comparar as recolhas.');
    } finally {
      setBusy(false);
    }
  };

  const allComparisons = prepared?.result?.events?.flatMap(group =>
    group.comparisons.map(item => ({ ...item, event: group.event }))
  ) || [];
  const visibleComparisons = allComparisons.filter(item =>
    [item.market, item.selection, item.period, ...item.quotes.map(q => q.bookmaker)]
      .join(' ').toLowerCase().includes(filter.toLowerCase())
  );

  const exportCsv = () => {
    if (!prepared) return;
    const rows = [['Jogo', 'Competição', 'Mercado', 'Selecção', 'Período', 'Linha', 'Casa', 'Odd', 'Melhor casa', 'Melhor odd', 'Recolhido em', 'Fonte']];
    for (const group of prepared.result.events || []) {
      for (const item of group.comparisons) {
        for (const quote of item.quotes) rows.push([
          group.event.home + ' vs ' + group.event.away, group.event.competition || '',
          item.market, item.selection, item.period, item.line || '', quote.bookmaker,
          quote.odds, item.bestBookmaker, item.bestOdds, quote.collectedAt || '', quote.sourceUrl || ''
        ]);
      }
    }
    const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'fk-comparacao-odds.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    setFiles({ bantubet: null, elephantbet: null });
    setPrepared(null);
    setError('');
    setFilter('');
  };

  return <div className="odds-workspace">
    <div className="odds-intro panel">
      <div className="odds-intro-icon"><BarChart3 size={22}/></div>
      <div><b>Comparador de odds FK</b><p>Importa as duas recolhas JSON do mesmo jogo. O FK associa apenas mercados e selecções equivalentes e apresenta a melhor odd observada.</p></div>
      <span className="odds-local-tag"><ShieldCheck size={13}/> PROCESSAMENTO LOCAL</span>
    </div>

    <section className="panel odds-step">
      <div className="odds-section-title"><span>01</span><div><h3>Identificação do jogo</h3><p>Preenche os nomes como aparecem nas duas casas de apostas.</p></div></div>
      <div className="odds-event-grid">
        <label className="field">Equipa da casa *<input value={event.home} onChange={e => updateEvent('home', e.target.value)} placeholder="Ex.: Twente"/></label>
        <label className="field">Equipa visitante *<input value={event.away} onChange={e => updateEvent('away', e.target.value)} placeholder="Ex.: Ajax Amsterdam"/></label>
        <label className="field">Competição (opcional)<input value={event.competition} onChange={e => updateEvent('competition', e.target.value)} placeholder="Ex.: Eredivisie"/></label>
        <label className="field">Data/hora do jogo (opcional)<input type="datetime-local" value={event.kickoff} onChange={e => updateEvent('kickoff', e.target.value)}/></label>
      </div>
    </section>

    <section className="panel odds-step">
      <div className="odds-section-title"><span>02</span><div><h3>Importar recolhas</h3><p>Selecciona os ficheiros JSON gerados pelos recolhedores. Máximo de 12 MB por ficheiro.</p></div></div>
      <div className="odds-upload-grid">
        <label className="odds-upload-card">
          <input type="file" accept=".json,application/json" onChange={e => loadFile('bantubet', e.target.files?.[0])}/>
          <div className="odds-upload-icon"><FileJson size={22}/></div>
          <b>BantuBet</b><span>Seleccionar recolha.json</span>
          {files.bantubet ? <small className="upload-success"><CheckCircle2 size={13}/>{files.bantubet.name}</small> : <small>Ficheiro JSON</small>}
        </label>
        <label className="odds-upload-card elephant">
          <input type="file" accept=".json,application/json" onChange={e => loadFile('elephantbet', e.target.files?.[0])}/>
          <div className="odds-upload-icon"><FileJson size={22}/></div>
          <b>ElephantBet</b><span>Seleccionar recolha.json</span>
          {files.elephantbet ? <small className="upload-success"><CheckCircle2 size={13}/>{files.elephantbet.name}</small> : <small>Ficheiro JSON</small>}
        </label>
      </div>
      <div className="odds-actions">
        <button className="primary-btn" onClick={runComparison} disabled={!files.bantubet || !files.elephantbet || !event.home.trim() || !event.away.trim() || busy}><ArrowUpDown size={16}/>{busy ? 'A comparar...' : 'Comparar odds'}</button>
        <button className="secondary-btn" onClick={clearAll}><RefreshCw size={15}/> Limpar</button>
      </div>
      {error && <div className="odds-error"><AlertTriangle size={16}/>{error}</div>}
    </section>

    {prepared && <>
      <section className="odds-stats">
        <div><small>COMPARAÇÕES</small><b>{prepared.result.comparisonCount}</b><span>selecções com odds nas duas casas</span></div>
        <div><small>BANTUBET</small><b>{prepared.diagnostics[0].selectionCount}</b><span>selecções válidas · {prepared.diagnostics[0].excludedMarketCount} mercados excluídos</span></div>
        <div><small>ELEPHANTBET</small><b>{prepared.diagnostics[1].selectionCount}</b><span>selecções válidas · {prepared.diagnostics[1].excludedMarketCount} mercados excluídos</span></div>
      </section>
      <div className="odds-result-heading"><div><div className="eyebrow"><span className="status-dot"/> RESULTADO DA ANÁLISE</div><h2>{event.home} <span>vs</span> {event.away}</h2><p>{event.competition || 'Competição não indicada'} · {prepared.result.note}</p></div><button className="secondary-btn" onClick={exportCsv} disabled={!allComparisons.length}><Download size={15}/> Exportar CSV</button></div>
      {!allComparisons.length ? <div className="empty-state"><div className="empty-state-icon"><BarChart3 size={22}/></div><b>Não foram encontradas selecções comparáveis</b><span>Confirma se os dois ficheiros correspondem ao mesmo jogo e se têm mercados equivalentes. O sistema não compara mercados apenas parecidos.</span></div> : <>
        <div className="toolbar odds-filter"><div className="searchbox"><BarChart3 size={16}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar por mercado, selecção ou casa..."/></div><span>{visibleComparisons.length} de {allComparisons.length} resultados</span></div>
        <div className="odds-results-list">{visibleComparisons.map((item, index) => <article className="odds-result-card" key={item.market + item.selection + item.period + index}>
          <div className="odds-result-top"><div><span className="odds-market-label">{item.market}</span><h3>{item.selection}</h3><small>{item.period === 'FT' ? 'Jogo completo' : item.period === '1H' ? '1.ª parte' : '2.ª parte'}{item.line ? ' · Linha ' + item.line : ''}</small></div><div className="best-odd"><small>MELHOR ODD</small><b>{Number(item.bestOdds).toFixed(2)}</b><span>{item.bestBookmaker}</span></div></div>
          <div className="odds-quotes">{item.quotes.map(quote => <div className={quote.bookmaker === item.bestBookmaker && quote.odds === item.bestOdds ? 'odds-quote best' : 'odds-quote'} key={quote.bookmaker}><span>{quote.bookmaker}</span><b>{Number(quote.odds).toFixed(2)}</b>{quote.bookmaker === item.bestBookmaker && quote.odds === item.bestOdds && <em>Melhor</em>}{quote.sourceUrl && <a href={quote.sourceUrl} target="_blank" rel="noreferrer" title="Abrir fonte"><ExternalLink size={12}/></a>}</div>)}</div>
        </article>)}</div>
      </>}
      <section className="panel odds-diagnostics">
        <div className="panel-head"><div><h3>Qualidade das recolhas</h3><p>Mercados que não entraram na comparação por falta de associação segura.</p></div><AlertTriangle size={18}/></div>
        {prepared.diagnostics.map(d => <div className="diagnostic-provider" key={d.bookmaker}><b>{d.bookmaker}</b><span>{d.categoriesRead} categorias · {d.rawMarketCount} mercados detectados · {d.usableMarketCount} utilizáveis · {d.excludedMarketCount} excluídos</span>{d.excludedMarkets.length > 0 && <ul>{d.excludedMarkets.map((m, i) => <li key={m.market + i}>{m.market}: {m.warning}</li>)}</ul>}</div>)}
        <p className="odds-safety-note"><ShieldCheck size={14}/> A melhor odd é apenas a maior cotação encontrada nos ficheiros importados. Não é arbitragem, não garante disponibilidade actual e não constitui recomendação de aposta.</p>
      </section>
    </>}
  </div>;
}
