import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, FileText, History, LayoutDashboard, Radio, Search, ShieldCheck, X } from 'lucide-react';
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
  const [liveGames, setLiveGames] = useState([]);
  const [gameQuery, setGameQuery] = useState('');
  const [gameScope, setGameScope] = useState('todos');
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

  // Ritmo adaptativo: a cada minuto quando há jogos em directo (ou a começar), senão a cada 5 minutos.
  const fastLiveRef = useRef(false);
  const liveGamesFastRef = useRef(false);
  useEffect(() => {
    let active = true;
    let timer;
    const refreshLive = async () => {
      try {
        if (supabase) {
          const { data: games } = await supabase.from('live_games')
            .select('sofascore_id,home_team,away_team,competition,country,status,home_score,away_score,minute,kickoff_at,finished_at,updated_at')
            .order('kickoff_at', { ascending: false }).limit(600);
          if (active && Array.isArray(games)) { liveGamesFastRef.current = games.some(g => gameIsLive(g)); setLiveGames(games); }
        }
      } catch {
        // Sem a tabela ou sem rede: a página mostra o estado vazio.
      }
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
    const loop = async () => {
      // Separador em segundo plano não gasta pedidos; actualiza logo que volta a ficar visível.
      if (!document.hidden) await refreshLive();
      if (active) timer = window.setTimeout(loop, fastLiveRef.current || liveGamesFastRef.current ? 60000 : 300000);
    };
    const onVisible = () => { if (!document.hidden && active) { window.clearTimeout(timer); loop(); } };
    document.addEventListener('visibilitychange', onVisible);
    loop();
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const ticketsWithLive = useMemo(() => data.tickets.map(ticket => ({
    ...ticket,
    legs: (ticket.legs || []).map(leg => ({ ...leg, ...(liveUpdates[leg.id] || {}) }))
  })), [data.tickets, liveUpdates]);
  const groupedTickets = useMemo(() => groupBookmakerPairs(ticketsWithLive), [ticketsWithLive]);
  const todayTickets = useMemo(() => groupedTickets.filter(t => t.origin === 'ai' && isToday(t.createdAt)), [groupedTickets]);
  // Acompanhamento mantém também jogos por iniciar e jogos terminados no próprio dia.
  const liveTickets = todayTickets;
  // Jogos em directo, ou a começar nos próximos 15 minutos, pedem actualização a cada minuto.
  fastLiveRef.current = todayTickets.some(t => (t.legs || []).some(leg => isLive(leg) ||
    (leg.date && !isFinished(leg) && Date.parse(leg.date) - Date.now() < 15 * 60 * 1000 && Date.parse(leg.date) - Date.now() > -3 * 60 * 60 * 1000)));
  const history = useMemo(() => groupedTickets.filter(t =>
    t.origin !== 'ai' || !isToday(t.createdAt) || ticketFullySettled(t)
  ), [groupedTickets]);
  const filteredHistory = history.filter(t => [t.id, t.name, t.bookmaker, t.bookingId].join(' ').toLowerCase().includes(query.toLowerCase()));
  const toggle = id => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const liveGameCount = liveGames.filter(gameIsLive).length;
  const liveLegCount = liveGameCount || liveTickets.reduce((n, t) => n + (t.legs || []).filter(isLive).length, 0);
  if (page === 'Bilhetes do dia') return <DailyHome
    tickets={todayTickets}
    expanded={expanded}
    onToggle={toggle}
    notice={notice}
    onDismissNotice={() => setNotice('')}
    onNavigate={setPage}
    liveCount={liveLegCount}
    ticketLiveCount={liveTickets.reduce((n, t) => n + (t.legs || []).filter(isLive).length, 0)}
  />;
  const sum = fn => liveTickets.reduce((n, t) => n + (t.legs || []).filter(fn).length, 0);
  const shell = { page, onNavigate: setPage, liveCount: liveLegCount, notice, onDismissNotice: () => setNotice('') };

  if (page === 'Análises') return <FkShell {...shell} footer={analyses.length + ' análises guardadas • Actualização automática a cada 5 minutos'}>
    <PageHeader emoji="📊" title="Análises" subtitle="Relatórios preparados e guardados no Supabase"
      board={[[analyses.length, analyses.length === 1 ? 'Relatório' : 'Relatórios']]}/>
    {analysesLoading ? <EmptyPanel emoji="⏳" title="A carregar análises…"/> :
      analyses.length ? <section className="fk-reference-grid fk-two">{analyses.map(row => <AnalysisCard key={row.id} row={row}/>)}</section> :
      <EmptyPanel emoji="📊" title="Ainda não existem análises guardadas" detail="Depois da recolha diária das odds, as análises aprovadas aparecem automaticamente aqui."/>}
  </FkShell>;

  if (page === 'Acompanhamento ao vivo') {
    const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const ticketTeams = new Set(todayTickets.flatMap(t => (t.legs || []).flatMap(l => [norm(l.home), norm(l.away)])).filter(Boolean));
    const fromTickets = g => ticketTeams.has(norm(g.home_team)) || ticketTeams.has(norm(g.away_team));
    const terms = norm(gameQuery).split(' ').filter(Boolean);
    const visible = liveGames.filter(g => (gameScope === 'todos' || fromTickets(g)) &&
      (!terms.length || terms.every(term => norm([g.home_team, g.away_team, g.competition, g.country].join(' ')).includes(term))));
    const nowLive = visible.filter(gameIsLive);
    const done = visible.filter(gameIsFinished).sort((a, b) => Date.parse(b.finished_at || b.kickoff_at) - Date.parse(a.finished_at || a.kickoff_at));
    const fast = fastLiveRef.current || liveGamesFastRef.current;
    const latest = liveGames.reduce((m, g) => Math.max(m, Date.parse(g.updated_at) || 0), 0);
    const filtered = Boolean(terms.length) || gameScope !== 'todos';
    return <FkShell {...shell} footer={liveGames.filter(gameIsLive).length + ' em directo • ' + liveGames.filter(gameIsFinished).length + ' terminados nas últimas 36 h'}>
      <PageHeader emoji="📡" title="Ao vivo" subtitle="Todos os jogos em directo agora e os que já terminaram"
        board={[[liveGames.filter(gameIsLive).length, 'Ao vivo', true], [liveGames.filter(gameIsFinished).length, 'Terminados']]}/>
      <div className="fk-reference-note"><Radio size={15}/><span>{fast ? 'Actualização a cada minuto.' : 'Sem jogos em directo agora: actualização a cada 5 minutos.'}{latest ? ' Última recolha: ' + new Date(latest).toLocaleTimeString('pt-AO') + '.' : ''} Toca num jogo para ver as estatísticas. O acompanhamento de cada ficha está em «Bilhetes do dia».</span></div>
      <div className="fk-live-tools">
        <label className="fk-reference-search"><Search size={16}/><input value={gameQuery} onChange={e => setGameQuery(e.target.value)} placeholder="Pesquisar equipa, competição ou país…" aria-label="Pesquisar jogos"/></label>
        <div className="fk-live-chips" role="group" aria-label="Filtro">
          <button className={gameScope === 'todos' ? 'is-on' : ''} onClick={() => setGameScope('todos')}>Todos</button>
          <button className={gameScope === 'fichas' ? 'is-on' : ''} onClick={() => setGameScope('fichas')}>Jogos das minhas fichas</button>
        </div>
      </div>
      <LiveGamesSection title="Em directo" games={nowLive} empty={filtered ? 'Nenhum jogo em directo corresponde ao filtro.' : 'Nenhum jogo em directo neste momento.'}/>
      <LiveGamesSection title="Terminados" games={done} empty={filtered ? 'Nenhum jogo terminado corresponde ao filtro.' : 'Ainda não há jogos terminados registados.'} finished/>
    </FkShell>;
  }

  return <FkShell {...shell} footer={filteredHistory.length + ' de ' + history.length + ' fichas no histórico'}>
    <PageHeader emoji="📋" title="Histórico" subtitle="Fichas e resultados de dias anteriores"
      board={[[history.length, history.length === 1 ? 'Ficha' : 'Fichas']]}/>
    <label className="fk-reference-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar por ficha, ID ou casa…" aria-label="Pesquisar no histórico"/></label>
    {filteredHistory.length ? <section className="fk-reference-grid">
      {filteredHistory.map(t => <DailyTicketCard key={t.id} ticket={t} expanded={!!expanded[t.id]} onToggle={() => toggle(t.id)}/>)}
    </section> : <EmptyPanel emoji="📋" title="Ainda não há histórico" detail={query ? 'Nenhuma ficha corresponde à pesquisa.' : 'As fichas concluídas serão arquivadas aqui para consulta.'}/>}
  </FkShell>;
}

function groupBookmakerPairs(tickets) {
  const groups = new Map();
  // Fichas antigas não têm shared_ticket_id: junta as das duas casas pelo dia, tipo e conjunto de jogos.
  const legacyKey = ticket => {
    const sig = (ticket.legs || []).map(l => [l.home, l.away, l.selection].join('~')).sort().join('|');
    if (!ticket.bookmaker || !sig) return ticket.id;
    return 'legacy:' + String(ticket.createdAt || '').slice(0, 10) + ':' + ticket.type + ':' + sig;
  };
  for (const ticket of tickets) {
    let key = ticket.sharedTicketId && ticket.sharedTicketId !== ticket.id ? ticket.sharedTicketId : legacyKey(ticket);
    if ((groups.get(key) || []).some(other => other.bookmaker && other.bookmaker === ticket.bookmaker)) key = key + '#' + ticket.id;
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

const NAV_SHORT = { 'Bilhetes do dia': 'Bilhetes', 'Análises': 'Análises', 'Acompanhamento ao vivo': 'Ao vivo', 'Histórico': 'Histórico' };
const tone = cls => ({ 'state-good': 'won', 'state-bad': 'lost', 'state-live': 'live' }[cls] || 'pending');
const crest = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2);
  return letters.toUpperCase();
};

function FkShell({ page, onNavigate, liveCount = 0, notice, onDismissNotice, footer, children }) {
  return <main className="fk-reference-home">
    <div className="fk-reference-pitch" aria-hidden="true"/>
    <nav className="fk-reference-nav" aria-label="Navegação principal">
      <span className="fk-reference-logo"><b>FK</b><i>.</i><small>Ficha Kamba</small></span>
      <div className="fk-reference-tabs">
        {NAV.map(([label, Icon]) => <button key={label} title={label}
          className={label === page ? 'is-active' : ''}
          aria-current={label === page ? 'page' : undefined}
          onClick={() => onNavigate(label)}>
          <Icon size={16}/><span>{NAV_SHORT[label] || label}</span>
          {label === 'Acompanhamento ao vivo' && liveCount > 0 && <em>{liveCount}</em>}
        </button>)}
      </div>
    </nav>
    {children}
    {notice && <div className="fk-reference-notice" role="status"><ShieldCheck size={16}/><span>{notice}</span><button onClick={onDismissNotice} aria-label="Fechar aviso"><X size={15}/></button></div>}
    <footer className="fk-reference-footer"><span><i/> {footer}</span></footer>
  </main>;
}

function PageHeader({ emoji, title, subtitle, board = [] }) {
  return <header className="fk-reference-header">
    <div className="fk-reference-brand">
      <span className="fk-reference-ball" aria-hidden="true">{emoji}</span>
      <div><h1>{title}</h1><p>{subtitle}</p></div>
    </div>
    <div className="fk-reference-board" aria-label="Resumo">
      {board.map(([value, label, live]) => <div key={label} className={live && value > 0 ? 'is-live' : ''}><strong>{value}</strong><span>{label}</span></div>)}
    </div>
  </header>;
}

function EmptyPanel({ emoji, title, detail }) {
  return <section className="fk-reference-empty"><span>{emoji}</span><b>{title}</b>{detail && <small>{detail}</small>}</section>;
}

function DailyHome({ tickets, expanded, onToggle, notice, onDismissNotice, onNavigate, liveCount = 0, ticketLiveCount = 0 }) {
  const total = tickets.length;
  const games = tickets.reduce((n, t) => n + (t.legs || []).length, 0);
  return <FkShell page="Bilhetes do dia" onNavigate={onNavigate} liveCount={liveCount} notice={notice} onDismissNotice={onDismissNotice}
    footer={total + (total === 1 ? ' ficha carregada' : ' fichas carregadas') + ' • Actualização automática a cada 5 minutos'}>
    <PageHeader emoji="⚽" title="Bilhetes do dia"
      subtitle={<>Ficha Kamba <i>•</i> {new Date().toLocaleDateString('pt-AO')}</>}
      board={[[total, total === 1 ? 'Ficha' : 'Fichas'], [games, games === 1 ? 'Jogo' : 'Jogos'], [ticketLiveCount, 'Ao vivo', true]]}/>
    {total ? <section className="fk-reference-grid">
      {tickets.map((ticket, index) => <DailyTicketCard key={ticket.id} ticket={ticket}
        expanded={!!expanded[ticket.id]} onToggle={() => onToggle(ticket.id)} featured={index === 0}/>)}
    </section> : <EmptyPanel emoji="⚽" title="Nenhuma ficha publicada hoje" detail="As fichas reais aparecerão aqui assim que forem publicadas."/>}
  </FkShell>;
}

const gameIsFinished = g => /^(FT|AET|PENS)$/i.test(g.status);
const gameIsLive = g => !gameIsFinished(g) && /^(1H|2H|HT|ET|LIVE)$/i.test(g.status);
const gameLabel = g => /^HT$/i.test(g.status) ? 'INTERVALO' : /^(AET)$/i.test(g.status) ? 'FIM (prol.)' : /^PENS$/i.test(g.status) ? 'FIM (pen.)' : gameIsFinished(g) ? 'FIM' : g.minute ? g.minute + "'" : 'AO VIVO';

const GAME_STATS = [
  ['Posse de bola (%)', 'possession'], ['Remates', 'shots'], ['Remates à baliza', 'shots_on_target'], ['Remates fora', 'shots_off_target'],
  ['Cantos', 'corners'], ['Faltas', 'fouls'], ['Cartões amarelos', 'yellow_cards'], ['Cartões vermelhos', 'red_cards'],
  ['Defesas', 'saves'], ['Desarmes', 'tackles'], ['Passes', 'total_passes'], ['Passes certos', 'accurate_passes']
];
const EVENT_ICON = { goal: '⚽', yellow_card: '🟨', red_card: '🟥', second_yellow: '🟥', substitution: '🔁' };
const EVENT_NAME = { goal: 'Golo', yellow_card: 'Cartão amarelo', red_card: 'Cartão vermelho', second_yellow: 'Segundo amarelo', substitution: 'Substituição' };

function LiveGameRow({ game: g, finished }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(null);
  useEffect(() => {
    if (!open || !supabase) return undefined;
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('live_games').select('stats,events,details_at').eq('sofascore_id', g.sofascore_id).maybeSingle();
      if (active) setDetails(data || {});
    };
    load();
    const timer = finished ? null : window.setInterval(load, 60000);
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [open, g.sofascore_id, finished]);
  const rows = GAME_STATS.map(([label, key]) => ({ label, home: details?.stats?.home?.[key], away: details?.stats?.away?.[key] }))
    .filter(r => r.home != null || r.away != null);
  const events = Array.isArray(details?.events) ? details.events.filter(e => e.event_type !== 'substitution') : [];
  return <div className={'fk-live-item' + (open ? ' is-open' : '')}>
    <button className={'fk-live-game' + (finished ? '' : ' is-live')} onClick={() => setOpen(o => !o)} aria-expanded={open}>
      <span className="fk-live-team">{g.home_team}</span>
      <b className="fk-live-score">{g.home_score ?? '-'} : {g.away_score ?? '-'}</b>
      <span className="fk-live-team is-away">{g.away_team}</span>
      <small className="fk-live-min">{gameLabel(g)}</small>
    </button>
    {open && <div className="fk-live-details">
      {details === null ? <p className="fk-live-empty">A carregar…</p> : <>
        {events.length > 0 && <div className="fk-live-events">{events.map((e, i) => <div key={i} className={'is-' + (e.team_side || 'none')}>
          <i>{EVENT_ICON[e.event_type] || '•'}</i><b>{e.minute != null ? e.minute + "'" : ''}</b>
          <span>{e.player_name || EVENT_NAME[e.event_type]}{e.team_side ? ' · ' + (e.team_side === 'home' ? g.home_team : g.away_team) : ''}</span>
        </div>)}</div>}
        {rows.length > 0 ? <div className="fk-live-stats">{rows.map(r => <div key={r.label}><b>{r.home ?? '–'}</b><small>{r.label}</small><b>{r.away ?? '–'}</b></div>)}</div>
          : <p className="fk-live-empty">{details.details_at ? 'A fonte não tem estatísticas para este jogo (comum em ligas pequenas).' : 'Estatísticas ainda por recolher: aparecem dentro de alguns minutos.'}</p>}
        {details.details_at && <small className="fk-live-stamp">Estatísticas de {new Date(details.details_at).toLocaleTimeString('pt-AO')}</small>}
      </>}
    </div>}
  </div>;
}

function LiveGamesSection({ title, games, empty, finished = false }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const g of games) {
      const key = (g.country ? g.country + ' · ' : '') + (g.competition || 'Competição não indicada');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt'));
  }, [games]);
  return <section className="fk-live-section">
    <h2 className="fk-live-title">{title} <small>{games.length}</small></h2>
    {groups.length ? groups.map(([name, rows]) => <div className="fk-live-league" key={name}>
      <h3>{name}</h3>
      {rows.map(g => <LiveGameRow key={g.sofascore_id} game={g} finished={finished}/>)}
    </div>) : <p className="fk-live-empty">{empty}</p>}
  </section>;
}

