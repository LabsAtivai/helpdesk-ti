process.env.TZ = 'America/Sao_Paulo'; // Força horário de Brasília

const express    = require('express');
const nodemailer = require('nodemailer');
const multer     = require('multer');
const { v4: uuidv4 } = require('uuid');
const mysql      = require('mysql2/promise');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3098;

// ─── Config TI ────────────────────────────────────────────────────────────
const TI_USER = process.env.TI_USER || 'admin';
const TI_PASS = process.env.TI_PASS || 'ti@ativaai2024';
const APP_URL = process.env.APP_URL || 'https://help.labsativa.com.br';

// ─── Sessões em memória ───────────────────────────────────────────────────
const sessions    = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;

// ─── Pool MySQL ───────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt( process.env.DB_PORT     || '3306'),
  user:               process.env.DB_USER     || 'helpdesk_user',
  password:           process.env.DB_PASS     || '',
  database:           process.env.DB_NAME     || 'helpdesk',
  waitForConnections: true,
  connectionLimit:    10,
  charset:            'utf8mb4',
  timezone:           '-03:00'
});

async function db(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// ─── E-mail ───────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' }
});
const EMAIL_TI   = process.env.EMAIL_TI   || process.env.SMTP_USER || '';
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER || '';

function emailWrap(titulo, corpo) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#1A1816;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="color:white;margin:0;font-size:16px">${titulo}</h2>
    </div>
    <div style="border:1px solid #E2DDD6;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
      ${corpo}
      <p style="font-size:11px;color:#9B968F;margin-top:24px;border-top:1px solid #E2DDD6;padding-top:12px">
        Central TI — <a href="${APP_URL}" style="color:#2563EB">${APP_URL}</a>
      </p>
    </div>
  </div>`;
}
async function mail(to, subject, html) {
  if (!to) return;
  try { await transporter.sendMail({ from: `"Central TI" <${EMAIL_FROM}>`, to, subject, html }); }
  catch(e) { console.warn('E-mail não enviado:', e.message); }
}

// ─── Upload ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + uuidv4().slice(0,8) + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip/.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Tipo não permitido'), ok);
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function hashPass(p) { return crypto.createHash('sha256').update(p + 'helpdesk_salt_2024').digest('hex'); }

function getSession(req) {
  const token = req.headers['x-token'];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(token); return null; }
  return s;
}
function requireUser(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Não autenticado' });
  req.session = s; next();
}
function requireTI(req, res, next) {
  const s = getSession(req);
  if (!s || s.role !== 'ti') return res.status(403).json({ error: 'Acesso negado' });
  req.session = s; next();
}

// ─── Helpers de ticket ────────────────────────────────────────────────────
async function getTicketCompleto(id) {
  const [ticket] = await db('SELECT * FROM tickets WHERE id = ?', [id]);
  if (!ticket) return null;
  ticket.mensagens = await db('SELECT * FROM mensagens WHERE ticket_id = ? ORDER BY enviado_em ASC', [id]);
  ticket.anexos    = await db('SELECT * FROM anexos WHERE ticket_id = ?', [id]);
  // normaliza nomes para o frontend
  ticket.desc             = ticket.descricao;
  ticket.emailSolicitante = ticket.email_solicitante;
  ticket.criadoEm         = ticket.criado_em;
  ticket.atualizadoEm     = ticket.atualizado_em;
  ticket.userId           = ticket.user_id;
  ticket.mensagens        = ticket.mensagens.map(m => ({ ...m, em: m.enviado_em, de: m.de }));
  ticket.anexos           = ticket.anexos.map(a => ({ nome: a.nome_original, arquivo: a.arquivo, tamanho: a.tamanho, tipo: a.tipo }));
  return ticket;
}

async function nextTicketId() {
  await db('UPDATE config SET valor = LPAD(CAST(valor AS UNSIGNED) + 1, 4, "0") WHERE chave = "next_ticket_id"');
  const [row] = await db('SELECT valor FROM config WHERE chave = "next_ticket_id"');
  return String(parseInt(row.valor)).padStart(4, '0');
}

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS — USUÁRIOS
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/users/register', async (req, res) => {
  const { nome, email, senha, depto } = req.body;
  if (!nome || !email || !senha || !depto)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  if (senha.length < 6)
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
  try {
    const existe = await db('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existe.length) return res.status(409).json({ error: 'E-mail já cadastrado' });

    const id = uuidv4();
    await db('INSERT INTO users (id, nome, email, senha, depto) VALUES (?, ?, ?, ?, ?)',
      [id, nome, email.toLowerCase(), hashPass(senha), depto]);

    await mail(email, 'Bem-vindo à Central de TI!', emailWrap('Cadastro realizado ✓', `
      <p>Olá <strong>${nome}</strong>,</p>
      <p style="color:#6B6560;margin-bottom:16px">Sua conta foi criada. Acesse o sistema para abrir chamados de suporte.</p>
      <div style="background:#F0FDF4;border-left:3px solid #16A34A;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:16px;font-size:13px">
        E-mail: <strong>${email}</strong><br>Departamento: <strong>${depto}</strong>
      </div>
      <a href="${APP_URL}" style="background:#1A1816;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px">Acessar →</a>
    `));

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: id, role: 'user', nome, email: email.toLowerCase(), depto, createdAt: Date.now() });
    res.status(201).json({ token, nome, email: email.toLowerCase(), depto });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/users/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Preencha e-mail e senha' });
  try {
    const [user] = await db('SELECT * FROM users WHERE email = ? AND senha = ?', [email.toLowerCase(), hashPass(senha)]);
    if (!user) return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, role: 'user', nome: user.nome, email: user.email, depto: user.depto, createdAt: Date.now() });
    res.json({ token, nome: user.nome, email: user.email, depto: user.depto });
  } catch(e) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS — TI
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/ti/login', (req, res) => {
  const { user, pass } = req.body;
  if (user !== TI_USER || pass !== TI_PASS)
    return res.status(401).json({ error: 'Credenciais inválidas' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: 'ti', role: 'ti', nome: 'TI Admin', createdAt: Date.now() });
  res.json({ token, user });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// SSE — NOTIFICAÇÕES EM TEMPO REAL
// ═══════════════════════════════════════════════════════════════════════════

const sseClients = new Map(); // token → { res, userId, role }

app.get('/api/events', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();
  const s = sessions.get(token);
  if (!s) return res.status(401).end();

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const ping = setInterval(() => res.write(':ping\n\n'), 25000);
  sseClients.set(token, { res, userId: s.userId, role: s.role });
  req.on('close', () => { clearInterval(ping); sseClients.delete(token); });
});

function broadcast(event, data, filter) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const [, client] of sseClients) {
    if (!filter || filter(client)) {
      try { client.res.write(payload); } catch {}
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS — TICKETS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/tickets', requireUser, async (req, res) => {
  try {
    let sql = 'SELECT * FROM tickets';
    const params = [];
    const where = [];
    if (req.session.role === 'user') { where.push('user_id = ?'); params.push(req.session.userId); }
    if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
    if (req.query.pri)    { where.push('pri = ?');    params.push(req.query.pri); }
    if (req.query.cat)    { where.push('cat = ?');    params.push(req.query.cat); }
    if (req.query.busca)  {
      where.push('(titulo LIKE ? OR nome LIKE ? OR id LIKE ?)');
      const q = `%${req.query.busca}%`;
      params.push(q, q, q);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY criado_em DESC';
    const tickets = await db(sql, params);
    res.json(tickets.map(t => ({
      ...t,
      desc: t.descricao,
      emailSolicitante: t.email_solicitante,
      criadoEm: t.criado_em,
      atualizadoEm: t.atualizado_em,
      userId: t.user_id
    })));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

app.get('/api/tickets/:id', requireUser, async (req, res) => {
  try {
    const t = await getTicketCompleto(req.params.id);
    if (!t) return res.status(404).json({ error: 'Não encontrado' });
    if (req.session.role === 'user' && t.user_id !== req.session.userId)
      return res.status(403).json({ error: 'Acesso negado' });
    res.json(t);
  } catch(e) { res.status(500).json({ error: 'Erro interno' }); }
});

app.post('/api/tickets', requireUser, upload.array('anexos', 5), async (req, res) => {
  try {
    const id = await nextTicketId();
    const { cat, pri, titulo, desc } = req.body;

    await db(
      'INSERT INTO tickets (id, user_id, nome, email_solicitante, depto, cat, pri, titulo, descricao) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, req.session.userId, req.session.nome, req.session.email, req.session.depto, cat, pri, titulo, desc]
    );

    if (req.files && req.files.length) {
      for (const f of req.files) {
        await db('INSERT INTO anexos (ticket_id, nome_original, arquivo, tamanho, tipo) VALUES (?,?,?,?,?)',
          [id, f.originalname, f.filename, f.size, f.mimetype]);
      }
    }

    const ticket = await getTicketCompleto(id);
    const p = { Urgente:'🔴', Alta:'🟡', Normal:'🟢' };

    await Promise.all([
      mail(EMAIL_TI, `[${p[pri]||'🟢'} #${id}] ${titulo}`, emailWrap(`Novo chamado #${id}`, `
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#6B6560;width:130px">Solicitante</td><td><strong>${req.session.nome}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#6B6560">E-mail</td><td>${req.session.email}</td></tr>
          <tr><td style="padding:6px 0;color:#6B6560">Departamento</td><td>${req.session.depto}</td></tr>
          <tr><td style="padding:6px 0;color:#6B6560">Categoria</td><td>${cat}</td></tr>
          <tr><td style="padding:6px 0;color:#6B6560">Prioridade</td><td>${p[pri]} ${pri}</td></tr>
        </table>
        <div style="background:#F5F3EE;padding:14px;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:16px">
          <strong>Descrição:</strong><br>${desc.replace(/\n/g,'<br>')}
        </div>
        <a href="${APP_URL}" style="background:#1A1816;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px">Abrir painel TI →</a>
      `)),
      mail(req.session.email, `Chamado #${id} recebido — ${titulo}`, emailWrap('Chamado recebido ✓', `
        <p>Olá <strong>${req.session.nome}</strong>,</p>
        <p style="font-size:13px;color:#6B6560;margin-bottom:16px">Seu chamado foi registrado. A equipe de TI irá analisá-lo em breve.</p>
        <div style="background:#EFF6FF;border-left:3px solid #2563EB;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:16px">
          <div style="font-size:12px;color:#6B6560">Número do protocolo</div>
          <div style="font-size:26px;font-weight:600;color:#2563EB;font-family:monospace">#${id}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
          <tr><td style="padding:5px 0;color:#6B6560;width:120px">Título</td><td><strong>${titulo}</strong></td></tr>
          <tr><td style="padding:5px 0;color:#6B6560">Categoria</td><td>${cat}</td></tr>
          <tr><td style="padding:5px 0;color:#6B6560">Prioridade</td><td>${pri}</td></tr>
        </table>
        <a href="${APP_URL}" style="background:#1A1816;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px">Acompanhar →</a>
      `))
    ]);

    // Notifica TI: novo chamado
    broadcast('novo_chamado', {
      id: ticket.id, titulo: ticket.titulo,
      nome: ticket.nome, pri: ticket.pri, cat: ticket.cat
    }, c => c.role === 'ti');
    res.status(201).json(ticket);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

app.patch('/api/tickets/:id/status', requireTI, async (req, res) => {
  try {
    const { status } = req.body;
    await db('UPDATE tickets SET status = ? WHERE id = ?', [status, req.params.id]);
    const t = await getTicketCompleto(req.params.id);
    if (!t) return res.status(404).json({ error: 'Não encontrado' });

    if (status === 'Em andamento' && t.mensagens.length === 0) {
      await db('INSERT INTO mensagens (ticket_id, de, texto) VALUES (?,?,?)',
        [req.params.id, 'TI', 'Olá! Já recebi seu chamado e estou analisando. Em breve retorno com mais informações.']);
    }

    const info = {
      'Em andamento': { emoji:'🔧', texto:'A equipe de TI já está trabalhando no seu chamado.' },
      'Resolvido':    { emoji:'✅', texto:'Seu chamado foi marcado como resolvido. Acesse o sistema para confirmar e avaliar o atendimento.' }
    }[status];

    if (info && t.emailSolicitante) {
      await mail(t.emailSolicitante, `${info.emoji} Chamado #${t.id} — ${status}`, emailWrap(`Chamado #${t.id} — ${status}`, `
        <p>Olá <strong>${t.nome}</strong>,</p>
        <p style="font-size:13px;color:#6B6560;margin-bottom:16px">${info.texto}</p>
        <div style="background:#F5F3EE;padding:12px 16px;border-radius:6px;font-size:13px;margin-bottom:16px">
          <strong>#${t.id}</strong> — ${t.titulo}<br>
          <span style="color:#6B6560">Status: <strong>${status}</strong></span>
        </div>
        <a href="${APP_URL}" style="background:#1A1816;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px">Acessar →</a>
      `));
    }

    const updated = await getTicketCompleto(req.params.id);
    // Notifica dono do ticket: status mudou
    broadcast('status_atualizado', {
      id: updated.id, titulo: updated.titulo, status: updated.status
    }, c => c.userId === updated.user_id);
    // Notifica TI também (para refresh do painel)
    broadcast('refresh', { id: updated.id }, c => c.role === 'ti');
    res.json(updated);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

app.post('/api/tickets/:id/mensagens', requireUser, async (req, res) => {
  try {
    const deTI = req.session.role === 'ti';
    const { texto } = req.body;
    await db('INSERT INTO mensagens (ticket_id, de, texto) VALUES (?,?,?)',
      [req.params.id, deTI ? 'TI' : 'Usuario', texto]);
    const t = await getTicketCompleto(req.params.id);

    const destino = deTI ? t.emailSolicitante : EMAIL_TI;
    const assunto = deTI ? `[#${t.id}] TI respondeu seu chamado` : `[#${t.id}] Nova mensagem — ${t.titulo}`;
    if (destino) {
      await mail(destino, assunto, emailWrap(assunto, `
        <p style="font-size:13px;color:#6B6560;margin-bottom:12px">Nova mensagem de <strong>${deTI ? 'Equipe de TI' : t.nome}</strong>:</p>
        <div style="background:#F5F3EE;padding:14px;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:16px;border-left:3px solid #E2DDD6">
          ${texto.replace(/\n/g,'<br>')}
        </div>
        <a href="${APP_URL}" style="background:#1A1816;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px">Responder →</a>
      `));
    }
    // Notifica o outro lado: nova mensagem
    broadcast('nova_mensagem', {
      ticketId: t.id, titulo: t.titulo,
      de: deTI ? 'TI' : t.nome, texto: texto.slice(0, 80)
    }, c => deTI ? c.userId === t.user_id : c.role === 'ti');
    res.json(t);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

app.patch('/api/tickets/:id/solucao', requireTI, async (req, res) => {
  try {
    await db('UPDATE tickets SET solucao = ? WHERE id = ?', [req.body.solucao, req.params.id]);
    res.json(await getTicketCompleto(req.params.id));
  } catch(e) { res.status(500).json({ error: 'Erro interno' }); }
});

app.patch('/api/tickets/:id/avaliacao', requireUser, async (req, res) => {
  try {
    const t = await getTicketCompleto(req.params.id);
    if (!t) return res.status(404).json({ error: 'Não encontrado' });
    if (req.session.role === 'user' && t.user_id !== req.session.userId)
      return res.status(403).json({ error: 'Acesso negado' });
    await db('UPDATE tickets SET avaliacao = ? WHERE id = ?', [req.body.avaliacao, req.params.id]);
    res.json(await getTicketCompleto(req.params.id));
  } catch(e) { res.status(500).json({ error: 'Erro interno' }); }
});

app.delete('/api/tickets/:id', requireTI, async (req, res) => {
  try {
    await db('DELETE FROM tickets WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Erro interno' }); }
});

app.get('/api/relatorio/csv', requireTI, async (req, res) => {
  try {
    const tickets = await db('SELECT * FROM tickets ORDER BY criado_em DESC');
    const header = 'ID,Solicitante,Email,Departamento,Categoria,Prioridade,Status,Titulo,Criado em,Resolvido,Avaliacao\n';
    const rows = tickets.map(t =>
      [t.id, t.nome, t.email_solicitante, t.depto, t.cat, t.pri, t.status,
       `"${(t.titulo||'').replace(/"/g,'""')}"`,
       new Date(t.criado_em).toLocaleString('pt-BR'),
       t.status === 'Resolvido' ? 'Sim' : 'Não',
       t.avaliacao || ''
      ].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="chamados.csv"');
    res.send('\uFEFF' + header + rows);
  } catch(e) { res.status(500).json({ error: 'Erro interno' }); }
});

app.get('/api/stats', requireTI, async (req, res) => {
  try {
    // Hoje em horário de Brasília (America/Sao_Paulo)
    const agora = new Date();
    const hoje = new Date(agora.toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'}).split('/').reverse().join('-') + 'T00:00:00');
    const [totais]    = await db('SELECT COUNT(*) as total, SUM(status="Aberto") as abertos, SUM(status="Em andamento") as andamento, SUM(status="Resolvido") as resolvidos, SUM(pri="Urgente" AND status!="Resolvido") as urgentes, SUM(criado_em >= ?) as hoje FROM tickets', [hoje]);
    const categorias  = await db('SELECT cat, COUNT(*) as total FROM tickets GROUP BY cat');
    const avaliacoes  = await db('SELECT AVG(avaliacao) as media FROM tickets WHERE avaliacao IS NOT NULL');

    res.json({
      total:     totais.total     || 0,
      abertos:   totais.abertos   || 0,
      andamento: totais.andamento || 0,
      resolvidos:totais.resolvidos|| 0,
      urgentes:  totais.urgentes  || 0,
      hoje:      totais.hoje      || 0,
      porCategoria: Object.fromEntries(categorias.map(c => [c.cat, c.total])),
      mediaAvaliacao: avaliacoes[0].media ? parseFloat(avaliacoes[0].media).toFixed(1) : null
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

// ─── Start ────────────────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query('SELECT 1'); // testa conexão
    console.log('✅ MySQL conectado');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Central de TI rodando em http://localhost:${PORT}`);
      console.log(`   URL pública: ${APP_URL}\n`);
    });
  } catch(e) {
    console.error('❌ Erro ao conectar no MySQL:', e.message);
    process.exit(1);
  }
}
start();
