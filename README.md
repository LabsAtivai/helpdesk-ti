# Central de Atendimento TI
Sistema de helpdesk interno — Node.js + Docker + Portainer

---

## Deploy no servidor (primeira vez)

### 1. Clonar o repositório no servidor
```bash
cd /opt
git clone git@github.com:LabsAtivai/helpdesk-ti.git
cd helpdesk-ti
```

### 2. Criar o arquivo .env com as credenciais
```bash
cp .env.exemplo .env
nano .env
```

Preencha com sua senha de app do Gmail:
```
SMTP_USER=labs.ativaai@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx    ← senha de 16 dígitos gerada no Google
EMAIL_TI=labs.ativaai@gmail.com
EMAIL_FROM=labs.ativaai@gmail.com
```

Salvar: `Ctrl+O` → `Enter` → `Ctrl+X`

### 3. Subir o container
```bash
docker compose up -d --build
```

### 4. Verificar se está rodando
```bash
docker compose ps
docker compose logs -f
```

Acesse: `http://<IP_DO_SERVIDOR>:3000`

---

## Gerenciar pelo Portainer

1. Acesse seu Portainer
2. Vá em **Stacks → Add stack**
3. Nome: `helpdesk-ti`
4. Escolha **"Repository"**
5. URL: `https://github.com/LabsAtivai/helpdesk-ti`
6. Branch: `main`
7. Compose path: `docker-compose.yml`
8. Em **Environment variables**, adicione:
   - `SMTP_USER` = labs.ativaai@gmail.com
   - `SMTP_PASS` = sua senha de app
   - `EMAIL_TI` = labs.ativaai@gmail.com
   - `EMAIL_FROM` = labs.ativaai@gmail.com
9. Clique em **Deploy the stack**

---

## Deploy automático (GitHub Actions)

A cada `git push` na branch `main`, o servidor atualiza automaticamente.

Configure os secrets no GitHub (Settings → Secrets → Actions):
| Secret | Valor |
|--------|-------|
| `SERVER_HOST` | IP do seu servidor |
| `SERVER_USER` | usuário SSH (ex: ubuntu) |
| `SERVER_SSH_KEY` | chave SSH privada do servidor |

---

## Backup dos dados

Os dados ficam em volumes Docker. Para fazer backup:
```bash
# Backup do banco de dados
docker cp helpdesk-ti:/app/data/tickets.json ./backup-$(date +%Y%m%d).json

# Backup dos uploads
docker cp helpdesk-ti:/app/public/uploads ./uploads-backup-$(date +%Y%m%d)
```

---

## Atualizar manualmente
```bash
cd /opt/helpdesk-ti
git pull origin main
docker compose up -d --build
```
