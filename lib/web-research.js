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
    let url;
    try { url = new URL(urlString); } catch (_) { reject(new Error('URL inválida.')); return; }
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method:'GET', timeout:timeoutMs,
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36 NexaAI/1.3',
        'Accept':'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language':'en-US,en;q=0.8,es;q=0.7',
        'Cache-Control':'no-cache',
        ...headers,
      },
    }, res=>{
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && redirects>0) {
        res.resume();
        const next = new URL(res.headers.location,url).toString();
        fetchText(next,{timeoutMs,maxBytes,redirects:redirects-1,headers}).then(resolve,reject); return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return;
      }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      const chunks=[]; let size=0; let aborted=false;
      res.on('data',chunk=>{
        if (aborted) return;
        size+=chunk.length;
        if(size<=maxBytes) chunks.push(chunk);
        else { aborted=true; req.destroy(new Error('Respuesta web demasiado grande.')); }
      });
      res.on('end',()=>{ if(!aborted) resolve({ url:url.toString(), contentType:type, text:Buffer.concat(chunks).toString('utf8') }); });
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
    if (!/duckduckgo\.com$/i.test(u.hostname) && !/\.duckduckgo\.com$/i.test(u.hostname)) return safeUrl(u.toString());
  } catch (_) {}
  return '';
}

function dedupeResults(results, maxResults) {
  const seen=new Set();
  const output=[];
  for (const item of results || []) {
    const url = safeUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({ title:String(item.title||domainOf(url)||url).trim(), url, snippet:String(item.snippet||'').trim(), domain:domainOf(url), provider:item.provider||'' });
    if (output.length >= maxResults) break;
  }
  return output;
}

function parseDuckDuckGoHtml(html, maxResults=10) {
  const results=[];
  const regex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match=regex.exec(html)) && results.length<maxResults*3) {
    const url = unwrapDuckDuckGo(match[1]);
    const title = stripTags(match[2]);
    if (!url || !title) continue;
    const block = html.slice(match.index, Math.min(html.length, match.index+4000));
    const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    results.push({ title, url, snippet:snippetMatch?stripTags(snippetMatch[1]):'', provider:'DuckDuckGo HTML' });
  }
  return dedupeResults(results,maxResults);
}

function parseDuckDuckGoLite(html, maxResults=10) {
  const results=[];
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match=regex.exec(html)) && results.length<maxResults*5) {
    const raw = decodeHtml(match[1]);
    const url = unwrapDuckDuckGo(raw) || safeUrl(raw);
    const title = stripTags(match[2]);
    if (!url || !title || /duckduckgo/i.test(domainOf(url))) continue;
    const block = html.slice(match.index, Math.min(html.length, match.index+2500));
    const snippetMatch = block.match(/<td[^>]+class=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    results.push({ title, url, snippet:snippetMatch?stripTags(snippetMatch[1]):'', provider:'DuckDuckGo Lite' });
  }
  return dedupeResults(results,maxResults);
}

function xmlValue(block, tag) {
  const pattern = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const match = String(block||'').match(pattern);
  return match ? stripTags(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')) : '';
}

function parseBingRss(xml, maxResults=10) {
  const results=[];
  const itemRegex=/<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match=itemRegex.exec(xml)) && results.length<maxResults*3) {
    const block=match[1];
    const url=safeUrl(xmlValue(block,'link'));
    const title=xmlValue(block,'title');
    const snippet=xmlValue(block,'description');
    if (!url || !title) continue;
    results.push({ title, url, snippet, provider:'Bing RSS' });
  }
  return dedupeResults(results,maxResults);
}

function parseBingHtml(html, maxResults=10) {
  const results=[];
  const algo=/<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match=algo.exec(html)) && results.length<maxResults*3) {
    const block=match[1];
    const anchor=block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const url=safeUrl(decodeHtml(anchor[1]));
    const title=stripTags(anchor[2]);
    if (!url || !title) continue;
    const snippetMatch=block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push({ title, url, snippet:snippetMatch?stripTags(snippetMatch[1]):'', provider:'Bing HTML' });
  }
  return dedupeResults(results,maxResults);
}

