const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const proxy=require('./api/index');
const files={'/':'platform.html','/index.html':'platform.html','/platform.html':'platform.html','/platform.js':'platform.js','/platform.css':'platform.css','/finance.js':'finance.js'};
http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')){res.writeHead(403);res.end('Invalid host');return;}
 if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host){res.writeHead(403);res.end('Invalid origin');return;}
 const route=new URL(req.url,'http://localhost').pathname;
 if(route.startsWith('/api/')){
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1800000){res.writeHead(413);res.end();return;}}
  try{req.body=raw?JSON.parse(raw):{};}catch{res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"Invalid JSON"}');return;}
  // The local origin has already been checked; proxy the same cloud API contract.
  req.headers.origin='https://autonomy-wheat.vercel.app';return proxy(req,res);
 }
 if(!files[route]||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end('Not found');return;}
 const file=files[route];res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
 res.end(req.method==='HEAD'?undefined:fs.readFileSync(path.join(__dirname,file)));
}).listen(Number(process.env.PORT||8081),'127.0.0.1',()=>console.log('AUTONOMY cloud platform: http://127.0.0.1:'+(process.env.PORT||8081)));
