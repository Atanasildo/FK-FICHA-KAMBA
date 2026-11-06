import React, { useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, ChevronRight, Clock3, FileText, History, LayoutDashboard, Radio, RefreshCw, Settings, ShieldCheck, Ticket, Trophy, Download, Bell, Menu, X } from 'lucide-react';

const NAV = [['Boletins do dia', LayoutDashboard], ['Acompanhamento ao vivo', Activity], ['Histórico', History], ['Definições', Settings]];
const STORE = 'fk-ficha-kamba-v1';
const money = n => Number(n || 0).toFixed(2);
const readStore = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || { games: [], tickets: [], bookmaker: 'BantuBet Angola' }; }
  catch { return { games: [], tickets: [], bookmaker: 'BantuBet Angola' }; }
};
const isToday = value => value && new Date(value).toDateString() === new Date().toDateString();
const isLive = leg => ['IN_PLAY', 'LIVE', 'PAUSED', '1H', '2H', 'HT'].includes(String(leg.matchStatus || leg.status || '').toUpperCase()) || Boolean(leg.live);
const resultLabel = leg => leg.marketStatus || leg.result || (isLive(leg) ? 'Em directo' : 'Por iniciar');
const resultClass = leg => {
  const s = String(resultLabel(leg)).toLowerCase();
  if (s.includes('ganh') || s.includes('favor')) return 'state-good';
  if (s.includes('perd') || s.includes('risco') || s.includes('desfavor')) return 'state-bad';
  if (s.includes('direct') || s.includes('live')) return 'state-live';
  return 'state-pending';
};

export default function App() {
  const [page, setPage] = useState('Boletins do dia');
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
      <div className="content"><div className="welcome"><div><div className="eyebrow"><span className="status-dot"/> FICHA KAMBA</div><h1>{page}</h1><p>{page === 'Boletins do dia' ? 'Consulta as fichas preparadas e publicadas para hoje.' : page === 'Acompanhamento ao vivo' ? 'Acompanha os jogos e mercados das tuas fichas em curso.' : page === 'Histórico' ? 'Consulta fichas e resultados de dias anteriores.' : 'Preferências e dados da tua conta.'}</p></div></div>
        {notice && <div className="notice"><ShieldCheck size={17}/><span>{notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}
        {page === 'Boletins do dia' && <>
          <div className="daily-summary"><div className="daily-icon"><Ticket size={21}/></div><div><b>{todayTickets.length} {todayTickets.length === 1 ? 'ficha publicada' : 'fichas publicadas'} hoje</b><span>As fichas do dia, os IDs de reserva e todos os jogos ficam reunidos aqui.</span></div><div className="daily-date">{new Date().toLocaleDateString('pt-AO')}</div></div>
          {todayTickets.length ? <div className="daily-ticket-list">{todayTickets.map(t => <TicketPanel key={t.id} ticket={t} expanded={!!expanded[t.id]} onToggle={() => toggle(t.id)}/>)}</div> : <EmptyState icon={FileText} title="Ainda não há fichas publicadas para hoje" detail="As fichas aparecerão automaticamente aqui quando o serviço de análise e publicação da IA estiver ligado. Não são apresentados palpites ou IDs de reserva inventados."/>}
          <div className="quiet-note"><ShieldCheck size={16}/><span>Esta área é apenas de consulta. A elaboração das fichas é uma tarefa interna do sistema.</span></div>
        </>}
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
        {isLive(leg) && <div className="live-score-strip"><Radio size={15}/><b>{leg.homeScore ?? leg.score?.home ?? '—'} : {leg.awayScore ?? leg.score?.away ?? '—'}</b><span>{leg.minute ? leg.minute + "'" : leg.matchStatus || 'Em directo'}</span>{leg.lastEvent && <small>{leg.lastEvent}</small>}</div>}
        {leg.marketUpdate && <p className="market-update">{leg.marketUpdate}</p>}
      </article>) : <p className="muted-copy">Os jogos desta ficha serão apresentados aqui quando forem publicados.</p>}
      <div className="ticket-detail-footer"><span>IDENTIFICADOR DE RESERVA</span><b>{t.bookingId || 'Ainda não disponibilizado'}</b></div>
    </div>}
  </section>;
}

function EmptyState({ icon: Icon, title, detail }) { return <div className="empty-state"><div className="empty-state-icon"><Icon size={23}/></div><b>{title}</b><span>{detail}</span></div>; }
