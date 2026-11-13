import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, ChevronRight, FileText, History, LayoutDashboard, Radio, ShieldCheck, Ticket, Menu, X } from 'lucide-react';
import { supabase } from './lib/supabase.js';

const NAV = [['Bilhetes do dia', LayoutDashboard], ['Acompanhamento ao vivo', Activity], ['Histórico', History]];
const money = n => Number(n || 0).toFixed(2);
const isToday = value => value && new Date(value).toDateString() === new Date().toDateString();
const matchState = leg => String(leg.matchStatus || leg.status || '').toUpperCase();
const isLive = leg => ['IN_PLAY', 'LIVE', 'PAUSED', '1H', '2H', 'HT', 'FIRST_HALF', 'SECOND_HALF', 'HALF_TIME'].includes(matchState(leg)) || Boolean(leg.live);
const isFinished = leg => ['FINISHED', 'FT', 'FULL_TIME', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT', 'AET', 'PENS'].includes(matchState(leg));
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
  const [data, setData] = useState({ tickets: [] });
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
    const timer = window.setInterval(refreshLive, 180000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const ticketsWithLive = useMemo(() => data.tickets.map(ticket => ({
    ...ticket,
    legs: (ticket.legs || []).map(leg => ({ ...leg, ...(liveUpdates[leg.id] || {}) }))
  })), [data.tickets, liveUpdates]);
  const todayTickets = useMemo(() => ticketsWithLive.filter(t => t.origin === 'ai' && isToday(t.createdAt)), [ticketsWithLive]);
  const liveTickets = useMemo(() => todayTickets.filter(t => t.legs?.some(isLive)), [todayTickets]);
  const history = useMemo(() => ticketsWithLive.filter(t => t.origin !== 'ai' || !isToday(t.createdAt)), [ticketsWithLive]);
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
        {page === 'Acompanhamento ao vivo' && <>
          {liveUpdatedAt && <div className="quiet-note"><Radio size={15}/><span>Marcador a cada 3 minutos · estatísticas em rotação conforme os jogos activos e a quota da fonte · última consulta {new Date(liveUpdatedAt).toLocaleTimeString('pt-AO')}</span></div>}
          {liveTickets.length ? <div className="daily-ticket-list">{liveTickets.map(t => <TicketPanel key={t.id} ticket={t} expanded={expanded[t.id] !== false} onToggle={() => toggle(t.id)} liveView/>)}</div> : <EmptyState icon={Radio} title="Não há jogos em directo nos bilhetes de hoje" detail="Quando uma partida começar, o marcador, minuto e estado do mercado serão apresentados dentro do respectivo bilhete, sempre que a fonte disponibilizar os dados necessários."/>}
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

function ticketStatus(ticket) {
  const legs = ticket.legs || [];
  const outcomes = legs.map(leg => String(leg.marketStatus || leg.result || '').toLowerCase());
  if (outcomes.some(value => value.includes('perdida') || value === 'lost')) return 'Perdida';
  const allSettled = outcomes.length > 0 && outcomes.every(value =>
    value.includes('ganha') || value.includes('linha devolvida') || value === 'won' || value === 'push'
  );
  if (allSettled) return 'Ganha';
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
      <div className="ticket-expand-main"><div className="ticket-title-row"><span className={Number(t.totalOdds) >= 100 ? 'tag tag-gold' : 'tag'}>{t.type || 'FICHA DO DIA'}</span><span className={'ticket-status ' + ticketStatusClass(status)}>{status}</span></div><h3>{t.name || 'Ficha Kamba'}</h3><div className="ticket-subline"><span>{t.id}</span><span>{t.bookmaker || 'Casa de apostas não indicada'}</span><span>{legs.length} jogos</span></div></div>
      <div className="ticket-quick"><small>ODD TOTAL</small><b>{money(t.totalOdds)}</b><span className="reserve-id">Reserva: {t.bookingId || 'A aguardar ID'}</span></div><span className="expand-icon">{expanded ? <ChevronDown/> : <ChevronRight/>}</span>
    </button>
    {expanded && <div className="ticket-details"><div className="details-heading"><b>Jogos e mercados desta ficha</b><span>{liveView ? 'Estado em directo quando disponível' : 'Todas as selecções'}</span></div>
      {legs.length ? legs.map((leg, i) => <article className="match-detail" key={leg.id || i}><div className="match-detail-top"><span className="match-number">JOGO {String(i + 1).padStart(2, '0')}</span><span className={resultClass(leg)}>{resultLabel(leg)}</span></div><div className="match-teams"><b>{leg.home || leg.homeTeam || 'Equipa da casa'} <span>vs</span> {leg.away || leg.awayTeam || 'Equipa visitante'}</b><small>{leg.league || leg.competition || 'Campeonato não indicado'}{leg.date ? ' · ' + new Date(leg.date).toLocaleString('pt-AO') : ''}</small></div>
        <div className="market-detail-grid"><div><small>MERCADO</small><b>{leg.market || 'Mercado'}</b></div><div><small>SELECÇÃO</small><b>{leg.selection || '—'}</b></div><div><small>ODD</small><b>{money(leg.odd)}</b></div></div>
        {(isLive(leg) || isFinished(leg) || matchScore(leg)) && <div className={isLive(leg) ? 'live-score-strip' : 'final-score-strip'}><Radio size={15}/><b>{matchScore(leg) || '— : —'}</b><span>{isLive(leg) ? (leg.minute ? leg.minute + "'" : leg.matchStatus || 'Em directo') : isFinished(leg) ? 'RESULTADO FINAL' : (leg.matchStatus || 'Resultado disponível')}</span>{leg.lastEvent && isLive(leg) && <small>{leg.lastEvent}</small>}</div>}
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
      <div className="ticket-detail-footer"><span>IDENTIFICADOR DE RESERVA</span><b>{t.bookingId || 'Ainda não disponibilizado'}</b>{t.bookingUrl && <a className="reserve-link" href={t.bookingUrl} target="_blank" rel="noreferrer">Abrir boletim reservado</a>}</div>
    </div>}
  </section>;
}

function EmptyState({ icon: Icon, title, detail }) { return <div className="empty-state"><div className="empty-state-icon"><Icon size={23}/></div><b>{title}</b><span>{detail}</span></div>; }

