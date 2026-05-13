const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8909;

// ─── Credenciais de acesso ao Painel TI ──────────────────────────────────
// Altere aqui ou defina via variáveis de ambiente no .env
const TI_USER = process.env.TI_USER || 'admin';
const TI_PASS = process.env.TI_PASS || 'ti@ativaai2024';

// Tokens de sessão em memória (simples, sem banco)
const sessions = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

// ─── Configuração de e-mail ────────────────────────────────────────────────
// Edite este bloco com suas credenciais antes de rodar
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.office365.com',  // Outlook: smtp.office365.com | Gmail: smtp.gmail.com
  port: process.env.SMTP_PORT || 587,
  secure: false, // true para porta 465 (SSL), false para 587 (TLS)
  auth: {
    user: process.env.SMTP_USER || 'ti@suaempresa.com.br',
    pass: process.env.SMTP_PASS || 'sua_senha_aqui'
  }
};
const EMAIL_TI  = process.env.EMAIL_TI  || 'ti@suaempresa.com.br';   // quem recebe avisos de novo chamado
const EMAIL_FROM = process.env.EMAIL_FROM || 'ti@suaempresa.com.br';  // remetente

const transporter = nodemailer.createTransport(EMAIL_CONFIG);

// ─── Banco de dados (arquivo JSON) ────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data', 'tickets.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { tickets: [], nextId: 1 };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ─── Upload de arquivos ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + uuidv4().slice(0,8) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Tipo de arquivo não permitido'), ok);
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Funções de e-mail ────────────────────────────────────────────────────
async function enviarEmailNovoTicket(ticket) {
  const prioEmoji = { Urgente: '🔴', Alta: '🟡', Normal: '🟢' };
  try {
    await transporter.sendMail({
      from: `"Central TI" <${EMAIL_FROM}>`,
      to: EMAIL_TI,
      subject: `[${prioEmoji[ticket.pri] || '🟢'} #${ticket.id}] ${ticket.titulo}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1A1816;padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="color:white;margin:0;font-size:16px">Novo chamado #${ticket.id}</h2>
          </div>
          <div style="border:1px solid #E2DDD6;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
              <tr><td style="padding:6px 0;color:#6B6560;width:120px">Solicitante</td><td style="font-weight:500">${ticket.nome}</td></tr>
              <tr><td style="padding:6px 0;color:#6B6560">Departamento</td><td>${ticket.depto}</td></tr>
              <tr><td style="padding:6px 0;color:#6B6560">Categoria</td><td>${ticket.cat}</td></tr>
              <tr><td style="padding:6px 0;color:#6B6560">Prioridade</td><td>${prioEmoji[ticket.pri]} ${ticket.pri}</td></tr>
              <tr><td style="padding:6px 0;color:#6B6560">Aberto em</td><td>${new Date(ticket.criadoEm).toLocaleString('pt-BR')}</td></tr>
            </table>
            <div style="background:#F5F3EE;padding:14px;border-radius:6px;font-size:13px;line-height:1.6">
              <strong>Descrição:</strong><br>${ticket.desc.replace(/\n/g,'<br>')}
            </div>
            <div style="margin-top:16px">
              <a href="http://localhost:${PORT}" style="background:#1A1816;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px">Abrir painel TI →</a>
            </div>
          </div>
        </div>
      `
    });
  } catch (e) {
    console.warn('Aviso: e-mail para TI não enviado —', e.message);
  }
}

async function enviarEmailConfirmacao(ticket) {
  if (!ticket.emailSolicitante) return;
  try {
    await transporter.sendMail({
      from: `"Central TI" <${EMAIL_FROM}>`,
      to: ticket.emailSolicitante,
      subject: `Chamado #${ticket.id} recebido — ${ticket.titulo}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1A1816;padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="color:white;margin:0;font-size:16px">Chamado recebido ✓</h2>
          </div>
          <div style="border:1px solid #E2DDD6;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
            <p style="font-size:14px">Olá <strong>${ticket.nome}</strong>,</p>
            <p style="font-size:13px;color:#6B6560;margin-bottom:16px">Seu chamado foi registrado. Nossa equipe de TI irá analisá-lo em breve.</p>
            <div style="background:#EFF6FF;border-left:3px solid #2563EB;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:16px">
              <div style="font-size:12px;color:#6B6560">Número do protocolo</div>
              <div style="font-size:22px;font-weight:600;color:#2563EB;font-family:monospace">#${ticket.id}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <tr><td style="padding:5px 0;color:#6B6560;width:120px">Título</td><td>${ticket.titulo}</td></tr>
              <tr><td style="padding:5px 0;color:#6B6560">Categoria</td><td>${ticket.cat}</td></tr>
              <tr><td style="padding:5px 0;color:#6B6560">Prioridade</td><td>${ticket.pri}</td></tr>
            </table>
            <p style="font-size:12px;color:#9B968F;margin-top:16px">Guarde este número para acompanhar seu chamado.</p>
          </div>
        </div>
      `
    });
  } catch (e) {
    console.warn('Aviso: e-mail de confirmação não enviado —', e.message);
  }
}

