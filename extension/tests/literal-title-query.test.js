import test from 'node:test';
import assert from 'node:assert/strict';
for (const platform of ['extension','vscode-extension']) {
 const {findCitationAtCursor}=await import(`../../${platform}/src/core/citation.js`);
 const {searchBroadCandidatesForSources}=await import(`../../${platform}/src/core/sources.js`);
 for(const searchMode of ['simple','direct']) test(`${platform} ${searchMode} literal titles do not become Crossref authors`,async()=>{
  const source='\\cite{Measuring velocities in nearby stellar systems}';
  const context={...findCitationAtCursor(source,8),searchMode};
  const urls=[];
  await searchBroadCandidatesForSources(context,{contextualSearchEngine:'classic',sourceApiTokens:{}},['crossref'],async input=>{
    urls.push(new URL(input));return new Response(JSON.stringify({message:{items:[]}}),{headers:{'content-type':'application/json'}});
  });
  assert.ok(urls.length>0);
  for(const u of urls){assert.equal(u.searchParams.get('query.title'),context.token);assert.equal(u.searchParams.has('query.author'),false);}
 });
}
