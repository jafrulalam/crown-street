const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://localhost:3000';
async function request(route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
(async () => {
  let passed = 0;
  const check = (condition, message) => { assert.ok(condition, message); console.log('PASS', message); passed++; };

  let r = await request('/api/health');
  check(r.status === 200 && r.data.ok, 'health endpoint');
  r = await request('/');
  check(r.status === 200 && String(r.data).includes('CROWN STREET'), 'store homepage served');
  r = await request('/api/products');
  check(r.status === 200 && r.data.products.length >= 4, 'four starter products available');
  r = await request('/api/admin/orders');
  check(r.status === 403, 'admin API blocks anonymous access');

  const email = `test-${Date.now()}@example.test`;
  r = await request('/api/auth/register', { method: 'POST', body: { name: 'Test Customer', email, password: 'TestPass123!' } });
  check(r.status === 201 && r.data.user.role === 'customer' && r.cookie, 'customer registration and session cookie');
  let cookie = r.cookie;
  r = await request('/api/auth/register', { method: 'POST', body: { name: 'Test Customer', email, password: 'TestPass123!' } });
  check(r.status === 409, 'duplicate customer registration rejected');
  await request('/api/auth/logout', { method: 'POST', cookie });
  r = await request('/api/auth/login', { method: 'POST', body: { email, password: 'TestPass123!' } });
  check(r.status === 200 && r.data.user.role === 'customer' && r.cookie, 'customer login');
  cookie = r.cookie;
  r = await request('/api/auth/login', { method: 'POST', body: { email, password: 'WrongPassword!' } });
  check(r.status === 401, 'incorrect password rejected');
  r = await request('/api/orders', { cookie });
  check(r.status === 200 && Array.isArray(r.data.orders), 'authenticated customer order history');

  const p = (await request('/api/products')).data.products.find(product => product.stock > 0);
  const originalStock = p.stock;
  const size = p.sizes[0];
  r = await request('/api/orders', { method: 'POST', cookie, body: { name: 'Test Customer', phone: '9876543210', address: 'Test address, Silchar, Assam 788001', payment: 'COD', items: [{ productId: p.id, size, quantity: 1 }] } });
  check(r.status === 201 && r.data.order.items.length === 1, 'place order with server-side price and stock validation');
  check(r.data.order.subtotal === p.price && r.data.order.delivery === (p.price >= 999 ? 0 : 60) && r.data.order.total === r.data.order.subtotal + r.data.order.delivery, 'order total includes correct delivery fee');
  const orderId = r.data.order.id;
  r = await request('/api/orders', { cookie });
  check(r.status === 200 && r.data.orders.some(order => order.id === orderId), 'order appears in customer history');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@crownstreet.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  r = await request('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  check(r.status === 200 && r.data.user.role === 'admin' && r.cookie, 'admin login');
  const adminCookie = r.cookie;
  r = await request('/api/admin/orders');
  check(r.status === 403, 'admin orders remain protected without admin session');
  r = await request('/api/admin/orders', { cookie: adminCookie });
  check(r.status === 200 && r.data.orders.some(order => order.id === orderId), 'admin can see customer order');
  r = await request('/api/admin/orders/' + encodeURIComponent(orderId), { method: 'PATCH', cookie: adminCookie, body: { status: 'Confirmed' } });
  check(r.status === 200 && r.data.order.status === 'Confirmed', 'admin can update order status');
  r = await request('/api/orders/' + encodeURIComponent(orderId) + '/cancel', { method: 'POST', cookie, body: {} });
  check(r.status === 200 && r.data.order.status === 'Cancelled', 'customer can cancel their placed/confirmed order');
  const stockAfterCancel = (await request('/api/products')).data.products.find(product => product.id === p.id).stock;
  check(stockAfterCancel === originalStock, 'cancellation restores reserved product stock');
  r = await request('/api/orders', { cookie });
  check(r.status === 200 && r.data.orders.some(order => order.id === orderId && order.status === 'Cancelled'), 'cancelled status appears in customer order history');
  r = await request('/api/orders/' + encodeURIComponent(orderId) + '/cancel', { method: 'POST', cookie, body: {} });
  check(r.status === 409, 'duplicate cancellation is rejected and cannot restock twice');
  const anotherEmail = `other-${Date.now()}@example.test`;
  let other = await request('/api/auth/register', { method: 'POST', body: { name: 'Other Customer', email: anotherEmail, password: 'OtherPass123!' } });
  r = await request('/api/orders/' + encodeURIComponent(orderId) + '/cancel', { method: 'POST', cookie: other.cookie, body: {} });
  check(r.status === 404, 'customer cannot cancel an order owned by another account');

  r = await request('/api/admin/products', { method: 'POST', cookie: adminCookie, body: { name: 'QA Test Product', category: 'T-Shirts', price: 299, mrp: 499, stock: 3, sizes: ['S', 'M'] } });
  check(r.status === 201 && r.data.product.name === 'QA Test Product', 'admin can create product');
  const newProductId = r.data.product.id;
  r = await request('/api/admin/products/' + encodeURIComponent(newProductId), { method: 'PATCH', cookie: adminCookie, body: { price: 349, stock: 5 } });
  check(r.status === 200 && r.data.product.price === 349 && r.data.product.stock === 5, 'admin can edit product price and stock');
  r = await request('/api/admin/products/' + encodeURIComponent(newProductId), { method: 'DELETE', cookie: adminCookie });
  check(r.status === 200, 'admin can archive product');
  r = await request('/api/products');
  check(r.status === 200 && !r.data.products.some(product => product.id === newProductId), 'archived product hidden from storefront');

  r = await request('/api/auth/logout', { method: 'POST', cookie });
  check(r.status === 200, 'customer logout endpoint');
  console.log(`\n${passed} automated checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