function DailyTicketCard({ ticket: t, expanded, onToggle, featured = false }) {
  const legs = t.legs || [];
  const entries = t.bookmakerEntries || [];
  const status = ticketStatus(t);
  const state = tone(ticketStatusClass(status));
  const liveCount = legs.filter(isLive).length;
  const bookmaker = t.bookmaker || (entries.length ? entries.map(e => e.bookmaker).join(' / ') : 'Casa de apostas');
  const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-AO') : new Date().toLocaleDateString('pt-AO');
  const bestOdd = entries.length ? Math.max(...entries.map(e => Number(e.totalOdds) || 0)) : Number(t.totalOdds) || 0;
  return <article className={'fk-reference-ticket is-' + state + (featured ? ' is-featured' : '')}>
    <div className="fk-reference-watermark" aria-hidden="true">⚽</div>
    <button className="fk-reference-ticket-main" onClick={onToggle} aria-expanded={expanded}>
      <div className="fk-reference-ticket-top">
        <span><b>{bookmaker}</b><i> — {date}</i></span>
        <em className="fk-reference-chip">{liveCount > 0 && <i/>}{status}</em>
      </div>
      <div className="fk-reference-total"><small>{entries.length > 1 ? 'Melhor odd combinada' : 'Odd combinada'}</small>{money(bestOdd)}</div>
      {entries.length > 1 && <div className="fk-reference-books">
        {entries.map(e => <span key={e.bookmaker} className={(Number(e.totalOdds) || 0) === bestOdd ? 'is-best' : ''}>{e.bookmaker}<b>{money(e.totalOdds)}</b></span>)}
      </div>}
      <div className="fk-reference-picks">
        {legs.map((leg, index) => <div className="fk-reference-pick" key={leg.id || index}>
          <span className={'dot is-' + tone(resultClass(leg))} aria-hidden="true"/>
          <span>{leg.selection || leg.market || (leg.home && leg.away ? leg.home + ' vs ' + leg.away : 'Selecção')}</span>
          <b>{money(leg.odd)}</b>
        </div>)}
        {!legs.length && <div className="fk-reference-pick"><span>Selecções ainda não disponíveis</span><b>—</b></div>}
      </div>
      <div className="fk-reference-ticket-foot">{legs.length} selecções <span>•</span> {entries.length ? entries.length + ' casas' : (t.bookingId ? 'Reserva: ' + t.bookingId : 'Reserva pendente')}</div>
      <span className="fk-reference-expand">{expanded ? 'FECHAR DETALHES' : 'VER DETALHES'} <ChevronDown size={13}/></span>
    </button>
    {expanded && <div className="fk-reference-expanded">
      {legs.map((leg, index) => {
        const score = matchScore(leg);
        const live = isLive(leg);
        const done = isFinished(leg);
        return <div className="fk-reference-leg" key={leg.id || index}>
          <div className="fk-reference-fixture">
            <div className="fk-reference-team"><span className="fk-reference-crest" aria-hidden="true">{crest(leg.home)}</span><span>{leg.home || '—'}</span></div>
            {score
              ? <div className={'fk-reference-score' + (live ? ' is-live' : '')}>{score}<small>{live ? (leg.minute ? leg.minute + "'" : 'AO VIVO') : done ? 'FIM' : ''}</small></div>
              : <div className="fk-reference-score vs">VS</div>}
            <div className="fk-reference-team away"><span className="fk-reference-crest" aria-hidden="true">{crest(leg.away)}</span><span>{leg.away || '—'}</span></div>
          </div>
          <div className="fk-reference-leg-meta">
            <span>{leg.league || 'Competição não indicada'}{leg.date ? ' · ' + new Date(leg.date).toLocaleString('pt-AO') : ''}</span>
            <span>{leg.market || 'Mercado'}: <b>{leg.selection || '—'}</b> · Odd <b>{money(leg.odd)}</b></span>
            <em className="fk-reference-chip" style={{ '--tone': { won: 'var(--fkh-win)', lost: '#6b7a90', live: 'var(--fkh-goal)', pending: 'var(--fkh-gold)' }[tone(resultClass(leg))] }}>{resultLabel(leg)}</em>
          </div>
          {Array.isArray(leg.matchEvents) && leg.matchEvents.length > 0
            ? <div className="fk-reference-events">{leg.matchEvents.map((event, i) => <div key={i} className={'is-' + (event.side || 'none')}>
                <i>{event.type === 'red_card' || event.type === 'second_yellow' ? '🟥' : '⚽'}</i>
                <b>{event.minute != null ? event.minute + "'" : ''}</b>
                <span>{event.player || (event.type === 'goal' ? 'Golo' : 'Expulsão')}{event.side ? ' · ' + (event.side === 'home' ? leg.home : leg.away) : ''}</span>
              </div>)}</div>
            : leg.lastEvent && <small className="note">{leg.lastEvent}</small>}
          {(live || done) && liveStatRows(leg).length > 0 && <div className="fk-reference-stats">
            {liveStatRows(leg).map(row => <div key={row.label}><b>{row.home}</b><small>{row.label}</small><b>{row.away}</b></div>)}
          </div>}
          {leg.rationale && <small className="note">{leg.rationale}</small>}
        </div>;
      })}
      {entries.map(entry => <div className="fk-reference-booking" key={entry.bookmaker}><span>{entry.bookmaker}</span><b>Odd {money(entry.totalOdds)}</b><strong>{entry.bookingId || 'Reserva pendente'}</strong>{entry.bookingUrl && <a href={entry.bookingUrl} target="_blank" rel="noreferrer">Abrir reserva</a>}</div>)}
      {!entries.length && <div className="fk-reference-booking"><span>Referência de reserva</span><strong>{t.bookingId || 'A aguardar'}</strong>{t.bookingUrl && <a href={t.bookingUrl} target="_blank" rel="noreferrer">Abrir reserva</a>}</div>}
    </div>}
  </article>;
}

