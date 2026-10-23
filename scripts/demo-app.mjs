import {createServer} from 'node:http';

// A small styled demo app used only by scripts/capture-readme-demo.mjs.
// It exists so the README recording shows a realistic page instead of the
// bare-HTML test fixtures. Not part of the product and not used by tests.

const page=(delay)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northwind Console</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c2024;background:#f6f6f4}
  header{display:flex;align-items:center;gap:12px;padding:18px 40px;border-bottom:1px solid #e4e4df;background:#fff}
  .logo{width:30px;height:30px;border-radius:8px;background:#1c2024;color:#fff;display:grid;place-items:center;font-weight:700;font-size:15px}
  .brand{font-weight:650;letter-spacing:-.01em}
  .pill{margin-left:auto;font-size:12.5px;color:#5c6470;border:1px solid #e4e4df;border-radius:999px;padding:5px 12px}
  main{max-width:880px;margin:48px auto;padding:0 24px;display:grid;gap:28px}
  .card{background:#fff;border:1px solid #e4e4df;border-radius:16px;padding:28px;box-shadow:0 1px 2px rgba(20,24,28,.04)}
  h1{margin:0 0 6px;font-size:22px;letter-spacing:-.02em}
  h2{margin:0 0 18px;font-size:15px;font-weight:650;letter-spacing:-.01em}
  p.sub{margin:0 0 22px;color:#5c6470;font-size:14px}
  label{display:block;font-size:13px;font-weight:550;color:#3a414b;margin-bottom:6px}
  input{width:100%;padding:10px 12px;font:inherit;border:1px solid #d8d8d2;border-radius:9px;background:#fbfbfa;margin-bottom:16px}
  input:focus{outline:2px solid #1c2024;outline-offset:1px;background:#fff}
  button{padding:10px 18px;font:inherit;font-weight:600;color:#fff;background:#1c2024;border:0;border-radius:9px;cursor:pointer}
  .alert{margin:16px 0 0;font-size:13.5px;color:#a8402a;background:#fdf0ec;border:1px solid #f3d3ca;border-radius:9px;padding:9px 12px;min-height:38px}
  .alert:empty{visibility:hidden}
  .row{display:flex;gap:12px;align-items:flex-end}
  .row>div{flex:1}
  table{width:100%;border-collapse:collapse;font-size:14px;margin-top:6px}
  th{text-align:left;font-size:12px;font-weight:600;color:#7a828e;text-transform:uppercase;letter-spacing:.04em;padding:0 0 10px}
  td{padding:11px 0;border-top:1px solid #efefea}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  tr[hidden]{display:none}
  .empty{color:#7a828e;font-size:13.5px;padding:14px 0 0}
  .ready{font-size:13px;color:#5c6470}
</style></head><body>
<header><span class="logo">N</span><span class="brand">Northwind Console</span><span class="pill">staging · 127.0.0.1</span></header>
<main>
  <section class="card">
    <h1>Sign in to your workspace</h1>
    <p class="sub">Use the staging test account. Do not use a personal password.</p>
    <form id="login" novalidate>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" placeholder="you@example.com">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" placeholder="••••••••">
      <button type="submit">Log in</button>
      <div class="alert" role="alert"></div>
    </form>
  </section>
  <section class="card">
    <h2>Inventory</h2>
    <div class="row">
      <div><label for="search">Search products</label><input id="search" placeholder="Try “mug”"></div>
      <div><label for="category">Category</label>
        <select id="category" style="width:100%;padding:10px 12px;font:inherit;border:1px solid #d8d8d2;border-radius:9px;background:#fbfbfa;margin-bottom:16px">
          <option value="">All categories</option><option>Home</option><option>Outdoor</option>
        </select>
      </div>
    </div>
    <table>
      <thead><tr><th>Product</th><th>Category</th><th class="num">Stock</th></tr></thead>
      <tbody id="rows">
        <tr data-category="Home"><td>Blue Mug</td><td>Home</td><td class="num">128</td></tr>
        <tr data-category="Home"><td>Linen Apron</td><td>Home</td><td class="num">41</td></tr>
        <tr data-category="Outdoor"><td>Trail Bottle</td><td>Outdoor</td><td class="num">76</td></tr>
        <tr data-category="Outdoor"><td>Canvas Tote</td><td>Outdoor</td><td class="num">54</td></tr>
      </tbody>
    </table>
    <div class="empty" id="empty" hidden>No products match this filter.</div>
    <p class="ready" id="ready">Loading workspace…</p>
  </section>
</main>
<script>
  const wait=Number(new URL(location.href).searchParams.get('delay')??0);
  setTimeout(()=>{document.querySelector('#ready').textContent='Workspace ready';},Math.max(0,wait));
  document.querySelector('#login').onsubmit=event=>{
    event.preventDefault();
    const password=document.querySelector('#password').value;
    document.querySelector('[role=alert]').textContent=password==='correct-password'?'Signed in':'Invalid password';
  };
  const filter=()=>{
    const query=document.querySelector('#search').value.toLowerCase();
    const category=document.querySelector('#category').value;
    let shown=0;
    document.querySelectorAll('#rows tr').forEach(row=>{
      const match=row.textContent.toLowerCase().includes(query)&&(!category||row.dataset.category===category);
      row.hidden=!match;
      if(match)shown++;
    });
    document.querySelector('#empty').hidden=shown>0;
  };
  document.querySelector('#search').oninput=filter;
  document.querySelector('#category').onchange=filter;
</script></body></html>`;

export async function demoApp(){
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const url=new URL(req.url,'http://127.0.0.1');
    res.end(page(url.searchParams.get('delay')??0));
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const url=`http://127.0.0.1:${server.address().port}`;
  return {url,close:async()=>{server.closeAllConnections();await new Promise(ok=>server.close(ok));}};
}
