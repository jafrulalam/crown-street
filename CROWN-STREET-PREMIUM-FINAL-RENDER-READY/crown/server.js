const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {URL}=require('url');
const ROOT=__dirname, PUBLIC=path.join(ROOT,'public');
// Load .env without an extra dependency. Keep Supabase secrets server-side only.
try { for (const line of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)) { const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if(m && !m[1].startsWith('#') && process.env[m[1]]===undefined) process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2'); } } catch {}
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
let dbState=null, writeQueue=Promise.resolve();
const PORT=Number(process.env.PORT||3000);
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||'admin@crownstreet.local').toLowerCase();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'ChangeMe123!';
const RAZORPAY_KEY_ID=process.env.RAZORPAY_KEY_ID||'';
const RAZORPAY_KEY_SECRET=process.env.RAZORPAY_KEY_SECRET||'';
function razorpayAuth(){return 'Basic '+Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}
async function razorpayRequest(endpoint,method='GET',data){const r=await fetch('https://api.razorpay.com/v1'+endpoint,{method,headers:{Authorization:razorpayAuth(),'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.description||`Razorpay request failed (${r.status})`);return d}
function prepareOrderItems(db,items){if(!Array.isArray(items)||!items.length)throw new Error('Your cart is empty.');const lines=[];let subtotal=0;for(const item of items){const product=db.products.find(x=>x.id===String(item.productId)&&x.active!==false);const qty=Math.max(1,Math.min(20,Number(item.quantity)||1));if(!product)throw new Error('A product in your cart is unavailable.');if(!Array.isArray(product.sizes)||!product.sizes.includes(String(item.size)))throw new Error(`Choose a valid size for ${product.name}.`);if(product.stock<qty)throw new Error(`Only ${product.stock} unit(s) of ${product.name} remain in stock.`);lines.push({productId:product.id,name:product.name,price:product.price,quantity:qty,size:String(item.size),image:product.image});subtotal+=product.price*qty;}const quantities={};for(const line of lines)quantities[line.productId]=(quantities[line.productId]||0)+line.quantity;for(const [id,qty] of Object.entries(quantities)){const pr=db.products.find(x=>x.id===id);if(!pr||pr.stock<qty)throw new Error(`Not enough stock for ${pr?.name||'a product'}.`);}const delivery=subtotal>=999?0:60;return {lines,subtotal,delivery,total:subtotal+delivery};}
function safeCompareHex(a,b){try{const x=Buffer.from(String(a),'hex'),y=Buffer.from(String(b),'hex');return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)}catch{return false}}
const sessions=new Map();
const productsSeed=[
{id:'tee-classic',name:'Crown Classic Tee',category:'T-Shirts',price:499,mrp:999,color:'#252a4d',description:'Everyday premium cotton T-shirt with a clean streetwear fit.',sizes:['S','M','L','XL','XXL'],stock:42,rating:4.8,image:'',active:true},
{id:'tee-logo',name:'Street Logo Tee',category:'T-Shirts',price:549,mrp:1099,color:'#c9a227',description:'Signature CROWN STREET logo tee for daily wear.',sizes:['S','M','L','XL','XXL'],stock:35,rating:4.7,image:'',active:true},
{id:'tee-oversized',name:'Oversized Drop-Shoulder Tee',category:'Oversized',price:799,mrp:1499,color:'#d9c9a6',description:'Relaxed oversized fit with a premium heavyweight feel.',sizes:['S','M','L','XL','XXL'],stock:27,rating:4.9,image:'',active:true},
{id:'polo-crown',name:'Crown Polo',category:'Polos',price:699,mrp:1299,color:'#1b1f3b',description:'Smart-casual polo for a clean elevated look.',sizes:['S','M','L','XL'],stock:24,rating:4.6,image:'',active:true}
];
function hash(pw,salt=crypto.randomBytes(16).toString('hex')){return {salt,hash:crypto.scryptSync(pw,salt,64).toString('hex')}}
function equal(a,b){const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function normalizeDB(d){if(!d||typeof d!=='object')d={};if(!Array.isArray(d.users))d.users=[];if(!Array.isArray(d.products))d.products=[];if(!Array.isArray(d.orders))d.orders=[];if(!Array.isArray(d.pendingPayments))d.pendingPayments=[];if(!Number.isFinite(d.nextOrder))d.nextOrder=1001;return d}
function readDB(){return normalizeDB(dbState)}
async function supabaseRequest(method,body){
 const response=await fetch(`${SUPABASE_URL}/rest/v1/store_state?on_conflict=id`,{method,headers:{'apikey':SUPABASE_SERVICE_ROLE_KEY,'Authorization':`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok){const detail=await response.text();throw new Error(`Supabase database request failed (${response.status}): ${detail}`)}
 return response.status===204?null:response.json().catch(()=>null);
}
async function writeDB(d){dbState=normalizeDB(d);const snapshot=JSON.parse(JSON.stringify(dbState));writeQueue=writeQueue.then(()=>supabaseRequest('POST',{id:'main',data:snapshot}));await writeQueue;return dbState}
async function init(){
 if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)throw new Error('Supabase settings missing. Copy .env.example to .env and add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
 const response=await fetch(`${SUPABASE_URL}/rest/v1/store_state?id=eq.main&select=data`,{headers:{'apikey':SUPABASE_SERVICE_ROLE_KEY,'Authorization':`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`}});
 if(!response.ok)throw new Error(`Could not read Supabase database (${response.status}): ${await response.text()}`);
 const rows=await response.json();
 if(rows.length){dbState=normalizeDB(rows[0].data);if(!dbState.products.length){dbState.products=productsSeed.map(x=>({...x}));await writeDB(dbState)}}
 else {const a=hash(ADMIN_PASSWORD);dbState={users:[{id:'admin',name:'CROWN STREET Admin',email:ADMIN_EMAIL,role:'admin',...a,createdAt:new Date().toISOString()}],products:productsSeed.map(x=>({...x})),orders:[],pendingPayments:[],nextOrder:1001};await writeDB(dbState)}
 console.log('Supabase database connected and store data loaded.');
}
function json(res,status,data){const b=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(b),'X-Content-Type-Options':'nosniff'});res.end(b)}
function cookie(req){const c=req.headers.cookie||'';const m=c.match(/(?:^|;\s*)cs_session=([^;]+)/);return m?decodeURIComponent(m[1]):''}
function userFor(req){const s=sessions.get(cookie(req));if(!s||s.expires<Date.now()){if(s)sessions.delete(cookie(req));return null}return readDB().users.find(u=>u.id===s.userId)||null}
function safeUser(u){return u?{id:u.id,name:u.name,email:u.email,role:u.role,createdAt:u.createdAt}:null}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>1e6){reject(new Error('Body too large'));req.destroy()}});req.on('end',()=>{if(!raw)return resolve({});try{resolve(JSON.parse(raw))}catch{reject(new Error('Invalid JSON'))}});req.on('error',reject)})}
function cleanProduct(p){return {id:p.id,name:p.name,category:p.category,price:p.price,mrp:p.mrp,color:p.color,description:p.description,sizes:p.sizes,stock:p.stock,rating:p.rating,image:p.image,active:p.active!==false}}
function publicProduct(p){return cleanProduct(p)}
async function route(req,res){const url=new URL(req.url,'http://localhost');const p=url.pathname;const method=req.method;let db=readDB();
 if(p.startsWith('/api/')){
  if(method==='GET'&&p==='/api/health')return json(res,200,{ok:true,service:'CROWN STREET API',time:new Date().toISOString()});
  if(method==='GET'&&p==='/api/products'){if(!Array.isArray(db.products)||db.products.length===0){db.products=productsSeed.map(x=>({...x}));await writeDB(db)}return json(res,200,{products:db.products.filter(x=>x.active!==false).map(publicProduct)});}
  if(method==='GET'&&p==='/api/me'){const u=userFor(req);return json(res,200,{user:safeUser(u)})}
  if(method==='POST'&&p==='/api/auth/register'){
   const b=await body(req);const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
   if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json(res,400,{error:'Enter your name, a valid email, and password with at least 8 characters.'});
   if(db.users.some(u=>u.email===email))return json(res,409,{error:'An account with this email already exists.'});const h=hash(password);const u={id:crypto.randomUUID(),name,email,role:'customer',...h,createdAt:new Date().toISOString()};db.users.push(u);await writeDB(db);const sid=crypto.randomBytes(32).toString('hex');sessions.set(sid,{userId:u.id,expires:Date.now()+7*864e5});res.setHeader('Set-Cookie',`cs_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7*86400}`);return json(res,201,{user:safeUser(u)});
  }
  if(method==='POST'&&p==='/api/auth/login'){
   const b=await body(req);const email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');const u=db.users.find(x=>x.email===email);if(!u||!equal(hash(password,u.salt).hash,u.hash))return json(res,401,{error:'Email or password is incorrect.'});const sid=crypto.randomBytes(32).toString('hex');sessions.set(sid,{userId:u.id,expires:Date.now()+7*864e5});res.setHeader('Set-Cookie',`cs_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7*86400}`);return json(res,200,{user:safeUser(u)});
  }
  if(method==='POST'&&p==='/api/auth/logout'){sessions.delete(cookie(req));res.setHeader('Set-Cookie','cs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return json(res,200,{ok:true})}
  if(method==='POST'&&p==='/api/auth/forgot'){
   const b=await body(req),email=String(b.email||'').trim().toLowerCase(),u=db.users.find(x=>x.email===email);if(!u)return json(res,200,{message:'If the account exists, reset instructions will be generated.'});const token=crypto.randomBytes(24).toString('hex');u.resetTokenHash=crypto.createHash('sha256').update(token).digest('hex');u.resetExpires=Date.now()+15*60*1000;await writeDB(db);console.log(`Password reset token for ${email}: ${token} (demo only; deliver this through a real email provider in production)`);return json(res,200,{message:'Demo reset token generated. Check the server terminal; production must send this by email.'});
  }
  if(method==='POST'&&p==='/api/auth/reset'){
   const b=await body(req),email=String(b.email||'').trim().toLowerCase(),token=String(b.token||''),password=String(b.password||''),u=db.users.find(x=>x.email===email);if(!u||!u.resetTokenHash||u.resetExpires<Date.now()||!equal(crypto.createHash('sha256').update(token).digest('hex'),u.resetTokenHash))return json(res,400,{error:'Reset token is invalid or expired.'});if(password.length<8)return json(res,400,{error:'Password must be at least 8 characters.'});Object.assign(u,hash(password));delete u.resetTokenHash;delete u.resetExpires;await writeDB(db);return json(res,200,{message:'Password updated. Please log in.'});
  }
  if(method==='POST'&&p==='/api/payments/razorpay/order'){
   const u=userFor(req);if(!u)return json(res,401,{error:'Please sign in before paying.'});
   if(!RAZORPAY_KEY_ID||!RAZORPAY_KEY_SECRET)return json(res,503,{error:'Razorpay is not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server .env file.'});
   const b=await body(req),name=String(b.name||u.name).trim(),phone=String(b.phone||'').trim(),address=String(b.address||'').trim();
   if(!name||!phone||!address)return json(res,400,{error:'Enter your name, phone number and delivery address.'});if(!/^[0-9+() -]{7,18}$/.test(phone))return json(res,400,{error:'Enter a valid phone number.'});
   let calc;try{calc=prepareOrderItems(db,b.items)}catch(e){return json(res,400,{error:e.message})}
   const receipt=('cs_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex')).slice(0,40);
   const rpOrder=await razorpayRequest('/orders','POST',{amount:Math.round(calc.total*100),currency:'INR',receipt,notes:{store:'CROWN STREET',customer_email:u.email}});
   db.pendingPayments.push({razorpayOrderId:rpOrder.id,userId:u.id,name,phone,address,items:calc.lines,subtotal:calc.subtotal,delivery:calc.delivery,total:calc.total,amountPaise:Math.round(calc.total*100),status:'pending',createdAt:new Date().toISOString()});
   await writeDB(db);return json(res,201,{key:RAZORPAY_KEY_ID,orderId:rpOrder.id,amount:rpOrder.amount,currency:rpOrder.currency,name:'CROWN STREET',description:'Clothing order',prefill:{name,email:u.email,contact:phone}});
  }
  if(method==='POST'&&p==='/api/payments/razorpay/verify'){
   const u=userFor(req);if(!u)return json(res,401,{error:'Please sign in before verifying payment.'});
   const b=await body(req),orderId=String(b.razorpay_order_id||''),paymentId=String(b.razorpay_payment_id||''),signature=String(b.razorpay_signature||'');
   if(!orderId||!paymentId||!signature)return json(res,400,{error:'Razorpay payment verification details are incomplete.'});
   const pending=db.pendingPayments.find(x=>x.razorpayOrderId===orderId&&x.userId===u.id);if(!pending)return json(res,404,{error:'Payment session not found. Please try checkout again.'});
   if(pending.status==='completed'&&pending.storeOrderId){const existing=db.orders.find(o=>o.id===pending.storeOrderId);if(existing)return json(res,200,{order:existing,message:'Payment was already verified.'})}
   const expected=crypto.createHmac('sha256',RAZORPAY_KEY_SECRET).update(orderId+'|'+paymentId).digest('hex');if(!safeCompareHex(expected,signature))return json(res,400,{error:'Payment signature verification failed.'});
   const payment=await razorpayRequest('/payments/'+encodeURIComponent(paymentId));
   if(payment.order_id!==orderId||Number(payment.amount)!==pending.amountPaise||payment.currency!=='INR')return json(res,400,{error:'Payment details do not match this order.'});
   if(payment.status!=='captured')return json(res,409,{error:`Payment is not captured yet (status: ${payment.status}). Check Razorpay auto-capture settings, then retry.`});
   db=readDB();const again=db.pendingPayments.find(x=>x.razorpayOrderId===orderId&&x.userId===u.id);if(!again)return json(res,404,{error:'Payment session not found.'});
   const calc=prepareOrderItems(db,again.items);
   if(calc.total!==again.total||Math.round(calc.total*100)!==Number(payment.amount))return json(res,409,{error:'Cart price or stock changed. Contact support before placing another order.'});
   for(const line of calc.lines){const pr=db.products.find(x=>x.id===line.productId);pr.stock-=line.quantity;}
   const now=new Date().toISOString();const order={id:'CS-'+db.nextOrder++,userId:u.id,customerName:again.name,customerEmail:u.email,phone:again.phone,address:again.address,paymentMethod:'Razorpay',paymentStatus:'Paid',razorpayOrderId:orderId,razorpayPaymentId:paymentId,status:'Placed',items:calc.lines,subtotal:calc.subtotal,delivery:calc.delivery,total:calc.total,createdAt:now,updatedAt:now,history:[{status:'Placed',at:now}]};
   db.orders.unshift(order);again.status='completed';again.storeOrderId=order.id;again.razorpayPaymentId=paymentId;again.completedAt=now;await writeDB(db);return json(res,200,{order,message:'Payment verified and order placed successfully.'});
  }
  if(method==='POST'&&p==='/api/orders'){
   const u=userFor(req);if(!u)return json(res,401,{error:'Please sign in before placing an order.'});const b=await body(req);const items=Array.isArray(b.items)?b.items:[];const name=String(b.name||u.name).trim(),phone=String(b.phone||'').trim(),address=String(b.address||'').trim(),payment=String(b.payment||'COD');if(!items.length||!phone||!address)return json(res,400,{error:'Add products, a contact number and delivery address.'});if(!/^[0-9+() -]{7,18}$/.test(phone))return json(res,400,{error:'Enter a valid phone number.'});
   const lines=[];let subtotal=0;for(const item of items){const product=db.products.find(x=>x.id===String(item.productId)&&x.active!==false);const qty=Math.max(1,Math.min(20,Number(item.quantity)||1));if(!product)return json(res,400,{error:'A product in your cart is unavailable.'});if(!product.sizes.includes(String(item.size)))return json(res,400,{error:`Choose a valid size for ${product.name}.`});if(product.stock<qty)return json(res,409,{error:`Only ${product.stock} unit(s) of ${product.name} remain in stock.`});lines.push({productId:product.id,name:product.name,price:product.price,quantity:qty,size:String(item.size),image:product.image});subtotal+=product.price*qty;}
   const quantities={};for(const line of lines)quantities[line.productId]=(quantities[line.productId]||0)+line.quantity;for(const [productId,qty] of Object.entries(quantities)){const product=db.products.find(x=>x.id===productId);if(!product||product.stock<qty)return json(res,409,{error:`Not enough stock for ${product?.name||'a product'}.`});}
   const delivery=subtotal>=999?0:60,total=subtotal+delivery;
   for(const line of lines){const pr=db.products.find(x=>x.id===line.productId);pr.stock-=line.quantity;}const order={id:'CS-'+db.nextOrder++,userId:u.id,customerName:name,customerEmail:u.email,phone,address,paymentMethod:payment,paymentStatus:payment==='COD'?'Pay on delivery':'Pending gateway setup',status:'Placed',items:lines,subtotal,delivery,total,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),history:[{status:'Placed',at:new Date().toISOString()}]};db.orders.unshift(order);await writeDB(db);return json(res,201,{order});
  }
  if(method==='GET'&&p==='/api/orders'){const u=userFor(req);if(!u)return json(res,401,{error:'Please sign in.'});return json(res,200,{orders:db.orders.filter(o=>o.userId===u.id)})}
  if(method==='POST'&&p.startsWith('/api/orders/')&&p.endsWith('/cancel')){const u=userFor(req);if(!u)return json(res,401,{error:'Please sign in to cancel an order.'});const id=decodeURIComponent(p.slice('/api/orders/'.length,-'/cancel'.length));const o=db.orders.find(x=>x.id===id&&x.userId===u.id);if(!o)return json(res,404,{error:'Order not found.'});if(!['Placed','Confirmed'].includes(o.status))return json(res,409,{error:'This order can no longer be cancelled online. Please contact support.'});o.status='Cancelled';o.updatedAt=new Date().toISOString();o.history.push({status:'Cancelled',at:o.updatedAt});for(const line of o.items){const pr=db.products.find(x=>x.id===line.productId);if(pr)pr.stock+=line.quantity;}await writeDB(db);return json(res,200,{order:o,message:'Order cancelled successfully. Stock has been restored.'});}
  if(method==='GET'&&p.startsWith('/api/orders/')){const u=userFor(req);if(!u)return json(res,401,{error:'Please sign in.'});const o=db.orders.find(x=>x.id===decodeURIComponent(p.split('/').pop())&&(x.userId===u.id||u.role==='admin'));return o?json(res,200,{order:o}):json(res,404,{error:'Order not found.'})}
  const u=userFor(req);if(p.startsWith('/api/admin/')){if(!u||u.role!=='admin')return json(res,403,{error:'Admin sign-in required.'});db=readDB();
   if(method==='GET'&&p==='/api/admin/summary')return json(res,200,{users:db.users.filter(x=>x.role==='customer').length,orders:db.orders.length,sales:db.orders.filter(o=>!['Cancelled','Refunded'].includes(o.status)).reduce((s,o)=>s+o.total,0),pending:db.orders.filter(o=>!['Delivered','Cancelled','Refunded'].includes(o.status)).length,lowStock:db.products.filter(x=>x.stock<5).length});
   if(method==='GET'&&p==='/api/admin/orders')return json(res,200,{orders:db.orders});
   if(method==='PATCH'&&p.startsWith('/api/admin/orders/')){const id=decodeURIComponent(p.split('/').pop()),b=await body(req),o=db.orders.find(x=>x.id===id);if(!o)return json(res,404,{error:'Order not found.'});const allowed=['Confirmed','Packed','Shipped','Out for Delivery','Delivered','Cancelled','Refunded'];if(!allowed.includes(b.status))return json(res,400,{error:'Invalid order status.'});if(o.status==='Cancelled'||o.status==='Refunded')return json(res,409,{error:'A closed order cannot be changed.'});o.status=b.status;o.updatedAt=new Date().toISOString();o.history.push({status:o.status,at:o.updatedAt});if(o.status==='Cancelled'){for(const line of o.items){const pr=db.products.find(x=>x.id===line.productId);if(pr)pr.stock+=line.quantity;}}await writeDB(db);return json(res,200,{order:o});}
   if(method==='POST'&&p==='/api/admin/products'){const b=await body(req);const name=String(b.name||'').trim(),price=Number(b.price),stock=Number(b.stock);if(!name||!Number.isFinite(price)||price<1||!Number.isInteger(stock)||stock<0)return json(res,400,{error:'Product name, valid price and stock are required.'});const product={id:crypto.randomUUID(),name,category:String(b.category||'Clothing'),price,mrp:Math.max(price,Number(b.mrp)||price),color:String(b.color||'#c9a227'),description:String(b.description||''),sizes:Array.isArray(b.sizes)&&b.sizes.length?b.sizes:['S','M','L','XL'],stock,rating:5,image:String(b.image||''),active:true};db.products.push(product);await writeDB(db);return json(res,201,{product});}
   if(method==='PATCH'&&p.startsWith('/api/admin/products/')){const id=decodeURIComponent(p.split('/').pop()),b=await body(req),pr=db.products.find(x=>x.id===id);if(!pr)return json(res,404,{error:'Product not found.'});for(const k of ['name','category','description','image','color'])if(b[k]!==undefined)pr[k]=String(b[k]);for(const k of ['price','mrp','stock'])if(b[k]!==undefined&&Number.isFinite(Number(b[k]))&&Number(b[k])>=0)pr[k]=Number(b[k]);if(b.sizes!==undefined&&Array.isArray(b.sizes))pr.sizes=b.sizes;if(b.active!==undefined)pr.active=!!b.active;await writeDB(db);return json(res,200,{product:pr});}
   if(method==='DELETE'&&p.startsWith('/api/admin/products/')){const id=decodeURIComponent(p.split('/').pop()),pr=db.products.find(x=>x.id===id);if(!pr)return json(res,404,{error:'Product not found.'});pr.active=false;await writeDB(db);return json(res,200,{ok:true});}
   return json(res,404,{error:'Admin API route not found.'});
  }
  return json(res,404,{error:'API route not found.'});
 }
 let file=p==='/'?path.join(PUBLIC,'index.html'):path.resolve(PUBLIC,'.'+p);if(!file.startsWith(PUBLIC+path.sep)&&file!==path.join(PUBLIC,'index.html'))return json(res,403,{error:'Forbidden'});try{const st=fs.statSync(file);if(st.isDirectory())file=path.join(file,'index.html');const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.txt':'text/plain; charset=utf-8'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res)}catch{return json(res,404,{error:'File not found.'})}
}
init().then(()=>http.createServer((req,res)=>route(req,res).catch(e=>{console.error(e);if(!res.headersSent)json(res,500,{error:'Server error. Check terminal logs.'})})).listen(PORT,()=>console.log(`CROWN STREET running at http://localhost:${PORT}\nAdmin email: ${ADMIN_EMAIL}\nSet ADMIN_PASSWORD in .env before first setup. Default demo admin password: ${ADMIN_PASSWORD}`))).catch(e=>{console.error('STARTUP FAILED:',e.message);process.exit(1)});
