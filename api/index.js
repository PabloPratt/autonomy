const BACKEND = 'https://mswszuvtffztattslfzg.supabase.co/functions/v1/autonomy';
module.exports = async function(req,res) {
  if(process.env.AUTONOMY_BACKEND!=='legacy')return require('../cloud/shared').makeSharedBackend(process.env)(req,res);
  res.setHeader('Cache-Control','no-store');
  try {
    const source=new URL(req.url,'https://autonomy-wheat.vercel.app');
    const route=req.query?.route||source.searchParams.get('route');
    if(route&&!/^[a-z0-9/_-]{1,100}$/i.test(route))throw Error('Invalid route');
    const url=new URL(BACKEND);url.search=source.search;url.searchParams.delete('route');url.searchParams.set('path',route?'/api/'+route:source.pathname);
    const headers={'content-type':'application/json','x-autonomy-client':req.headers['x-autonomy-client']||''};
    if(req.headers.cookie)headers.cookie=req.headers.cookie;
    if(req.headers.origin)headers.origin=req.headers.origin;
    const response=await fetch(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body||{}),signal:AbortSignal.timeout(55000)});
    for(const name of ['content-type','content-disposition'])if(response.headers.has(name))res.setHeader(name,response.headers.get(name));
    const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
    res.statusCode=response.status;res.end(await response.text());
  } catch {res.statusCode=502;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'The cloud service is temporarily unavailable. Your last saved household data is preserved.'}));}
};