async function duckDuckGoSearch(query, maxResults=10) {
  const endpoint = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const response = await fetchText(endpoint,{timeoutMs:15000,maxBytes:1200000,headers:{'Referer':'https://duckduckgo.com/'}});
  return parseDuckDuckGoHtml(response.text,maxResults);
}
async function duckDuckGoLiteSearch(query, maxResults=10) {
  const endpoint = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query);
  const response = await fetchText(endpoint,{timeoutMs:15000,maxBytes:1200000,headers:{'Referer':'https://duckduckgo.com/'}});
  return parseDuckDuckGoLite(response.text,maxResults);
}
async function bingRssSearch(query, maxResults=10) {
  const endpoint = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query);
  const response = await fetchText(endpoint,{timeoutMs:15000,maxBytes:1200000,headers:{'Accept':'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'}});
  return parseBingRss(response.text,maxResults);
}
async function bingHtmlSearch(query, maxResults=10) {
  const endpoint = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=en-US';
  const response = await fetchText(endpoint,{timeoutMs:15000,maxBytes:1400000,headers:{'Referer':'https://www.bing.com/'}});
  return parseBingHtml(response.text,maxResults);
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

async function searchProviders(query, maxResults) {
  const providers = [
    ['DuckDuckGo HTML', duckDuckGoSearch],
    ['DuckDuckGo Lite', duckDuckGoLiteSearch],
    ['Bing RSS', bingRssSearch],
    ['Bing HTML', bingHtmlSearch],
  ];
  const merged=[];
  const diagnostics=[];
  for (const [name, fn] of providers) {
    try {
      const results=await fn(query,maxResults);
      diagnostics.push({ provider:name, ok:true, count:results.length, error:'' });
      merged.push(...results);
      if (dedupeResults(merged,maxResults).length>=maxResults) break;
    } catch (error) {
      diagnostics.push({ provider:name, ok:false, count:0, error:String(error && error.message || error) });
    }
  }
  return { results:dedupeResults(merged,maxResults), diagnostics };
}

async function gatherSources(objective, topic, { maxSources=5, queryOverride='' } = {}) {
  const query = queryOverride || buildResearchQuery(objective, topic);
  const queries = [query];
  if (objective && objective.type === 'automotive') {
    queries.push(query + ' site:nhtsa.gov');
    queries.push(query + ' official OEM technical service manual');
  }
  const merged=[];
  const providerDiagnostics=[];
  for (const candidate of queries) {
    const result=await searchProviders(candidate,Math.max(maxSources*2,8));
    merged.push(...result.results);
    for (const item of result.diagnostics) providerDiagnostics.push({ query:candidate, ...item });
    if (dedupeResults(merged,maxSources*3).length>=maxSources*2) break;
  }
  const unique=dedupeResults(merged,Math.max(maxSources*4,20));
  if (!unique.length) {
    const compact=providerDiagnostics.slice(0,12).map(item=>{
      const state=item.ok ? ('0 resultados') : (item.error || 'error desconocido');
      return item.provider + ': ' + state;
    });
    const detail=compact.length ? ' ' + compact.join(' | ') : '';
    throw new Error('No fue posible obtener resultados de los proveedores web.' + detail);
  }
  const ranked = unique.map(r=>({ ...r, ...sourceType(r.url,objective && objective.make || '') })).sort((a,b)=>b.score-a.score);
  const gathered=[];
  for (const item of ranked) {
    if (gathered.length>=maxSources) break;
    let pageText=''; let pageTitle=item.title; let pageError='';
    try {
      const page = await fetchText(item.url,{timeoutMs:12000,maxBytes:1200000});
      if (/text\/html|application\/xhtml/.test(page.contentType) || !page.contentType) {
        const titleMatch = page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) pageTitle = stripTags(titleMatch[1]).slice(0,500) || pageTitle;
        pageText = stripTags(page.text).slice(0,14000);
      } else if (/text\/plain|json|xml/.test(page.contentType)) pageText = String(page.text||'').replace(/\s+/g,' ').slice(0,14000);
    } catch (error) { pageError=String(error && error.message || error); }
    gathered.push({ ...item, title:pageTitle, text:pageText || item.snippet, pageError, sourceType:item.type, sourceScore:item.score, accessDate:new Date().toISOString() });
  }
  return { query, results:gathered, providerDiagnostics };
}

module.exports = {
  fetchText, duckDuckGoSearch, duckDuckGoLiteSearch, bingRssSearch, bingHtmlSearch,
  gatherSources, searchProviders, sourceType, objectiveDescriptor, buildResearchQuery,
  stripTags, domainOf, parseDuckDuckGoHtml, parseDuckDuckGoLite, parseBingRss, parseBingHtml,
};
