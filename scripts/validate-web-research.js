'use strict';
const assert = require('node:assert/strict');
const research = require('../lib/web-research');

const ddgHtml = '<div><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmanual">Example Manual</a><a class="result__snippet">Useful technical description</a></div>';
const ddg = research.parseDuckDuckGoHtml(ddgHtml, 5);
assert.equal(ddg.length, 1);
assert.equal(ddg[0].url, 'https://example.com/manual');

const rss = '<?xml version="1.0"?><rss><channel><item><title>Example Result</title><link>https://example.org/doc</link><description>Technical result</description></item></channel></rss>';
const bing = research.parseBingRss(rss, 5);
assert.equal(bing.length, 1);
assert.equal(bing[0].url, 'https://example.org/doc');
assert.match(bing[0].snippet, /Technical result/);

const html = '<li class="b_algo"><h2><a href="https://example.net/info">Result Title</a></h2><p>Useful snippet here</p></li>';
const bingHtml = research.parseBingHtml(html, 5);
assert.equal(bingHtml.length, 1);
assert.equal(bingHtml[0].url, 'https://example.net/info');

assert.equal(typeof research.duckDuckGoLiteSearch, 'function');
assert.equal(typeof research.searchProviders, 'function');
console.log('Web research provider validation: PASS');
