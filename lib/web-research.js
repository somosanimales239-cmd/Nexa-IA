'use strict';

const http = require('http');
const https = require('https');

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&nbsp;/gi,' ')
    .replace(/&#(\d+);/g, (_,n)=>String.fromCharCode(Number(n)||32));
}
function stripTags(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<[^>]+>/g,' '))
    .replace(/\s+/g,' ').trim();
}
function domainOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./,''); } catch (_) { return ''; } }
function safeUrl(value) { try { const u=new URL(value); return ['http:','https:'].includes(u.protocol) ? u.toString() : ''; } catch (_) { return ''; } }

function fetchText(urlString, { timeoutMs=12000, maxBytes=1400000, redirects=4, headers={} } = {}) {
  return new Promise((resolve,reject)=>{
    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method:'GET', timeout:timeoutMs,
      headers:{ 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 NexaAI/1.3', 'Accept':'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language':'en-US,en;q=0.8,es;q=0.7', ...headers },
    }, res=>{
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && redirects>0) {
        res.resume();
        const next = new URL(res.headers.location,url).toString();
        fetchText(next,{timeoutMs,maxBytes,redirects:redirects-1,headers}).then(resolve,reject); return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      const chunks=[]; let size=0;
      res.on('data',chunk=>{ size+=chunk.length; if(size<=maxBytes) chunks.push(chunk); else req.destroy(new Error('Respuesta web demasiado grande.')); });
      res.on('end',()=>resolve({ url:url.toString(), contentType:type, text:Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout',()=>req.destroy(new Error('Tiempo de espera web agotado.')));
    req.on('error',reject); req.end();
  });
}

function sourceType(url, make='') {
  const domain = domainOf(url);
  const lowerMake = String(make||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const officialMaps = {
    toyota:['toyota.com','techinfo.toyota.com'], lexus:['lexus.com','techinfo.toyota.com'], honda:['honda.com','techinfo.honda.com'],
    acura:['acura.com','techinfo.honda.com'], ford:['ford.com','motorcraftservice.com'], chevrolet:['chevrolet.com','gm.com','gsi.ext.gm.com'],
    gmc:['gmc.com','gm.com','gsi.ext.gm.com'], nissan:['nissanusa.com','nissan-techinfo.com'], infiniti:['infinitiusa.com','nissan-techinfo.com'],
    bmw:['bmw.com','bmwtechinfo.bmwgroup.com'], mercedesbenz:['mercedes-benz.com'], hyundai:['hyundai.com','hyundaitechinfo.com'],
    kia:['kia.com','kiatechinfo.com'], subaru:['subaru.com','techinfo.subaru.com'], mazda:['mazdausa.com'], volkswagen:['vw.com','erwin.vw.com'],
  };
  const candidates = officialMaps[lowerMake] || [];
  if (candidates.some(d => domain===d || domain.endsWith('.'+d))) return { type:'OEM', score:100 };
  if (domain==='nhtsa.gov' || domain.endsWith('.nhtsa.gov') || domain==='safercar.gov' || domain.endsWith('.gov')) return { type:'Government', score:92 };
  if (/alldata|mitchell1|identifix|motor\.com|sae\.org|i-car\.com|bosch|denso|ngk|delphiautoparts|gates/.test(domain)) return { type:'Technical', score:78 };
  if (/reddit|forum|club|facebook|youtube|youtu\.be|tiktok/.test(domain)) return { type:'Secondary', score:42 };
  return { type:'Technical', score:62 };
}

function unwrapDuckDuckGo(href) {
  const candidate = decodeHtml(href);
  try {
    const u = new URL(candidate, 'https://duckduckgo.com');
    const wrapped = u.searchParams.get('uddg');
    if (wrapped) return safeUrl(decodeURIComponent(wrapped));
    if (u.hostname !== 'duckduckgo.com' && u.hostname !== 'html.duckduckgo.com') return safeUrl(u.toString());
  } catch (_) {}
  return '';
}

async function duckDuckGoSearch(query, maxResults=10) {
  const endpoint = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const response = await fetchText(endpoint,{timeoutMs:15000,maxBytes:1200000,headers:{'Referer':'https://duckduckgo.com/'}});
  const html = response.text;
  const results=[];
  const regex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match=regex.exec(html)) && results.length<maxResults*2) {
    const url = unwrapDuckDuckGo(match[1]);
    const title = stripTags(match[2]);
    if (!url || !title) continue;
    const block = html.slice(match.index, Math.min(html.length, match.index+3500));
    const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    results.push({ title, url, snippet:snippetMatch?stripTags(snippetMatch[1]):'', domain:domainOf(url) });
  }
  const seen=new Set();
  return results.filter(r=>{ if(seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0,maxResults);
}

function objectiveDescriptor(objective) {
  if (!objective) return '';
  if (objective.type !== 'automotive') return [objective.name,objective.category,objective.description].filter(Boolean).join(' ');
  return [objective.make,objective.model,objective.year,objective.generation,objective.trim,objective.engine_code,objective.engine_displacement,objective.transmission,objective.market].filter(Boolean).join(' ');
}

function buildResearchQuery(objective, topic, extra='') {
  const descriptor = objectiveDescriptor(objective);
  return [descriptor, topic, extra].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
}

async function gatherSources(objective, topic, { maxSources=5, queryOverride='' } = {}) {
  const query = queryOverride || buildResearchQuery(objective, topic);
  const queries = [query];
  if (objective?.type === 'automotive') {
    queries.push(query + ' site:nhtsa.gov');
    queries.push(query + ' official OEM technical service manual');
  }
  const merged = [];
  for (const candidate of queries) {
    try { merged.push(...await duckDuckGoSearch(candidate, Math.max(maxSources * 2, 8))); } catch (_) {}
  }
  const unique = [];
  const seen = new Set();
  for (const item of merged) { if (!seen.has(item.url)) { seen.add(item.url); unique.push(item); } }
  if (!unique.length) throw new Error('No fue posible obtener resultados del proveedor de búsqueda web.');
  const ranked = unique.map(r=>({ ...r, ...sourceType(r.url,objective?.make||'') })).sort((a,b)=>b.score-a.score);
  const gathered=[];
  for (const item of ranked) {
    if (gathered.length>=maxSources) break;
    let pageText=''; let pageTitle=item.title;
    try {
      const page = await fetchText(item.url,{timeoutMs:12000,maxBytes:1200000});
      if (/text\/html|application\/xhtml/.test(page.contentType) || !page.contentType) {
        const titleMatch = page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) pageTitle = stripTags(titleMatch[1]).slice(0,500) || pageTitle;
        pageText = stripTags(page.text).slice(0,14000);
      } else if (/text\/plain|json/.test(page.contentType)) pageText = String(page.text||'').replace(/\s+/g,' ').slice(0,14000);
    } catch (_) {}
    gathered.push({ ...item, title:pageTitle, text:pageText || item.snippet, sourceType:item.type, sourceScore:item.score, accessDate:new Date().toISOString() });
  }
  return { query, results:gathered };
}

module.exports = { fetchText, duckDuckGoSearch, gatherSources, sourceType, objectiveDescriptor, buildResearchQuery, stripTags, domainOf };
