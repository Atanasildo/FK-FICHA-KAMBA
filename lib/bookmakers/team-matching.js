const STOP = new Set(["fc","cf","sc","ac","club","de","da","do","the","football","futebol"]);
const ALIASES = new Map([
  ["utd","united"],["united","united"],["munchen","munich"],["muenchen","munich"],
  ["ath","athletic"],["athletico","atletico"],["sportingcp","sportinglisbon"],
  ["intermilan","inter"],["internazionale","inter"],["psg","parissaintgermain"],
  ["manutd","manchesterunited"],["manunited","manchesterunited"],
  ["man city","manchestercity"],["mancity","manchestercity"],
  ["spurs","tottenhamhotspur"],["bayern","bayern munich"],
  ["barca","barcelona"],["real","realmadrid"]
]);
function norm(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim();
}
function tokens(value) {
  const raw=norm(value).split(/\s+/).filter(Boolean);
  const joined=raw.join("");
  const alias=ALIASES.get(joined);
  const expanded=alias ? alias.split(" ") : raw;
  return expanded.filter(t=>!STOP.has(t));
}
function tokenMatch(a,b) {
  return a===b || (Math.min(a.length,b.length)>=3 && (a.startsWith(b)||b.startsWith(a)));
}
export function teamNameSimilarity(a,b) {
  const aa=tokens(a), bb=tokens(b);
  if(!aa.length||!bb.length) return 0;
  const used=new Set(); let matched=0;
  for(const x of aa){
    const idx=bb.findIndex((y,i)=>!used.has(i)&&tokenMatch(x,y));
    if(idx>=0){used.add(idx);matched++;}
  }
  const coverage=matched/Math.max(aa.length,bb.length);
  const acronymA=aa.map(x=>x[0]).join("");
  const acronymB=bb.map(x=>x[0]).join("");
  if(acronymA===acronymB && aa.length>1 && bb.length>1) return Math.max(coverage,0.9);
  return coverage;
}
export function teamsSameFixture(a,b,{threshold=0.8}={}) {
  return teamNameSimilarity(a,b)>=threshold;
}
export function selectUniqueTeamFixture(home,away,kickoff,fixtures,{
  claimedIds=new Set(),maxDeltaMs=90*60*1000,threshold=0.8
}={}) {
  const time=Date.parse(kickoff||"");
  if(!Number.isFinite(time)) return null;
  const ranked=(fixtures||[]).filter(f=>!claimedIds.has(String(f.id)))
    .map(f=>{
      const homeScore=teamNameSimilarity(home,f.home_team||f.home);
      const awayScore=teamNameSimilarity(away,f.away_team||f.away);
      const score=(homeScore+awayScore)/2;
      const delta=Math.abs(Date.parse(f.kickoff_at||f.kickoff||"")-time);
      return {fixture:f,score,delta,homeScore,awayScore};
    })
    .filter(x=>Number.isFinite(x.delta)&&x.delta<=maxDeltaMs&&
      x.score>=threshold&&x.homeScore>=threshold&&x.awayScore>=threshold)
    .sort((a,b)=>b.score-a.score||a.delta-b.delta);
  if(!ranked.length) return null;
  if(ranked.length>1 && Math.abs(ranked[0].score-ranked[1].score)<0.04 &&
    Math.abs(ranked[0].delta-ranked[1].delta)<15*60*1000) return null;
  return ranked[0].fixture;
}
