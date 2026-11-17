import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, ChevronRight, FileText, History, LayoutDashboard, Radio, ShieldCheck, Ticket, Menu, X } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { fetchBookmakerLiveFeeds, buildSwarmLegUpdates } from './lib/swarm-live.js';

const NAV = [['Bilhetes do dia', LayoutDashboard], ['Análises', FileText], ['Acompanhamento ao vivo', Activity], ['Histórico', History]];
const money = n => Number(n || 0).toFixed(2);
const isToday = value => value && new Date(value).toDateString() === new Date().toDateString();
const kickoffDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const formatKickoffTime = value => {
  const date = kickoffDate(value);
  return date ? new Intl.DateTimeFormat('pt-AO', { timeZone: 'Africa/Luanda', hour: '2-digit', minute: '2-digit' }).format(date) : 'Hora por confirmar';
};
const formatKickoffDateTime = value => {
  const date = kickoffDate(value);
  return date ? new Intl.DateTimeFormat('pt-AO', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : 'Data e hora por confirmar';
};
const firstKickoff = legs => (legs || []).map(leg => kickoffDate(leg.date)).filter(Boolean).sort((a, b) => a - b)[0] || null;
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
    ['Fora', 'shots_off_target'], ['Cantos', 'corners'], ['Cartões amarelos', 'yellow_cards'],
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
  const [liveStatus, setLiveStatus] = useState('A aguardar primeira consulta');
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
  }, [page]);
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
    if (page !== 'Acompanhamento ao vivo') return undefined;
    let active = true;
    let refreshing = false;
    const refreshLive = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [apiResult, swarmFeeds] = await Promise.all([
          fetch('/api/pipeline?action=live-tickets', { cache: 'no-store' })
            .then(async response => ({ response, result: await response.json().catch(() => ({})) }))
            .catch(error => ({ networkError: error?.message || String(error) })),
          fetchBookmakerLiveFeeds()
        ]);
        if (!active) return;
        let apiMessage = '';
        if (apiResult.networkError) {
          apiMessage = 'API estatística: ' + apiResult.networkError;
        } else if (!apiResult.response.ok || !apiResult.result.ok) {
          apiMessage = apiResult.result.detail || apiResult.result.error || `API estatística HTTP ${apiResult.response.status}`;
        } else {
          setLiveUpdates(current => ({ ...current, ...(apiResult.result.legs || {}) }));
        }
        const swarm = buildSwarmLegUpdates(data.tickets, swarmFeeds);
        if (swarm.matched) setLiveUpdates(current => ({ ...current, ...swarm.updates }));
        const feedErrors = swarmFeeds.filter(feed => feed.error).map(feed => feed.name + ': ' + feed.error);
        const connected = swarmFeeds.filter(feed => !feed.error).map(feed => feed.name);
        const warnings = [apiMessage, ...feedErrors].filter(Boolean);
        setLiveUpdatedAt(new Date().toISOString());
        setLiveStatus(
          `${swarm.matched} jogos associados pelo Swarm · ${swarm.totalGames} jogos recebidos das casas` +
          (connected.length ? ' · Ligações: ' + connected.join(', ') : '') +
          (warnings.length ? ' · Avisos: ' + warnings.join(' | ') : '') +
          (!swarm.totalGames && !warnings.length ? ' · As casas não devolveram jogos em directo.' : '')
        );
      } catch (error) {
        if (active) setLiveStatus(error?.message || 'Falha de comunicação com o acompanhamento.');
      } finally {
        refreshing = false;
      }
    };
    refreshLive();
    // Consulta API estatística e feeds Swarm a cada 30 segundos nesta página.
    const timer = window.setInterval(refreshLive, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [page, data.tickets]);

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
          <div className="quiet-note live-help"><Radio size={15}/><span><b>Como ler o acompanhamento:</b> “Em directo” significa que a fonte confirmou que o jogo começou; nessa situação aparecem marcador e minuto quando disponíveis. “Por iniciar” significa que o pontapé de saída ainda não chegou. “Terminado” só aparece quando a fonte confirma o fim. Abre a ficha pela seta para consultar os jogos e mercados. {liveUpdatedAt ? `Última consulta: ${new Date(liveUpdatedAt).toLocaleTimeString('pt-AO', { timeZone: 'Africa/Luanda' })}. ` : ''}Estado da fonte: {liveStatus}. Actualização automática a cada 30 segundos.</span></div>
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