async function enviarEmailAtualizacao(ticket, mensagem, deTI) {
  const destino = deTI ? ticket.emailSolicitante : EMAIL_TI;
  const assunto = deTI
    ? `[#${ticket.id}] TI respondeu seu chamado`
    : `[#${ticket.id}] Nova mensagem do usuário — ${ticket.titulo}`;
  if (!destino) return;
  try {
    await transporter.sendMail({
      from: `"Central TI" <${EMAIL_FROM}>`,
      to: destino,
      subject: assunto,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px">
          <p style="font-size:13px">Nova mensagem no chamado <strong>#${ticket.id} — ${ticket.titulo}</strong>:</p>
          <div style="background:#F5F3EE;padding:14px;border-radius:6px;font-size:13px;line-height:1.6;margin:12px 0">
            ${mensagem.replace(/\n/g,'<br>')}
          </div>
          <p style="font-size:12px;color:#9B968F">Acesse o sistema para responder.</p>
        </div>
      `
    });
  } catch (e) {
    console.warn('Aviso: e-mail de atualização não enviado —', e.message);
  }
}

async function enviarEmailStatus(ticket) {
  if (!ticket.emailSolicitante) return;
  const msgs = {
    'Em andamento': { emoji: '🔧', texto: 'A equipe de TI já está trabalhando no seu chamado.' },
    'Resolvido': { emoji: '✅', texto: 'Seu chamado foi marcado como resolvido. Acesse o sistema para confirmar e avaliar o atendimento.' }
  };
  const info = msgs[ticket.status];
  if (!info) return;
  try {
    await transporter.sendMail({
      from: `"Central TI" <${EMAIL_FROM}>`,
      to: ticket.emailSolicitante,
      subject: `${info.emoji} Chamado #${ticket.id} — ${ticket.status}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px">
          <p style="font-size:14px">Olá <strong>${ticket.nome}</strong>,</p>
          <p style="font-size:13px;color:#6B6560">${info.texto}</p>
          <div style="background:#F5F3EE;padding:12px 16px;border-radius:6px;font-size:13px;margin:12px 0">
            <strong>#${ticket.id}</strong> — ${ticket.titulo}<br>
            <span style="color:#6B6560">Status: ${ticket.status}</span>
          </div>
        </div>
      `
    });
  } catch (e) {
    console.warn('Aviso: e-mail de status não enviado —', e.message);
  }
}

// ─── Middleware de autenticação ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers['x-ti-token'];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Sessão expirada' });
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Sessão expirada' });
  }
  next();
}

// ─── Rotas de autenticação ────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === TI_USER && pass === TI_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { user, createdAt: Date.now() });
    return res.json({ token, user });
  }
  res.status(401).json({ error: 'Credenciais inválidas' });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-ti-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// ─── Rotas da API ─────────────────────────────────────────────────────────

// Listar tickets
app.get('/api/tickets', (req, res) => {
  const db = loadDB();
  let list = [...db.tickets];
  const { status, pri, cat, busca } = req.query;
  if (status) list = list.filter(t => t.status === status);
  if (pri)    list = list.filter(t => t.pri === pri);
  if (cat)    list = list.filter(t => t.cat === cat);
  if (busca) {
    const q = busca.toLowerCase();
    list = list.filter(t =>
      t.titulo.toLowerCase().includes(q) ||
      t.nome.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    );
  }
  res.json(list);
});

// Buscar ticket por ID
app.get('/api/tickets/:id', (req, res) => {
  const db = loadDB();
  const t = db.tickets.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Chamado não encontrado' });
  res.json(t);
});

// Criar ticket (com upload opcional)
app.post('/api/tickets', upload.array('anexos', 5), async (req, res) => {
  const db = loadDB();
  const id = String(db.nextId).padStart(4, '0');
  db.nextId++;

  const anexos = (req.files || []).map(f => ({
    nome: f.originalname,
    arquivo: f.filename,
    tamanho: f.size,
    tipo: f.mimetype
  }));

  const ticket = {
    id,
    nome: req.body.nome,
    emailSolicitante: req.body.email || '',
    depto: req.body.depto,
    cat: req.body.cat,
    pri: req.body.pri,
    titulo: req.body.titulo,
    desc: req.body.desc,
    status: 'Aberto',
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    mensagens: [],
    avaliacao: null,
    solucao: '',
    anexos
  };

  db.tickets.unshift(ticket);
  saveDB(db);

  // E-mails em paralelo
  await Promise.all([
    enviarEmailNovoTicket(ticket),
    enviarEmailConfirmacao(ticket)
  ]);

  res.status(201).json(ticket);
});

// Atualizar status
app.patch('/api/tickets/:id/status', requireAuth, async (req, res) => {
  const db = loadDB();
  const t = db.tickets.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Não encontrado' });
  t.status = req.body.status;
  t.atualizadoEm = new Date().toISOString();
  if (req.body.status === 'Em andamento' && t.mensagens.length === 0) {
    t.mensagens.push({
      de: 'TI',
      texto: 'Olá! Já recebi seu chamado e estou analisando. Em breve retorno com mais informações.',
      em: new Date().toISOString()
    });
  }
  saveDB(db);
  await enviarEmailStatus(t);
  res.json(t);
});

// Enviar mensagem no chat
app.post('/api/tickets/:id/mensagens', async (req, res) => {
  const db = loadDB();
  const t = db.tickets.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Não encontrado' });
  const msg = { de: req.body.de, texto: req.body.texto, em: new Date().toISOString() };
  t.mensagens.push(msg);
  t.atualizadoEm = new Date().toISOString();
  saveDB(db);
  await enviarEmailAtualizacao(t, msg.texto, msg.de === 'TI');
  res.json(t);
});

// Salvar solução
app.patch('/api/tickets/:id/solucao', requireAuth, (req, res) => {
  const db = loadDB();
  const t = db.tickets.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Não encontrado' });
  t.solucao = req.body.solucao;
  t.atualizadoEm = new Date().toISOString();
  saveDB(db);
  res.json(t);
});

// Avaliar atendimento
app.patch('/api/tickets/:id/avaliacao', (req, res) => {
  const db = loadDB();
  const t = db.tickets.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Não encontrado' });
  t.avaliacao = req.body.avaliacao;
  t.atualizadoEm = new Date().toISOString();
  saveDB(db);
  res.json(t);
});

// Excluir ticket
app.delete('/api/tickets/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.tickets = db.tickets.filter(t => t.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Exportar relatório CSV
app.get('/api/relatorio/csv', requireAuth, (req, res) => {
  const db = loadDB();
  const header = 'ID,Solicitante,Email,Departamento,Categoria,Prioridade,Status,Titulo,Criado em,Resolvido,Avaliacao\n';
  const rows = db.tickets.map(t =>
    [t.id, t.nome, t.emailSolicitante, t.depto, t.cat, t.pri, t.status,
     `"${t.titulo.replace(/"/g,'""')}"`,
     new Date(t.criadoEm).toLocaleString('pt-BR'),
     t.status === 'Resolvido' ? 'Sim' : 'Não',
     t.avaliacao || ''
    ].join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="chamados.csv"');
  res.send('\uFEFF' + header + rows); // BOM para Excel
});

// Stats para dashboard
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const t = db.tickets;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  res.json({
    total: t.length,
    abertos: t.filter(x => x.status === 'Aberto').length,
    andamento: t.filter(x => x.status === 'Em andamento').length,
    resolvidos: t.filter(x => x.status === 'Resolvido').length,
    urgentes: t.filter(x => x.pri === 'Urgente' && x.status !== 'Resolvido').length,
    hoje: t.filter(x => new Date(x.criadoEm) >= hoje).length,
    porCategoria: t.reduce((acc, x) => { acc[x.cat] = (acc[x.cat]||0)+1; return acc; }, {}),
    mediaAvaliacao: (() => {
      const avaliados = t.filter(x => x.avaliacao);
      if (!avaliados.length) return null;
      return (avaliados.reduce((s, x) => s + x.avaliacao, 0) / avaliados.length).toFixed(1);
    })()
  });
});

// ─── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Central de TI rodando em http://localhost:${PORT}`);
  console.log(`   Acesso na rede: http://<IP_DO_SERVIDOR>:${PORT}`);
  console.log(`   Para descobrir o IP: ipconfig (Windows) ou hostname -I (Linux)\n`);
});