function AnalysisCard({ row }) {
  const match = row.matches || {};
  const report = row.analysis || {};
  const selections = Array.isArray(report.selections) ? report.selections : [];
  const num = value => {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null;
    return Math.abs(n) <= 1 ? n * 100 : n;
  };
  const pct = value => { const n = num(value); return n === null ? '—' : n.toFixed(1) + '%'; };
  const risks = Array.isArray(report.riskFlags) ? report.riskFlags : [];
  const sources = Array.isArray(report.sources) ? report.sources : [];
  return <article className="fk-reference-ticket fk-analysis is-pending">
    <div className="fk-reference-ticket-main" style={{ cursor: 'default' }}>
      <div className="fk-reference-ticket-top">
        <span><b>{match.competition || 'Competição não indicada'}</b><i> — {match.kickoff_at ? new Date(match.kickoff_at).toLocaleString('pt-AO') : 'Data não indicada'}</i></span>
        <em className="fk-reference-chip">{row.status === 'ready' ? 'Concluída' : row.status}</em>
      </div>
      <div className="fk-reference-fixture" style={{ margin: '14px 0 10px' }}>
        <div className="fk-reference-team"><span className="fk-reference-crest" aria-hidden="true">{crest(match.home_team)}</span><span>{match.home_team || 'Equipa da casa'}</span></div>
        <div className="fk-reference-score vs">VS</div>
        <div className="fk-reference-team away"><span className="fk-reference-crest" aria-hidden="true">{crest(match.away_team)}</span><span>{match.away_team || 'Equipa visitante'}</span></div>
      </div>
      {(row.summary || report.verdict) && <p className="fk-analysis-verdict">{row.summary || report.verdict}</p>}
      {selections.length > 0 ? <div className="fk-analysis-picks">
        {selections.map((pick, index) => {
          const prob = num(pick.probability ?? pick.estimatedProbability);
          return <div className="fk-analysis-pick" key={pick.id || index}>
            <div className="fk-analysis-pick-head">
              <span>{pick.market || 'Mercado'} · <b>{pick.selection || 'Selecção'}</b></span>
              <strong>{pick.bestOdds ?? pick.odds ?? '—'}</strong>
            </div>
            {prob !== null && <div className="fk-analysis-bar" aria-label={'Probabilidade ' + prob.toFixed(1) + '%'}><i style={{ width: Math.max(0, Math.min(100, prob)) + '%' }}/></div>}
            <div className="fk-analysis-meta">
              <span>Prob. <b>{pct(pick.probability ?? pick.estimatedProbability)}</b></span>
              <span>Edge <b>{pct(pick.edge)}</b></span>
              <span>Valor esp. <b>{pct(pick.expectedValue)}</b></span>
              {pick.bestBookmaker && <span>Melhor cotação <b>{pick.bestBookmaker}</b></span>}
              {pick.confidence && <span>Confiança <b>{pick.confidence}</b></span>}
            </div>
            {pick.rationale && <small className="note">{pick.rationale}</small>}
          </div>;
        })}
      </div> : <small className="note">Relatório sem selecções recomendadas. Consulta os fundamentos e os riscos no relatório completo.</small>}
      {risks.length > 0 && <div className="fk-analysis-risks">{risks.map((r, i) => <span key={i}>⚠ {typeof r === 'string' ? r : JSON.stringify(r)}</span>)}</div>}
      {sources.length > 0 && <div className="fk-analysis-sources">Fontes: {sources.map((source, index) => <React.Fragment key={source.url || index}>{index > 0 ? ' · ' : ''}{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name || source.url}</a> : source.name || 'Fonte não identificada'}</React.Fragment>)}</div>}
      <div className="fk-reference-ticket-foot">{row.provider || 'ChatGPT'}{row.model ? ' · ' + row.model : ''} <span>•</span> {row.generated_at ? new Date(row.generated_at).toLocaleString('pt-AO') : '—'}</div>
    </div>
  </article>;
}