function TicketPanel({ ticket: t, expanded, onToggle, liveView = false }) {
  const legs = t.legs || [];
  const liveCount = legs.filter(isLive).length;
  const status = ticketStatus(t);
  return <section className="panel daily-ticket">
    <button className="ticket-expand" onClick={onToggle} aria-expanded={expanded}>
      <div className="ticket-expand-main"><div className="ticket-title-row"><span className={Number(t.totalOdds) >= 100 ? 'tag tag-gold' : 'tag'}>{t.type || 'FICHA DO DIA'}</span><span className={'ticket-status ' + ticketStatusClass(status)}>{status}</span></div><h3>{t.name || 'Ficha Kamba'}</h3><div className="ticket-subline"><span>{t.sharedTicketId ? 'FK-' + t.sharedTicketId.slice(0, 8).toUpperCase() : t.id}</span><span>{t.bookmakerEntries?.length ? 'BantuBet + ElephantBet' : t.bookmaker || 'Casa de apostas não indicada'}</span><span>{legs.length} jogos</span>{firstKickoff(legs) && <span className="ticket-first-kickoff">1.º jogo começa às {formatKickoffTime(firstKickoff(legs).toISOString())}</span>}</div></div>
      <div className="ticket-quick">{t.bookmakerEntries?.length ? t.bookmakerEntries.map(entry => <div className="bookmaker-quick" key={entry.bookmaker}><small>{entry.bookmaker}</small><b>{money(entry.totalOdds)}</b><span>{entry.bookingId ? 'Link de partilha criado' : 'Reserva pendente'}</span></div>) : <><small>ODD TOTAL</small><b>{money(t.totalOdds)}</b><span className="reserve-id">ID do boletim: {t.bookingId || 'A aguardar ID'}</span></>}</div><span className="expand-icon">{expanded ? <ChevronDown/> : <ChevronRight/>}</span>
    </button>
    {expanded && <div className="ticket-details"><div className="details-heading"><b>Jogos e mercados desta ficha</b><span>{liveView ? 'Estado em directo quando disponível' : 'Mesmas selecções nas duas casas'}</span></div>
      {t.bookmakerEntries?.length > 0 && <div className="ticket-reservations">{t.bookmakerEntries.map(entry => <div className="reservation-row" key={entry.bookmaker}><div><b>{entry.bookmaker}</b><small>Odd total: {money(entry.totalOdds)}</small></div><div className="reservation-code"><small>ID DO LINK DE PARTILHA</small><b>{entry.bookingId || 'A aguardar reserva'}</b></div>{entry.bookingUrl && <a className="reserve-link" href={entry.bookingUrl} target="_blank" rel="noreferrer">Abrir boletim</a>}</div>)}</div>}
      {legs.length ? legs.map((leg, i) => <article className="match-detail" key={leg.id || i}><div className="match-detail-top"><span className="match-number">JOGO {String(i + 1).padStart(2, '0')}</span><span className={resultClass(leg)}>{resultLabel(leg)}</span></div><div className="match-teams"><b>{leg.home || leg.homeTeam || 'Equipa da casa'} <span>vs</span> {leg.away || leg.awayTeam || 'Equipa visitante'}</b><small>{leg.league || leg.competition || 'Campeonato não indicado'}</small><div className="match-kickoff"><CalendarDays size={13}/><span>Início: <b>{formatKickoffTime(leg.date)}</b></span><span>({formatKickoffDateTime(leg.date)})</span></div></div>
        <div className="market-detail-grid"><div><small>MERCADO</small><b>{leg.market || 'Mercado'}</b></div><div><small>SELECÇÃO</small><b>{leg.selection || '—'}</b></div><div><small>ODD</small><b>{money(leg.odd)}</b></div></div>
        {(isLive(leg) || isFinished(leg) || matchScore(leg)) && <div className={isLive(leg) ? 'live-score-strip' : 'final-score-strip'}><Radio size={15}/><b>{matchScore(leg) || '— : —'}</b><span>{isLive(leg) ? (leg.minute ? leg.minute + "'" : leg.matchStatus || 'Em directo') : isFinished(leg) ? 'RESULTADO FINAL' : (leg.matchStatus || 'Resultado disponível')}</span>{leg.lastEvent && <small>{isLive(leg) ? leg.lastEvent : 'Último evento: ' + leg.lastEvent}</small>}</div>}
        {(isLive(leg) || isFinished(leg)) && liveStatRows(leg).length > 0 && <div className="live-stats-grid">
          {liveStatRows(leg).map(row => <div key={row.label}><small>{row.label}</small><b>{row.home} : {row.away}</b></div>)}
        </div>}
        {leg.rationale && <div className="leg-analysis">
          <div className="leg-analysis-title">Fundamento da análise</div>
          <p>{leg.rationale}</p>
          <div className="leg-analysis-meta">
            {leg.fairProbability != null && <span>Probabilidade estimada: {(Number(leg.fairProbability) * 100).toFixed(1)}%</span>}
            {leg.confidence && <span>Confiança: {({ low: 'baixa', medium: 'média', high: 'alta' })[leg.confidence] || leg.confidence}</span>}
            {leg.expectedValue != null && <span>EV estimado: {Number(leg.expectedValue) >= 0 ? '+' : ''}{(Number(leg.expectedValue) * 100).toFixed(1)}%</span>}
          </div>
        </div>}
        {leg.marketUpdate && <p className="market-update">{leg.marketUpdate}</p>}
      </article>) : <p className="muted-copy">Os jogos desta ficha serão apresentados aqui quando forem publicados.</p>}
      <div className="ticket-detail-footer"><span>{t.bookmakerEntries?.length ? 'LINKS DE PARTILHA POR CASA' : 'IDENTIFICADOR DO BOLETIM'}</span><b>{t.bookmakerEntries?.length ? 'Apresentados acima para cada casa' : t.bookingId || 'Ainda não disponibilizado'}</b>{t.bookingUrl && <a className="reserve-link" href={t.bookingUrl} target="_blank" rel="noreferrer">Abrir boletim partilhável</a>}</div>
    </div>}
  </section>;
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

