import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, ChevronRight, FileText, History, LayoutDashboard, Radio, ShieldCheck, Ticket, Menu, X } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import './home-redesign.css';

const NAV = [['Bilhetes do dia', LayoutDashboard], ['Análises', FileText], ['Acompanhamento ao vivo', Activity], ['Histórico', History]];
const money = n => Number(n || 0).toFixed(2);
const isToday = value => value && new Date(value).toDateString() === new Date().toDateString();
const matchState = leg => String(leg.matchStatus || leg.status || '').toUpperCase().replace(/[\s-]+/g, '_');
const isLive = leg => ['IN_PLAY', 'LIVE', 'PAUSED', '1H', '2H', 'HT', 'FIRST_HALF', 'SECOND_HALF', '1ST_HALF', '2ND_HALF', 'HALF_TIME', 'EXTRA_TIME', 'ET'].includes(matchState(leg)) || Boolean(leg.live);
const isFinished = leg => ['FINISHED', 'FT', 'FULL_TIME', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT', 'AET', 'PENS'].includes(matchState(leg));
const matchScore = leg => {
  const score = leg.score || {};
  const home = leg.homeScore ?? score.home ?? score.fullTime?.home ?? score.regularTime?.home ?? score.current?.home;
  const away = leg.awayScore ?? score.away ?? score.fullTime?.away ?? score.regularTime?.away ?? score.current?.away;
  return home !== null && home !== undefined && away !== null && away !== undefined ? `${home} : ${away}` : null;
};
const resultLabel = leg => {
  const value = String(leg.marketStatus || leg.result || '').trim();
  if (!value || /^pending$/i.test(value)) return isLive(leg) ? 'Em directo' : isFinished(leg) ? 'Resultado por confirmar' : 'Por iniciar';
  return value;
};
const settledLeg = leg => /^(ganha|perdida|linha devolvida|won|lost|push|void)$/i.test(String(leg.marketStatus || leg.result || '').trim());
const ticketFullySettled = ticket => (ticket.legs || []).length > 0 && ticket.legs.every(settledLeg);
const liveStatRows = leg => {
  const home = leg.liveStats?.home || {}, away = leg.liveStats?.away || {};
  const fields = [
    ['Remates', 'shots'], ['À baliza', 'shots_on_target'],
    ['Fora', 'shots_off_target'], ['Cartões amarelos', 'yellow_cards'],
    ['Faltas', 'fouls'], ['Defesas', 'saves']
  ];
  return fields.map(([label, key]) => ({ label, home: home[key], away: away[key] }))
    .filter(row => row.home !== null && row.home !== undefined && row.away !== null && row.away !== undefined);
};
const resultClass = leg => {
  const s = String(resultLabel(leg)).toLowerCase();
  if (s.includes('ganh') || s.includes('favor')) return 'state-good';
  if (s.includes('perd') || s.includes('risco') || s.includes('desfavor')) return 'state-bad';
  if (s.includes('direct') || s.includes('live')) return 'state-live';
  return 'state-pending';
};

export default function App() {
  const [page, setPage] = useState('Bilhetes do dia');
  const [data, setData] = useState({ tickets: [] });
  const [analyses, setAnalyses] = useState([]);
  const [analysesLoading, setAnalysesLoading] = useState(true);
  const [liveUpdates, setLiveUpdates] = useState({});
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');

  // Sincroniza as fichas publicadas no Supabase; mantém o histórico local como fallback.
  useEffect(() => {
    let active = true;
    async function loadPublishedTickets() {
      if (!supabase) {
        setNotice('A ligação ao Supabase não está configurada. As fichas não serão simuladas nem carregadas de dados locais.');
        return;
      }
      const { data: rows, error } = await supabase
        .from('tickets')
        .select('id,shared_ticket_id,title,status,total_odds,booking_reference,published_at,created_at,ticket_legs(id,market_name,selection,odd,result,matches(home_team,away_team,competition,kickoff_at,status))')
        .eq('status', 'published')
        .order('published_at', { ascending: false });
      if (!active) return;
      if (error) {
        setNotice('Não foi possível sincronizar as fichas publicadas: ' + error.message);
        return;
      }
      const remoteTickets = (rows || []).map(ticket => ({
        id: ticket.id,
        sharedTicketId: ticket.shared_ticket_id || ticket.id,
        name: ticket.title,
        type: String(ticket.title || '').split('·')[1]?.trim() || 'FICHA DO DIA',
        bookmaker: /elephant/i.test(ticket.title || '') ? 'ElephantBet' : /bantu/i.test(ticket.title || '') ? 'BantuBet' : null,
        origin: 'ai',
        status: 'Publicada',
        totalOdds: ticket.total_odds,
        bookingId: (() => {
          try {
            const parsed = JSON.parse(ticket.booking_reference || "null");
            return parsed && typeof parsed === 'object' ? parsed.id || null : ticket.booking_reference || null;
          } catch { return ticket.booking_reference || null; }
        })(),
        bookingUrl: (() => {
          try {
            const parsed = JSON.parse(ticket.booking_reference || "null");
            return parsed && typeof parsed === 'object' ? parsed.url || null : null;
          } catch { return null; }
        })(),
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
      setData({ tickets: remoteTickets });
    }
    loadPublishedTickets();
    const timer = window.setInterval(loadPublishedTickets, 300000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  // Consulta apenas análises prontas; a análise é feita manualmente no ChatGPT.
  useEffect(() => {
    let active = true;
    async function loadAnalyses() {
      if (!supabase) {
        if (active) setAnalysesLoading(false);
        return;
      }
      const { data: rows, error } = await supabase
        .from('match_analyses')
        .select('id,match_id,provider,model,status,summary,analysis,generated_at,matches(home_team,away_team,competition,kickoff_at)')
        .eq('status', 'ready')
        .order('generated_at', { ascending: false })
        .limit(100);
      if (!active) return;
      if (error) {
        setNotice('Não foi possível carregar as análises: ' + error.message);
        setAnalysesLoading(false);
        return;
      }
      setAnalyses(rows || []);
      setAnalysesLoading(false);
    }
    loadAnalyses();
    const timer = window.setInterval(loadAnalyses, 300000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshLive = async () => {
      try {
        const response = await fetch('/api/pipeline/live-tickets');
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok || !active) return;
        setLiveUpdates(result.legs || {});
        setLiveUpdatedAt(result.updatedAt || new Date().toISOString());
      } catch {
        // Mantém a última actualização válida quando a fonte está temporariamente indisponível.
      }
    };
    refreshLive();
    const timer = window.setInterval(refreshLive, 300000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const ticketsWithLive = useMemo(() => data.tickets.map(ticket => ({
    ...ticket,
    legs: (ticket.legs || []).map(leg => ({ ...leg, ...(liveUpdates[leg.id] || {}) }))
  })), [data.tickets, liveUpdates]);
  const groupedTickets = useMemo(() => groupBookmakerPairs(ticketsWithLive), [ticketsWithLive]);
  const todayTickets = useMemo(() => groupedTickets.filter(t => t.origin === 'ai' && isToday(t.createdAt)), [groupedTickets]);
  // Acompanhamento mantém também jogos por iniciar e jogos terminados no próprio dia.
  const liveTickets = todayTickets;
  const history = useMemo(() => groupedTickets.filter(t =>
    t.origin !== 'ai' || !isToday(t.createdAt) || ticketFullySettled(t)
  ), [groupedTickets]);
  const filteredHistory = history.filter(t => [t.id, t.name, t.bookmaker, t.bookingId].join(' ').toLowerCase().includes(query.toLowerCase()));
  const toggle = id => setExpanded(p => ({ ...p, [id]: !p[id] }));
  if (page === 'Bilhetes do dia') return <DailyHome
    tickets={todayTickets}
    expanded={expanded}
    onToggle={toggle}
    notice={notice}
    onDismissNotice={() => setNotice('')}
  />;
  const side = <><div className="brand"><div className="brand-mark">FK<span>.</span></div><div><b>FICHA KAMBA</b><small>FUTEBOL • INTELIGÊNCIA</small></div></div><div className="side-label">MENU PRINCIPAL</div><nav>{NAV.map(([label, Icon]) => <button key={label} className={page === label ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(label); setMobile(false); }}><Icon size={18}/><span>{label}</span>{label === 'Acompanhamento ao vivo' && liveTickets.length > 0 && <i className="live-dot"/>}</button>)}</nav><div className="side-bottom"><div className="side-status"><span className="status-dot"/> Consulta de fichas <small>As fichas publicadas aparecem neste painel</small></div><div className="profile"><div className="avatar">FK</div><div><b>Utilizador</b><small>Ficha Kamba</small></div></div></div></>;
  return <div className="app-shell"><aside className={mobile ? 'sidebar mobile-open' : 'sidebar'}>{side}</aside>{mobile && <button className="scrim" onClick={() => setMobile(false)} aria-label="Fechar menu"/>}
    <main className="main"><header className="topbar"><button className="icon-btn mobile-menu" onClick={() => setMobile(true)}><Menu/></button><div className="crumb">Plataforma <span>/</span> <b>{page}</b></div><div className="top-actions"><span className="date-chip"><CalendarDays size={15}/> {new Date().toLocaleDateString('pt-AO')}</span><span className="local-chip"><i/> PAINEL</span><div className="avatar small">FK</div></div></header>
      <div className="content"><div className="welcome"><div><div className="eyebrow"><span className="status-dot"/> FICHA KAMBA</div><h1>{page}</h1><p>{page === 'Bilhetes do dia' ? 'Consulta as fichas preparadas e publicadas para hoje.' : page === 'Acompanhamento ao vivo' ? 'Acompanha cada jogo e o mercado correspondente dentro da ficha.' : 'Consulta fichas e resultados de dias anteriores.'}</p></div></div>
        {notice && <div className="notice"><ShieldCheck size={17}/><span>{notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}
        {page === 'Bilhetes do dia' && <>
          <div className="daily-summary"><div className="daily-icon"><Ticket size={21}/></div><div><b>{todayTickets.length} {todayTickets.length === 1 ? 'ficha publicada' : 'fichas publicadas'} hoje</b><span>As fichas do dia, os IDs de reserva e todos os jogos ficam reunidos aqui.</span></div><div className="daily-date">{new Date().toLocaleDateString('pt-AO')}</div></div>
          {todayTickets.length ? <div className="daily-ticket-list">{todayTickets.map(t => <TicketPanel key={t.id} ticket={t} expanded={!!expanded[t.id]} onToggle={() => toggle(t.id)}/>)}</div> : <EmptyState icon={FileText} title="Ainda não há fichas publicadas para hoje" detail="As fichas aparecerão automaticamente aqui quando o serviço de análise e publicação da IA estiver ligado. Não são apresentados palpites ou IDs de reserva inventados."/>}
          <div className="quiet-note"><ShieldCheck size={16}/><span>Esta área é apenas de consulta. A elaboração das fichas é uma tarefa interna do sistema.</span></div>
        </>}
        {page === 'Análises' && <>
          <div className="daily-summary"><div className="daily-icon"><FileText size={21}/></div><div><b>{analyses.length} {analyses.length === 1 ? 'análise disponível' : 'análises disponíveis'}</b><span>Relatórios preparados aqui no ChatGPT e guardados no Supabase.</span></div><div className="daily-date">ChatGPT</div></div>
          {analysesLoading ? <div className="empty-state"><b>A carregar análises...</b></div> :
            analyses.length ? <div className="daily-ticket-list">{analyses.map(row => <AnalysisPanel key={row.id} row={row}/>)}</div> :
            <EmptyState icon={FileText} title="Ainda não existem análises guardadas" detail="Depois da recolha diária das odds, pede aqui no ChatGPT para analisar os jogos. As análises aprovadas aparecerão nesta área."/>}
        </>}
        {page === 'Acompanhamento ao vivo' && <>
          <div className="live-overview">
            <div><b>{liveTickets.reduce((n,t) => n + (t.legs || []).filter(isLive).length, 0)}</b><span>Em directo</span></div>
            <div><b>{liveTickets.reduce((n,t) => n + (t.legs || []).filter(isFinished).length, 0)}</b><span>Terminados</span></div>
            <div><b>{liveTickets.reduce((n,t) => n + (t.legs || []).filter(leg => !isLive(leg) && !isFinished(leg)).length, 0)}</b><span>Por iniciar</span></div>
            <div><b>{liveTickets.length}</b><span>Fichas de hoje</span></div>
          </div>
          {liveUpdatedAt && <div className="quiet-note"><Radio size={15}/><span>Marcadores e estados actualizados a cada 5 minutos. As estatísticas são recolhidas em rotação para respeitar os limites da fonte. Última consulta: {new Date(liveUpdatedAt).toLocaleTimeString('pt-AO')}</span></div>}
          {liveTickets.length ? <div className="daily-ticket-list">{liveTickets.map(t => <TicketPanel key={t.id} ticket={t} expanded={expanded[t.id] !== false} onToggle={() => toggle(t.id)} liveView/>)}</div> : <EmptyState icon={Radio} title="Ainda não há fichas de hoje para acompanhar" detail="Quando forem publicadas, os jogos por iniciar, em directo e terminados serão acompanhados dentro de cada ficha."/>}
        </>}
        {page === 'Histórico' && <>
          <div className="toolbar"><div className="searchbox"><History size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar por ficha, ID ou casa..."/></div></div>
          {filteredHistory.length ? <div className="daily-ticket-list">{filteredHistory.map(t => <TicketPanel key={t.id} ticket={t} expanded={!!expanded[t.id]} onToggle={() => toggle(t.id)}/>)}</div> : <EmptyState icon={History} title="Ainda não há histórico" detail="As fichas concluídas serão arquivadas aqui para consulta."/>}
        </>}
        <footer><span>FK — Ficha Kamba</span><span>Dados de jogos e resultados dependem de fontes desportivas autorizadas.</span></footer>
      </div>
    </main>
  </div>;
}

function groupBookmakerPairs(tickets) {
  const groups = new Map();
  for (const ticket of tickets) {
    const key = ticket.sharedTicketId || ticket.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ticket);
  }
  return [...groups.values()].map(items => {
    if (items.length === 1) return items[0];
    const first = items[0];
    const entries = items.map(item => ({
      bookmaker: item.bookmaker || 'Casa não indicada',
      totalOdds: item.totalOdds,
      bookingId: item.bookingId,
      bookingUrl: item.bookingUrl
    })).sort((a, b) => a.bookmaker.localeCompare(b.bookmaker));
    return {
      ...first,
      id: first.sharedTicketId || first.id,
      name: String(first.name || 'Ficha Kamba').replace(/ · (?:BantuBet|ElephantBet) · .+$/i, ''),
      bookmaker: null,
      bookmakerEntries: entries,
      totalOdds: null,
      bookingId: null,
      bookingUrl: null
    };
  });
}

function ticketStatus(ticket) {
  const legs = ticket.legs || [];
  const outcomes = legs.map(leg => String(leg.marketStatus || leg.result || '').toLowerCase());
  if (outcomes.some(value => value.includes('perdida') || value === 'lost')) return 'Perdida';
  if (ticketFullySettled(ticket)) return outcomes.every(value => value === 'void') ? 'Anulada' : 'Ganha';
  if (legs.some(isLive)) return legs.filter(isLive).length + ' jogo(s) em directo';
  if (legs.length && legs.every(isFinished)) return 'A aguardar liquidação';
  return ticket.status || 'Publicada';
}

function ticketStatusClass(status) {
  if (status === 'Ganha') return 'state-good';
  if (status === 'Perdida') return 'state-bad';
  if (String(status).includes('directo')) return 'state-live';
  return 'state-pending';
}

function DailyHome({ tickets, expanded, onToggle, notice, onDismissNotice }) {
  return <main className="fk-home">
    <header className="fk-home-header">
      <a className="fk-home-brand" href="/" aria-label="Ficha Kamba">
        <span className="fk-home-logo">FK</span>
        <span><b>FICHA KAMBA</b><small>FUTEBOL • INTELIGÊNCIA</small></span>
      </a>
      <div className="fk-home-header-right">
        <span className="fk-home-date"><CalendarDays size={15}/> {new Date().toLocaleDateString('pt-AO')}</span>
        <span className="fk-home-live"><i/> SISTEMA ONLINE</span>
      </div>
    </header>
    <section className="fk-home-content">
      <div className="fk-home-intro">
        <div className="fk-home-kicker"><span/> FICHA KAMBA</div>
        <h1>BILHETES DO DIA</h1>
        <p>As fichas publicadas, os jogos e as respectivas selecções num só lugar.</p>
      </div>
      {notice && <div className="fk-home-notice"><ShieldCheck size={17}/><span>{notice}</span><button onClick={onDismissNotice} aria-label="Fechar aviso"><X size={15}/></button></div>}
      <div className="fk-home-summary">
        <div className="fk-home-summary-icon"><Ticket size={23}/></div>
        <div className="fk-home-summary-copy">
          <b>{tickets.length} {tickets.length === 1 ? 'FICHA PUBLICADA' : 'FICHAS PUBLICADAS'}</b>
          <span>Fichas oficiais de hoje • Jogos, odds e referências de reserva actualizados.</span>
        </div>
        <div className="fk-home-summary-date">{new Date().toLocaleDateString('pt-AO')}</div>
      </div>
      {tickets.length ? <div className="fk-home-ticket-grid">
        {tickets.map((ticket,index) => <TicketPanel key={ticket.id} ticket={ticket}
          expanded={!!expanded[ticket.id]} onToggle={() => onToggle(ticket.id)}
          featured={index === 0}/>)}
      </div> : <div className="fk-home-empty">
        <div className="fk-home-empty-icon"><FileText size={25}/></div>
        <b>AINDA NÃO HÁ FICHAS PUBLICADAS HOJE</b>
        <span>Quando as fichas reais forem publicadas, aparecerão automaticamente nesta página.</span>
      </div>}
      <footer className="fk-home-footer"><span>© FICHA KAMBA</span><span><i/> DADOS SINCRONIZADOS COM A PLATAFORMA</span></footer>
    </section>
  </main>;
}

function TicketPanel({ ticket: t, expanded, onToggle, liveView = false, featured = false }) {
  const legs = t.legs || [];
  const liveCount = legs.filter(isLive).length;
  const status = ticketStatus(t);
  const entries = t.bookmakerEntries || [];
  return <article className={'fk-ticket-card' + (featured ? ' fk-ticket-featured' : '')}>
    <button className="fk-ticket-head" onClick={onToggle} aria-expanded={expanded}>
      <span className="fk-ticket-mark">FK<small>FICHA</small></span>
      <span className="fk-ticket-heading">
        <span className="fk-ticket-tags">
          {featured && <em className="fk-ticket-feature-tag">DESTAQUE</em>}
          <em className="fk-ticket-kind">{t.type || 'FICHA DO DIA'}</em>
          <em className={'fk-ticket-status ' + ticketStatusClass(status)}>{status}</em>
          {liveCount > 0 && <em className="fk-ticket-live">{liveCount} AO VIVO</em>}
        </span>
        <strong>{t.name || 'Ficha Kamba'}</strong>
        <small className="fk-ticket-meta">
          <span><ShieldCheck size={12}/> {entries.length ? 'BantuBet + ElephantBet' : t.bookmaker || 'Casa não indicada'}</span>
          <span><Activity size={12}/> {legs.length} {legs.length === 1 ? 'jogo' : 'jogos'}</span>
          <span><FileText size={12}/> {t.sharedTicketId ? 'FK-' + t.sharedTicketId.slice(0,8).toUpperCase() : t.id}</span>
        </small>
      </span>
      <span className="fk-ticket-odds">
        <small>ODD COMBINADA</small>
        {entries.length ? entries.map(entry => <b key={entry.bookmaker}>{money(entry.totalOdds)}<small>{entry.bookmaker}</small></b>) : <b>{money(t.totalOdds)}</b>}
      </span>
      <span className="fk-ticket-chevron">{expanded ? <ChevronDown/> : <ChevronRight/>}</span>
    </button>
    <div className="fk-ticket-selections">
      {legs.map((leg,index) => <div className="fk-selection-row" key={leg.id || index}>
        <span className="fk-selection-number">{String(index+1).padStart(2,'0')}</span>
        <span className="fk-selection-match"><b>{leg.home || leg.homeTeam || 'Equipa da casa'} <i>vs</i> {leg.away || leg.awayTeam || 'Equipa visitante'}</b><small>{leg.league || leg.competition || 'Competição'}{leg.date ? ' · '+new Date(leg.date).toLocaleString('pt-AO') : ''}</small></span>
        <span className="fk-selection-pick"><small>{leg.market || 'MERCADO'}</small><b>{leg.selection || '—'}</b></span>
        <span className="fk-selection-odd"><small>ODD</small><b>{money(leg.odd)}</b></span>
      </div>)}
      {!legs.length && <span className="fk-no-selections">As selecções desta ficha ainda não foram disponibilizadas.</span>}
    </div>
    <div className="fk-ticket-foot">
      <span>{legs.length} selecções incluídas</span>
      <span>{entries.length ? 'Reservas por casa de apostas' : 'ID DE RESERVA'}</span>
      <b>{entries.length ? entries.map(e => e.bookmaker + ': ' + (e.bookingId || 'A aguardar')).join(' • ') : (t.bookingId || 'A aguardar')}</b>
      <a onClick={e => { e.preventDefault(); onToggle(); }} href="#detalhes">{expanded ? 'FECHAR DETALHES' : 'VER DETALHES'} <ChevronDown size={13}/></a>
    </div>
    {expanded && <div className="fk-ticket-details">
      <div className="fk-details-heading"><b>DETALHES DA FICHA</b><span>{liveView ? 'ACOMPANHAMENTO AO VIVO' : 'INFORMAÇÃO PUBLICADA'}</span></div>
      {entries.length > 0 && <div className="ticket-reservation-grid">{entries.map(entry => <div className="ticket-reservation-card" key={entry.bookmaker}><div><small>CASA DE APOSTAS</small><b>{entry.bookmaker}</b></div><div><small>ODD TOTAL</small><strong>{money(entry.totalOdds)}</strong></div><div><small>ID DE RESERVA</small><b>{entry.bookingId || 'A aguardar reserva'}</b></div>{entry.bookingUrl && <a className="reserve-link" href={entry.bookingUrl} target="_blank" rel="noreferrer">Abrir boletim <ChevronRight size={14}/></a>}</div>)}</div>}
      {legs.map((leg,i) => <div className="fk-leg-extra" key={leg.id || i}>
        <div><b>{leg.home || leg.homeTeam || 'Equipa da casa'} vs {leg.away || leg.awayTeam || 'Equipa visitante'}</b><span>{leg.league || leg.competition || 'Competição não indicada'}</span></div>
        <span className={resultClass(leg)}>{resultLabel(leg)}</span>
        {(isLive(leg) || isFinished(leg) || matchScore(leg)) && <div className={isLive(leg) ? 'live-score-strip' : 'final-score-strip'}><Radio size={15}/><b>{matchScore(leg) || '— : —'}</b><span>{isLive(leg) ? (leg.minute ? leg.minute + "'" : leg.matchStatus || 'Em directo') : 'RESULTADO FINAL'}</span>{leg.lastEvent && <small>{leg.lastEvent}</small>}</div>}
        {(isLive(leg) || isFinished(leg)) && liveStatRows(leg).length > 0 && <div className="live-stats-grid">{liveStatRows(leg).map(row => <div key={row.label}><small>{row.label}</small><b>{row.home} : {row.away}</b></div>)}</div>}
        {leg.rationale && <p className="leg-analysis">{leg.rationale}</p>}
      </div>)}
      {!entries.length && <div className="fk-booking-reference"><small>REFERÊNCIA DO BOLETIM</small><b>{t.bookingId || 'Ainda não disponibilizada'}</b>{t.bookingUrl && <a href={t.bookingUrl} target="_blank" rel="noreferrer">Abrir boletim</a>}</div>}
    </div>}
  </article>;
}

function AnalysisPanel({ row }) {
  const match = row.matches || {};
  const report = row.analysis || {};
  const selections = Array.isArray(report.selections) ? report.selections : [];
  const percent = value => {
    const number = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return '—';
    return (Math.abs(number) <= 1 ? number * 100 : number).toFixed(1) + '%';
  };
  return <section className="panel daily-ticket">
    <div className="ticket-details">
      <div className="details-heading">
        <b>{match.home_team || 'Equipa da casa'} <span>vs</span> {match.away_team || 'Equipa visitante'}</b>
        <span>{row.status === 'ready' ? 'Análise concluída' : row.status}</span>
      </div>
      <div className="ticket-subline">
        <span>{match.competition || 'Competição não indicada'}</span>
        <span>{match.kickoff_at ? new Date(match.kickoff_at).toLocaleString('pt-AO') : 'Data não indicada'}</span>
        <span>{row.provider || 'ChatGPT'}{row.model ? ' · ' + row.model : ''}</span>
      </div>
      {(row.summary || report.verdict) && <p className="panel-note">{row.summary || report.verdict}</p>}
      {Array.isArray(report.riskFlags) && report.riskFlags.length > 0 && <p className="panel-note">Riscos: {report.riskFlags.join(' · ')}</p>}
      {selections.length ? <div className="history-legs">{selections.map((pick,index) => <div key={pick.id || index}>
        <span>{pick.market || 'Mercado'} · {pick.selection || 'Selecção'}</span>
        <small>Odd: {pick.bestOdds ?? pick.odds ?? '—'} · Probabilidade: {percent(pick.probability ?? pick.estimatedProbability)} · Edge: {percent(pick.edge)} · Valor esperado: {percent(pick.expectedValue)}</small>
        {pick.bestBookmaker && <small>Melhor cotação: {pick.bestBookmaker}</small>}
        {pick.confidence && <small>Confiança: {pick.confidence}</small>}
        {pick.rationale && <small>{pick.rationale}</small>}
      </div>)}</div> : <div className="panel-note">Relatório sem selecções recomendadas. Consulta os fundamentos e os riscos no relatório completo.</div>}
      {Array.isArray(report.sources) && report.sources.length > 0 && <div className="panel-note">Fontes: {report.sources.map((source,index) => <React.Fragment key={source.url || index}>{index > 0 ? ' · ' : ''}{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name || source.url}</a> : source.name || 'Fonte não identificada'}</React.Fragment>)}</div>}
      <div className="ticket-detail-footer"><span>ANÁLISE GUARDADA</span><b>{row.generated_at ? new Date(row.generated_at).toLocaleString('pt-AO') : '—'}</b></div>
    </div>
  </section>;
}

function EmptyState({ icon: Icon, title, detail }) { return <div className="empty-state"><div className="empty-state-icon"><Icon size={23}/></div><b>{title}</b><span>{detail}</span></div>; }

