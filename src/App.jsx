import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, ChevronRight, Clock3, FileText, History, LayoutDashboard, Radio, RefreshCw, Settings, ShieldCheck, Ticket, Trophy, Download, Bell, Menu, X, BarChart3, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from './lib/supabase.js';

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
  const [data, setData] = useState(readStore);
  const [expanded, setExpanded] = useState({});
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextResult, setContextResult] = useState(null);
  const [contextAuditBusy, setContextAuditBusy] = useState(false);
  const [contextAuditResult, setContextAuditResult] = useState(null);

  // Sincroniza as fichas publicadas no Supabase; mantém o histórico local como fallback.
  useEffect(() => {
    let active = true;
    async function loadPublishedTickets() {
      if (!supabase) return;
      const { data: rows, error } = await supabase
        .from('tickets')
        .select('id,title,status,total_odds,booking_reference,published_at,created_at,ticket_legs(id,market_name,selection,odd,result,matches(home_team,away_team,competition,kickoff_at,status))')
        .eq('status', 'published')
        .order('published_at', { ascending: false });
      if (!active) return;
      if (error) {
        setNotice('Não foi possível sincronizar as fichas publicadas: ' + error.message);
        return;
      }
      const remoteTickets = (rows || []).map(ticket => ({
        id: ticket.id,
        name: ticket.title,
        origin: 'ai',
        status: 'Publicada',
        totalOdds: ticket.total_odds,
        bookingId: ticket.booking_reference,
        createdAt: ticket.published_at || ticket.created_at,
        legs: (ticket.ticket_legs || []).map(leg => {
          const match = leg.matches || {};
          return {
            id: leg.id,
            home: match.home_team,
            away: match.away_team,
            league: match.competition,
            date: match.kickoff_at,
            matchStatus: match.status,
            market: leg.market_name,
            selection: leg.selection,
            odd: leg.odd,
            marketStatus: leg.result
          };
        })
      }));
      setData(current => ({
        ...current,
        tickets: [
          ...remoteTickets,
          ...(current.tickets || []).filter(local => !remoteTickets.some(remote => remote.id === local.id))
        ]
      }));
    }
    loadPublishedTickets();
    return () => { active = false; };
  }, []);
  const todayTickets = useMemo(() => data.tickets.filter(t => t.origin === 'ai' && isToday(t.createdAt)), [data.tickets]);
  const liveTickets = useMemo(() => todayTickets.filter(t => t.legs?.some(isLive) || ['Em directo', 'Em acompanhamento'].includes(t.status)), [todayTickets]);
  const history = useMemo(() => data.tickets.filter(t => t.origin !== 'ai' || !isToday(t.createdAt)), [data.tickets]);
  const filteredHistory = history.filter(t => [t.id, t.name, t.bookmaker, t.bookingId].join(' ').toLowerCase().includes(query.toLowerCase()));
  const toggle = id => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const side = <><div className="brand"><div className="brand-mark">FK<span>.</span></div><div><b>FICHA KAMBA</b><small>FUTEBOL • INTELIGÊNCIA</small></div></div><div className="side-label">MENU PRINCIPAL</div><nav>{NAV.map(([label, Icon]) => <button key={label} className={page === label ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(label); setMobile(false); }}><Icon size={18}/><span>{label}</span>{label === 'Acompanhamento ao vivo' && liveTickets.length > 0 && <i className="live-dot"/>}</button>)}</nav><div className="side-bottom"><div className="side-status"><span className="status-dot"/> Consulta de fichas <small>As fichas publicadas aparecem neste painel</small></div><div className="profile"><div className="avatar">FK</div><div><b>Utilizador</b><small>Ficha Kamba</small></div></div></div></>;
  const runDiscoveryTest = async () => {
    setDiscoveryBusy(true);
    setDiscoveryResult(null);
    try {
      const response = await fetch('/api/test-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 2 })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setDiscoveryResult(result);
    } catch (error) {
      setDiscoveryResult({ error: error.message });
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const runMatchValidation = async () => {
    setValidationBusy(true);
    setValidationResult(null);
    try {
      const response = await fetch('/api/test-match-validation');
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setValidationResult(result);
    } catch (error) {
      setValidationResult({ error: error.message });
    } finally {
      setValidationBusy(false);
    }
  };

  const runContextCollection = async () => {
    setContextBusy(true);
    setContextResult(null);
    try {
      const response = await fetch('/api/test-discovery?action=context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || ('HTTP ' + response.status));
      setContextResult(result);
    } catch (error) {
      setContextResult({ error: error.message });
    } finally {
      setContextBusy(false);
    }
  };

  const runContextAudit = async () => {
    setContextAuditBusy(true);
    setContextAuditResult(null);
    try {
      const response = await fetch('/api/test-discovery?action=context-audit');
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || ('HTTP ' + response.status));
      setContextAuditResult(result);
    } catch (error) {
      setContextAuditResult({ error: error.message });
    } finally {
      setContextAuditBusy(false);
    }
  };

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
        {page === 'Definições' && <section className="panel settings-panel"><div className="panel-head"><div><h3>Dados e privacidade</h3><p>Informações guardadas neste navegador.</p></div><Settings size={18}/></div><div className="setting-row"><div><b>Exportar histórico local</b><small>Descarrega uma cópia dos registos existentes neste navegador.</small></div><button className="secondary-btn" onClick={exportBackup}><Download size={15}/> Exportar</button></div><div className="setting-row"><div><b>Notificações de jogos</b><small>As notificações automáticas serão activadas quando o serviço em directo estiver configurado.</small></div><span className="status-text">A aguardar integração</span></div><div className="setting-row"><div><b>Conta e sincronização</b><small>A sincronização entre dispositivos ainda não está disponível nesta versão.</small></div><span className="status-text">Não ligado</span></div><div className="setting-row"><div><b>Teste técnico — descoberta de jogos</b><small>Consulta os próximos 2 dias na SportAPI e grava os jogos encontrados. Disponível apenas neste Preview; não recolhe odds nem gera fichas.</small></div><button className="secondary-btn" onClick={runDiscoveryTest} disabled={discoveryBusy}>{discoveryBusy ? 'A consultar…' : 'Testar descoberta'}</button></div>{discoveryResult && <div className="notice"><ShieldCheck size={17}/><span>{discoveryResult.error ? 'Falha: ' + discoveryResult.error : 'Concluído — ' + discoveryResult.fixturesDiscovered + ' jogos encontrados e ' + discoveryResult.fixturesSaved + ' gravados. Datas: ' + (discoveryResult.dates || []).join(', ')}</span><button onClick={() => setDiscoveryResult(null)}><X size={15}/></button></div>}<div className="setting-row"><div><b>Validar jogos no Supabase</b><small>Confere a quantidade, campos essenciais, duplicados e registos de estatísticas/análises. Apenas leitura.</small></div><button className="secondary-btn" onClick={runMatchValidation} disabled={validationBusy}>{validationBusy ? 'A validar…' : 'Validar jogos'}</button></div>{validationResult && <div className="notice"><ShieldCheck size={17}/><span>{validationResult.error ? 'Falha: ' + validationResult.error : 'Supabase: ' + validationResult.matchesCount + ' jogos; ' + validationResult.completeMatches + ' completos; ' + validationResult.duplicateExternalIds + ' IDs duplicados; ' + validationResult.statisticsCount + ' registos estatísticos; ' + validationResult.analysesCount + ' análises.'}</span><button onClick={() => setValidationResult(null)}><X size={15}/></button></div>}<div className="setting-row"><div><b>Recolher contexto desportivo</b><small>Recolhe até cinco jogos futuros que ainda não tenham contexto guardado. Evita repetir jogos entre lotes; guarda no Supabase e não executa a Groq nem cria boletins.</small></div><button className="secondary-btn" onClick={runContextCollection} disabled={contextBusy}>{contextBusy ? 'A recolher…' : 'Recolher próximo lote (5)'}</button></div>{contextResult && <div className="notice"><ShieldCheck size={17}/><span>{contextResult.error ? 'Falha: ' + contextResult.error : 'Concluído — ' + contextResult.saved + ' de ' + contextResult.processed + ' jogos com contexto guardado.'}</span><button onClick={() => setContextResult(null)}><X size={15}/></button></div>}<div className="setting-row"><div><b>Auditar qualidade do contexto</b><small>Verifica os cinco registos mais recentes e conta conteúdo real por secção. Apenas leitura; não consulta a SportAPI nem altera dados.</small></div><button className="secondary-btn" onClick={runContextAudit} disabled={contextAuditBusy}>{contextAuditBusy ? 'A auditar…' : 'Auditar contexto (5)'}</button></div>{contextAuditResult && <div className="notice"><ShieldCheck size={17}/><span>{contextAuditResult.error ? 'Falha: ' + contextAuditResult.error : 'Auditoria: ' + contextAuditResult.audited + ' registos; ' + contextAuditResult.usefulRecords + ' com pelo menos uma secção preenchida; ' + contextAuditResult.emptyRecords + ' sem conteúdo útil.'}</span><button onClick={() => setContextAuditResult(null)}><X size={15}/></button></div>}{contextAuditResult?.results?.map(row => <div className="setting-row" key={row.fixtureId || row.collectedAt}><div><b>{row.home || 'Jogo'} vs {row.away || '—'}</b><small>{row.competition || 'Competição não indicada'} · Transporte {row.transportAvailable}/{row.transportSections} · Conteúdo {row.usefulSections}/{row.contentSections} · Classificação {row.sections.standings.status} · H2H {row.sections.headToHead.count} · Forma {row.sections.homeRecent.count}/{row.sections.awayRecent.count} · Eventos {row.sections.events.count} · Erros {row.sourceErrors}</small></div><span className="status-text">{row.usefulSections ? 'Conteúdo encontrado' : 'Sem conteúdo útil'}</span></div>)}</section>}
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
  const [savedRows, setSavedRows] = useState([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [filter, setFilter] = useState('');

  const loadSavedComparisons = async () => {
    if (!supabase) {
      setHistoryError('A ligação à Supabase não está configurada.');
      return;
    }
    setHistoryBusy(true);
    setHistoryError('');
    const { data, error } = await supabase
      .from('odds_comparisons')
      .select('id,comparison,created_at,matches(home_team,away_team,competition,kickoff_at)')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      setHistoryError('Não foi possível carregar as comparações: ' + error.message);
      setSavedRows([]);
    } else {
      setSavedRows(data || []);
    }
    setHistoryBusy(false);
  };

  useEffect(() => {
    loadSavedComparisons();
  }, []);

  const formatSelection = value => String(value || '')
    .replace(/\bW1\b/gi, 'Vitória da equipa da casa')
    .replace(/\bW2\b/gi, 'Vitória da equipa visitante')
    .replace(/\bX\b/gi, 'Empate')
    .replace(/\bmais de\b/gi, 'Mais de')
    .replace(/\bmenos de\b/gi, 'Menos de');

  const visibleRows = savedRows.map(row => {
    const comparison = row.comparison || {};
    const groups = Array.isArray(comparison.events) ? comparison.events : [];
    const match = row.matches || {};
    const title = groups[0]?.event
      ? groups[0].event.home + ' vs ' + groups[0].event.away
      : (match.home_team || 'Jogo') + ' vs ' + (match.away_team || '—');
    const items = groups.flatMap(group => (group.comparisons || []).map(item => ({
      ...item,
      event: group.event,
      selectionLabel: formatSelection(item.selection),
      displaySelection: /^(mais de|mais|over|menos de|menos|under)\\b/i.test(String(item.selection || '').trim()) &&
        item.line && !/(?:mais de|mais|over|menos de|menos|under)\\s+[+-]?\\d+(?:[.,]\\d+)?/i.test(String(item.selection || ''))
        ? formatSelection(item.selection) + ' ' + item.line
        : formatSelection(item.selection),
      displayMarket: (() => {
        const name = String(item.market || '').trim();
        const type = String(item.marketType || '').toLowerCase();
        if (name && !/^total$/i.test(name)) return name;
        if (/corner|canto/.test(type)) return 'Total de cantos';
        if (/goal|golo/.test(type)) return /team/.test(type) ? 'Total de golos da equipa' : 'Total de golos';
        if (/card|cartao/.test(type)) return 'Total de cartões';
        return name || 'Mercado';
      })(),
      missingLine: /\\b(mais de|menos de)\\b/i.test(item.selection || '') &&
        !/(?:mais de|menos de|over|under)\\s+[+-]?\\d+(?:[.,]\\d+)?/i.test(item.selection || '') &&
        !item.line
    })));
    return { ...row, match, title, items };
  }).filter(row => {
    const haystack = [row.title, row.match.competition, ...row.items.flatMap(item => [item.market, item.selectionLabel])]
      .join(' ').toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  return <div className="odds-workspace">
    <section className="panel odds-step">
      <div className="odds-section-title">
        <span><ShieldCheck size={16}/></span>
        <div><h3>Comparações recebidas automaticamente</h3><p>Jogos e odds enviados pelo recolhedor do teu computador e guardados na nuvem.</p></div>
        <button className="secondary-btn" onClick={loadSavedComparisons} disabled={historyBusy}><RefreshCw size={15}/>{historyBusy ? 'A actualizar...' : 'Actualizar'}</button>
      </div>
      {historyError && <div className="odds-error">{historyError}</div>}
      {!historyError && !savedRows.length && !historyBusy && <div className="empty-state"><div className="empty-state-icon"><BarChart3 size={22}/></div><b>Ainda não há comparações guardadas</b><span>Quando o recolhedor enviar jogos, as comparações aparecerão automaticamente aqui.</span></div>}
      {savedRows.length > 0 && <div className="toolbar odds-filter"><div className="searchbox"><BarChart3 size={16}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Pesquisar jogo, mercado ou selecção..."/></div><span>{visibleRows.length} de {savedRows.length} jogos</span></div>}
      {visibleRows.map(row => (
        <article className="panel odds-saved-card" key={row.id}>
          <div className="panel-head"><div><h3>{row.title}</h3><p>{row.match.competition || row.items[0]?.event?.competition || 'Competição não indicada'} · {row.created_at ? new Date(row.created_at).toLocaleString('pt-AO') : 'Data não indicada'}</p></div><span className="status-text">{row.items.length} comparações</span></div>
          <div className="odds-results-list">
            {row.items.map((item, index) => (
              <article className="odds-result-card" key={item.market + item.selection + index}>
                <div className="odds-result-top"><div><span className="odds-market-label">{item.displayMarket}</span><h3>{item.displaySelection}</h3><small>{item.period === 'FT' ? 'Jogo completo' : item.period === '1H' ? '1.ª parte' : item.period === '2H' ? '2.ª parte' : item.period || 'Período não indicado'}{item.line ? ' · Linha ' + item.line : ''}</small>{item.missingLine && <small className="odds-line-warning">Linha de golos não indicada pela casa de apostas</small>}</div><div className="best-odd"><small>MELHOR ODD</small><b>{Number(item.bestOdds).toFixed(2)}</b><span>{item.bestBookmaker}</span></div></div>
                <div className="odds-quotes">{(item.quotes || []).map(quote => <div className={quote.bookmaker === item.bestBookmaker && quote.odds === item.bestOdds ? 'odds-quote best' : 'odds-quote'} key={quote.bookmaker}><span>{quote.bookmaker}</span><b>{Number(quote.odds).toFixed(2)}</b>{quote.bookmaker === item.bestBookmaker && quote.odds === item.bestOdds && <em>Melhor</em>}</div>)}</div>
              </article>
            ))}
          </div>
        </article>
      ))}
      {visibleRows.length === 0 && savedRows.length > 0 && <div className="empty-state"><b>Nenhum resultado encontrado</b><span>Experimenta outra pesquisa.</span></div>}
      <p className="odds-safety-note"><ShieldCheck size={14}/> As cotações são as recebidas no momento da recolha. Mercados sem linha indicada ficam assinalados para revisão; confirma sempre a cotação na casa de apostas.</p>
    </section>
  </div>;
}
